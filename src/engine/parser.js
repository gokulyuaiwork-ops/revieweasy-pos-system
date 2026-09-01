import zlib from 'zlib';
import { storage } from './storage.js';

/**
 * Universal Indian Mobile Phone Validator
 * Validates 10-digit telecom allocations, normalizes formatting,
 * applies Shannon entropy checks, and filters cashier dummy sequences.
 */
export function validateIndianMobile(rawCandidate, storeOwnerPhone = '', isHeaderZone = false) {
  if (!rawCandidate) return { valid: false, reason: 'EMPTY' };

  // Strip all non-digits
  let digits = rawCandidate.replace(/\D/g, '');

  // Strip international prefix +91 or 91 if 12 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.substring(2);
  }
  // Strip leading 0 if 11 digits
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }

  // Must be exactly 10 digits
  if (digits.length !== 10) {
    return { valid: false, reason: 'INVALID_LENGTH', digits };
  }

  // Official Indian telecom allocation rule: Indian mobile numbers start with 6, 7, 8, or 9
  if (!['6', '7', '8', '9'].includes(digits[0])) {
    return { valid: false, reason: 'NON_MOBILE_PREFIX (Landline / Invalid)', digits };
  }

  // Check collision against configured store owner / helpline number only in header zone
  const cleanStoreOwner = storeOwnerPhone.replace(/\D/g, '').slice(-10);
  if (isHeaderZone && cleanStoreOwner && digits === cleanStoreOwner) {
    return { valid: false, reason: 'STORE_OWNER_NUMBER_COLLISION', digits };
  }

  // Common Indian cashier dummy number sequences
  const dummyBlacklist = [
    '9876543210', '1234567890', '9999999999', '8888888888',
    '7777777777', '6666666666', '9898989898', '9090909090',
    '9123456789', '9000000000', '9111111111', '8000000000',
    '9876598765', '9876501234', '9191919191', '9292929292'
  ];
  if (dummyBlacklist.includes(digits)) {
    return { valid: false, reason: 'DUMMY_SEQUENCE_BLACKLIST', digits };
  }

  // Shannon Entropy / Digit Diversity Gate (Reject numbers with <= 3 unique digits like 9999999991)
  const uniqueDigits = new Set(digits.split('')).size;
  if (uniqueDigits <= 3) {
    return { valid: false, reason: 'LOW_ENTROPY_REPEATED_DIGITS', digits };
  }

  return { valid: true, digits, formatted: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` };
}

/**
 * Universal Document Classifier (KOT/Estimate vs Final Bill / Tax Invoice)
 * Accurately filters pure kitchen slips while allowing finalized settlement invoices
 * that reference a KOT table number.
 */
export function classifyDocument(text) {
  if (!text) {
    return { isFinalBill: false, docType: 'EMPTY_TEXT', matchedTokens: [] };
  }

  const upper = text.toUpperCase();

  // 1. Settlement Whitelist Tokens (Definitive markers of a final bill)
  const finalBillTokens = [
    'TAX INVOICE', 'FINAL BILL', 'CASH MEMO', 'RETAIL INVOICE',
    'TOTAL AMOUNT', 'GRAND TOTAL', 'NET PAYABLE', 'NET AMOUNT', 'FINAL AMOUNT',
    'PAID VIA', 'PAYMENT MODE', 'GST INVOICE', 'INVOICE NO', 'BILL NO', 'BILL #',
    'TOTAL:', 'TOTAL DUE', 'SUB TOTAL', 'SETTLEMENT', 'JOB CARD INVOICE',
    'CUSTOMER COPY', 'ORIGINAL FOR RECIPIENT'
  ];

  const matchedFinalTokens = finalBillTokens.filter(token => upper.includes(token));
  const hasPhonePattern = /(?:(?:\+|0{0,2})91[\s.-]?)?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9})/.test(upper);
  const hasAmountPattern = /(?:TOTAL|AMOUNT|RS\.?|INR|₹)[\s.:$₹Rs\t-]*[0-9,]+\.?[0-9]{0,2}/i.test(upper);

  // 2. Pure Non-Bill KOT / Kitchen Order Blacklist Tokens (Using word boundaries)
  const pureKotRegexes = [
    /\bKITCHEN\s+ORDER\s+TICKET\b/,
    /\bKITCHEN\s+ORDER\b/,
    /\bBAR\s+ORDER\s+TICKET\b/,
    /\bRUNNING\s+KOT\b/,
    /\bESTIMATE\s+ONLY\b/,
    /\bPROFORMA\s+INVOICE\b/,
    /\bDRAFT\s+BILL\b/,
    /\bORDER\s+TICKET\b/
  ];

  let matchedKotToken = null;
  for (const regex of pureKotRegexes) {
    if (regex.test(upper)) {
      matchedKotToken = regex.source.replace(/\\b/g, '');
      break;
    }
  }

  // If standalone KOT token found and no final bill / payment settlement keywords exist:
  if (matchedKotToken && matchedFinalTokens.length === 0 && !upper.includes('PAID') && !upper.includes('SETTLE')) {
    return {
      isFinalBill: false,
      docType: 'KOT_OR_ESTIMATE',
      matchedToken: matchedKotToken
    };
  }

  // Check standalone \bKOT\b only if not accompanied by tax/invoice/settlement markers
  if (/\bKOT\b/.test(upper) && matchedFinalTokens.length === 0 && !hasAmountPattern) {
    return {
      isFinalBill: false,
      docType: 'KOT_SLIP',
      matchedToken: 'KOT'
    };
  }

  // 3. Final Bill Approval
  if (matchedFinalTokens.length > 0 || (hasPhonePattern && hasAmountPattern) || hasPhonePattern) {
    return {
      isFinalBill: true,
      docType: 'TAX_INVOICE',
      matchedTokens: matchedFinalTokens.length > 0 ? matchedFinalTokens : ['PHONE_AND_AMOUNT_DETECTED']
    };
  }

  return {
    isFinalBill: false,
    docType: 'UNKNOWN_OR_INSUFFICIENT_METADATA',
    matchedTokens: []
  };
}

/**
 * Checks if raw binary payload is a Graphical ESC/POS Raster Bitmap stream
 */
export function isRasterBitmapPayload(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  // Look for GS v 0 (0x1D, 0x76, 0x30) or ESC * (0x1B, 0x2A) or GS ( L (0x1D, 0x28, 0x4C)
  for (let i = 0; i < Math.min(buffer.length - 3, 512); i++) {
    if (buffer[i] === 0x1D && buffer[i+1] === 0x76 && buffer[i+2] === 0x30) return true;
    if (buffer[i] === 0x1B && buffer[i+1] === 0x2A) return true;
    if (buffer[i] === 0x1D && buffer[i+1] === 0x28 && buffer[i+2] === 0x4C) return true;
  }
  return false;
}

/**
 * Universal Multi-Encoding De-spooler
 * Extracts clean, human-readable ASCII/UTF text from any raw print stream buffer
 * (XPS/OpenXPS ZIP XML, UTF-8, UTF-16LE Windows EMF spool, UTF-16BE, PDF, and continuous ASCII runs)
 */
export function extractUniversalTextFromBuffer(rawInput) {
  if (!rawInput) return '';
  if (typeof rawInput === 'string') return rawInput;
  if (!Buffer.isBuffer(rawInput)) return String(rawInput);

  const buffer = rawInput;

  // 1. XPS / OpenXPS Spool File (.SPL from Microsoft Print to PDF or Windows V4 drivers)
  // Check for ZIP magic bytes PK\x03\x04
  if (buffer.length > 30 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    try {
      const xpsLines = [];
      let offset = 0;
      while (offset < buffer.length - 30) {
        if (buffer[offset] === 0x50 && buffer[offset+1] === 0x4B && buffer[offset+2] === 0x03 && buffer[offset+3] === 0x04) {
          const compressionMethod = buffer.readUInt16LE(offset + 8);
          const compressedSize = buffer.readUInt32LE(offset + 18);
          const fileNameLength = buffer.readUInt16LE(offset + 26);
          const extraFieldLength = buffer.readUInt16LE(offset + 28);
          
          const fileNameStart = offset + 30;
          const fileNameEnd = fileNameStart + fileNameLength;
          const dataStart = fileNameEnd + extraFieldLength;
          const dataEnd = dataStart + compressedSize;

          if (dataEnd <= buffer.length && compressedSize > 0) {
            const rawData = buffer.slice(dataStart, dataEnd);
            let uncompressedXml = '';

            if (compressionMethod === 0) {
              uncompressedXml = rawData.toString('utf8');
            } else if (compressionMethod === 8) { // DEFLATE
              try {
                uncompressedXml = zlib.inflateRawSync(rawData).toString('utf8');
              } catch (e) {}
            }

            if (uncompressedXml) {
              const unicodeStringRegex = /UnicodeString=["']([^"']+)["']/g;
              let m;
              while ((m = unicodeStringRegex.exec(uncompressedXml)) !== null) {
                if (!xpsLines.includes(m[1])) {
                  xpsLines.push(m[1]);
                }
              }
            }
          }
          offset = dataEnd > offset ? dataEnd : offset + 1;
        } else {
          offset++;
        }
      }

      if (xpsLines.length > 0) {
        const xpsText = xpsLines.join('\n');
        const classXps = classifyDocument(xpsText);
        if (classXps.isFinalBill) {
          return xpsText;
        }
      }
    } catch (e) {}
  }

  // 2. PDF Stream Extraction (if PDF magic header %PDF- exists)
  if (buffer.length > 8 && buffer.slice(0, 5).toString('ascii').startsWith('%PDF')) {
    try {
      const pdfString = buffer.toString('latin1');
      const textMatches = [];
      const streamRegex = /\(([^)]+)\)\s*Tj/g;
      let m;
      while ((m = streamRegex.exec(pdfString)) !== null) {
        textMatches.push(m[1]);
      }
      if (textMatches.length > 0) {
        return textMatches.join(' ');
      }
    } catch (e) {}
  }

  // 3. Standard UTF-8 decoding with ESC/POS binary strip
  const utf8Candidate = buffer.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ');
  const classUtf8 = classifyDocument(utf8Candidate);
  if (classUtf8.isFinalBill) {
    return utf8Candidate;
  }

  // 4. UTF-16LE Decoding (Windows GDI / EMF / Notepad spoolers)
  let utf16Candidate = '';
  try {
    utf16Candidate = buffer.toString('utf16le').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ');
    const classUtf16 = classifyDocument(utf16Candidate);
    if (classUtf16.isFinalBill) {
      return utf16Candidate;
    }
  } catch (e) {}

  // 5. Extract contiguous printable ASCII / Latin-1 text chunks from binary spool blob
  const rawLatin = buffer.toString('latin1');
  const asciiChunks = rawLatin.match(/[\x20-\x7E\r\n\t]{3,}/g) || [];
  const extractedAscii = asciiChunks.join('\n');
  const classAscii = classifyDocument(extractedAscii);
  if (classAscii.isFinalBill) {
    return extractedAscii;
  }

  // Return the longest decoded representation
  const candidates = [utf8Candidate, utf16Candidate, extractedAscii].filter(Boolean);
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || utf8Candidate;
}

/**
 * Universal Invoice Number Extractor
 * Matches all Indian & International invoice numbering patterns
 */
export function extractInvoiceNumber(lines, rawText = '') {
  const priorityPatterns = [
    /(?:Tax\s*)?Inv(?:oice)?\s*(?:No|#|Num|Id)?[\s.:#-]*([A-Za-z0-9\/-]{2,30})/i,
    /(?:Tax\s*|Final\s*)?Bill\s*(?:No|#|Num|Id)?[\s.:#-]*([A-Za-z0-9\/-]{2,30})/i,
    /(?:Cash\s*)?Memo\s*(?:No|#|Num)?[\s.:#-]*([A-Za-z0-9\/-]{2,30})/i,
    /(?:Receipt|Rcpt)\s*(?:No|#)?[\s.:#-]*([A-Za-z0-9\/-]{2,30})/i,
    /#\s*([A-Za-z0-9\/-]{2,20})/i,
    /(?:Job\s*Card|Order|Doc|Token|Ref|Voucher)\s*(?:No|#)?[\s.:#-]*([A-Za-z0-9\/-]{2,30})/i
  ];

  let bestCandidate = null;

  for (const pattern of priorityPatterns) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const candidate = match[1].trim().replace(/[:#]/g, '');
        if (!['DATE', 'TIME', 'TOTAL', 'AMOUNT', 'CASH', 'UPI', 'CARD', 'KOT'].includes(candidate.toUpperCase())) {
          return candidate;
        }
        if (!bestCandidate) bestCandidate = candidate;
      }
    }
  }

  return bestCandidate || `INV-${Date.now().toString().slice(-5)}`;
}

/**
 * Universal Total Amount Extractor
 * Scans lines from bottom to top for total settlement figures
 */
export function extractTotalAmount(lines, rawText = '') {
  const totalPatterns = [
    /(?:Grand\s*Total|Net\s*(?:Payable|Amount|Total)|Total\s*Amount|Final\s*Amount|TOTAL|Bill\s*Total|Amount\s*Due|Paid\s*Amount|Amount|Total\s*Rs\.?|Total\s*₹)[\s.:$₹Rs\t-]*([0-9,]+\.?[0-9]{0,2})/i,
    /(?:Cash|Card|UPI|GPay|PhonePe|Paytm|Online)\s*(?:Paid)?[\s.:$₹Rs\t-]*([0-9,]+\.?[0-9]{0,2})/i,
    /(?:Round\s*Off|Net)[\s\w.:$₹Rs\t-]*?([0-9,]+\.[0-9]{2})/i
  ];

  for (let i = lines.length - 1; i >= 0; i--) {
    for (const pattern of totalPatterns) {
      const match = lines[i].match(pattern);
      if (match && match[1]) {
        const cleanAmount = match[1].replace(/,/g, '');
        const val = parseFloat(cleanAmount);
        if (!isNaN(val) && val > 0) {
          return val.toFixed(2);
        }
      }
    }
  }

  return '0.00';
}

/**
 * Universal Customer Name Extractor
 */
export function extractCustomerName(lines, rawText = '') {
  const namePatterns = [
    /(?:Customer(?:\s*Name)?|Cust(?:\s*Name)?|Client|Patient|Party(?:\s*Name)?|Guest|Billed\s*To|M\/s|Name)[\s.:#-]+([A-Za-z\s.\-]{2,35})/i,
    /(?:Vehicle\s*No|Reg\s*No)[\s.:#-]+([A-Za-z0-9\s-]{4,20})/i
  ];

  for (const line of lines) {
    for (const pattern of namePatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        let name = match[1].trim();
        // Remove trailing phone numbers, GSTIN, or total keywords
        name = name.replace(/(?:Mob(?:ile)?|Ph(?:one)?|Total|GSTIN|Amount|Inv).*/i, '').trim();
        if (name.length >= 2 && !['VALUED', 'CUSTOMER', 'WALKIN', 'GUEST', 'N/A', 'CASH'].includes(name.toUpperCase())) {
          return name;
        }
      }
    }
  }

  return 'Valued Customer';
}

/**
 * Dual-Zone Customer Phone Disambiguation Engine
 * Separates top store header (helpline) from customer body/footer lines
 */
export function extractCustomerPhone(lines, storePhone = '') {
  const totalLines = lines.length;
  const headerCutoffIndex = Math.max(1, Math.floor(totalLines * 0.25));

  const headerLines = lines.slice(0, headerCutoffIndex);
  const bodyFooterLines = lines.slice(headerCutoffIndex);

  const phonePattern = /(?:(?:\+|0{0,2})91[\s.-]?)?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9})/g;

  const candidateMatches = [];

  // 1. Inspect Body & Footer lines (Top Priority for Customer Contact)
  for (const line of bodyFooterLines) {
    let match;
    while ((match = phonePattern.exec(line)) !== null) {
      candidateMatches.push({ phone: match[0], zone: 'BODY_FOOTER' });
    }
  }

  // 2. Inspect Header lines (Shop Helpline fallback)
  for (const line of headerLines) {
    let match;
    while ((match = phonePattern.exec(line)) !== null) {
      candidateMatches.push({ phone: match[0], zone: 'HEADER_STORE' });
    }
  }

  let validPhone = null;

  for (const item of candidateMatches) {
    const isHeader = item.zone === 'HEADER_STORE';
    const validation = validateIndianMobile(item.phone, storePhone, isHeader);
    if (validation.valid) {
      if (item.zone === 'BODY_FOOTER') {
        validPhone = validation;
        break; // Priority found in body/footer!
      } else if (!validPhone) {
        validPhone = validation;
      }
    } else if (validation.reason === 'STORE_OWNER_NUMBER_COLLISION') {
      storage.incrementMetric('storeOwnerNumbersFiltered');
    } else if (validation.reason.includes('DUMMY') || validation.reason.includes('LOW_ENTROPY')) {
      storage.incrementMetric('dummyNumbersRejected');
    }
  }

  return validPhone;
}

/**
 * Itemized Receipt Line Item Parser
 */
export function extractReceiptItems(rawText) {
  if (!rawText) return [];
  const items = [];
  const lines = rawText.split(/\r?\n/);
  
  for (const line of lines) {
    // Pattern: 2x Burger 180.00 or 1 Cold Brew Coffee 220.00
    const match = line.match(/^(\d+)\s*x?\s+([A-Za-z0-9\s\-_&]+?)\s+[₹Rs\.]*\s*([\d,]+\.?\d{0,2})$/i);
    if (match) {
      const name = match[2].trim();
      if (!['TOTAL', 'SUBTOTAL', 'TAX', 'GST', 'CGST', 'SGST', 'DISCOUNT'].includes(name.toUpperCase())) {
        items.push({
          qty: match[1],
          name: name,
          price: parseFloat(match[3].replace(/,/g, '')).toFixed(2)
        });
      }
    }
  }
  return items;
}

/**
 * Category B1, B2, B3, B6, D1: Universal Multi-Format Receipt Parser Engine
 * Ingests any binary spool stream, GDI EMF, ESC/POS, PDF, or text bill
 */
export function parseReceiptStream(rawInput, storeConfig = null) {
  const config = storeConfig || storage.getConfig();
  const isRaster = isRasterBitmapPayload(rawInput);

  // 1. Extract clean universal text stream from raw buffer / string
  const text = extractUniversalTextFromBuffer(rawInput);

  // 2. Classify Document (Filter KOTs, allow final settlement bills)
  const classification = classifyDocument(text);
  if (!classification.isFinalBill) {
    storage.incrementMetric('kotsBlocked');
    return {
      success: false,
      status: 'IGNORED_KOT',
      reason: `Document filtered as non-bill (${classification.docType}): ${classification.matchedToken || 'No bill settlement markers'}`,
      isRaster,
      rawText: text
    };
  }

  // 3. Normalize lines
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // 4. Extract Key Metadata Fields
  const invoiceNo = extractInvoiceNumber(lines, text);
  const totalAmount = extractTotalAmount(lines, text);
  const customerName = extractCustomerName(lines, text);
  const validPhone = extractCustomerPhone(lines, config.storePhone);
  const items = extractReceiptItems(text);

  // 5. Mobile Phone Validation Gate
  if (!validPhone || !validPhone.valid) {
    storage.incrementMetric('anonymousWalkins');
    return {
      success: false,
      status: 'ANONYMOUS_WALKIN',
      reason: 'No valid Indian customer mobile number detected on bill',
      invoiceNo,
      totalAmount,
      customerName,
      isRaster,
      rawText: text,
      items
    };
  }

  // 6. Category B4: 24-Hour SHA-256 Idempotency Duplicate Suppression
  const isDup = storage.isDuplicate(config.storeName, invoiceNo, validPhone.digits, totalAmount);
  if (isDup) {
    storage.incrementMetric('duplicatesSuppressed');
    return {
      success: false,
      status: 'DUPLICATE_SUPPRESSED',
      reason: `Duplicate print job for Invoice #${invoiceNo} suppressed by 24hr idempotency hash`,
      invoiceNo,
      totalAmount,
      customerPhone: validPhone.digits,
      formattedPhone: validPhone.formatted,
      isRaster,
      items
    };
  }

  storage.incrementMetric('validInvoicesProcessed');
  if (isRaster) storage.incrementMetric('rasterBitmapsParsed');

  return {
    success: true,
    status: 'VALID_INVOICE',
    invoiceNo,
    totalAmount,
    customerName,
    customerPhone: validPhone.digits,
    formattedPhone: validPhone.formatted,
    isRaster,
    rawText: text,
    items
  };
}
