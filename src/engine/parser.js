import { storage } from './storage.js';

/**
 * Category B3 & B6: Indian Phone Validator with Shannon Entropy and Delimiter Normalizer
 */
export function validateIndianMobile(rawCandidate, storeOwnerPhone = '') {
  if (!rawCandidate) return { valid: false, reason: 'EMPTY' };

  // Strip non-digits
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

  // Category B1: Check collision against configured store owner number
  const cleanStoreOwner = storeOwnerPhone.replace(/\D/g, '').slice(-10);
  if (cleanStoreOwner && digits === cleanStoreOwner) {
    return { valid: false, reason: 'STORE_OWNER_NUMBER_COLLISION', digits };
  }

  // Common Indian cashier dummy number sequences
  const dummyBlacklist = [
    '9876543210', '1234567890', '9999999999', '8888888888',
    '7777777777', '6666666666', '9898989898', '9090909090',
    '9123456789', '9000000000', '9111111111', '8000000000'
  ];
  if (dummyBlacklist.includes(digits)) {
    return { valid: false, reason: 'DUMMY_SEQUENCE_BLACKLIST', digits };
  }

  // Shannon Entropy / Digit Diversity Gate (Reject 9999999991 or <= 3 unique digits)
  const uniqueDigits = new Set(digits.split('')).size;
  if (uniqueDigits <= 3) {
    return { valid: false, reason: 'LOW_ENTROPY_REPEATED_DIGITS', digits };
  }

  return { valid: true, digits, formatted: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` };
}

/**
 * Category B2: Document Classifier (KOT & Estimate vs Final Tax Invoice)
 */
export function classifyDocument(text) {
  const upper = text.toUpperCase();

  // Strict Blacklist for non-bill slips
  const blacklistTokens = [
    'KOT', 'KITCHEN ORDER', 'KITCHEN ORDER TICKET', 'BOT', 'BAR ORDER',
    'ESTIMATE ONLY', 'PROFORMA INVOICE', 'DRAFT INVOICE', 'ORDER TICKET',
    'TABLE NO', 'RUNNING KOT', 'DUPLICATE COPY'
  ];

  for (const token of blacklistTokens) {
    // Check if token exists prominently as a title or standalone keyword
    if (upper.includes(token)) {
      return {
        isFinalBill: false,
        docType: 'KOT_OR_ESTIMATE',
        matchedToken: token
      };
    }
  }

// Whitelist Tokens for valid settlement bills
  const whitelistTokens = [
    'TAX INVOICE', 'FINAL BILL', 'CASH MEMO', 'RETAIL INVOICE',
    'TOTAL AMOUNT', 'GRAND TOTAL', 'NET PAYABLE', 'NET AMOUNT',
    'PAID VIA', 'GST INVOICE', 'INVOICE NO', 'BILL NO', 'BILL #', 'TOTAL:',
    'TOTAL', 'RECEIPT', 'CUSTOMER', 'MOBILE', 'PHONE', 'AMOUNT', 'INV'
  ];

  const matchedWhitelist = whitelistTokens.filter(token => upper.includes(token));
  const hasPhonePattern = /(?:(?:\+|0{0,2})91[\s.-]?)?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9})/.test(upper);

  if (matchedWhitelist.length >= 1 || hasPhonePattern) {
    return {
      isFinalBill: true,
      docType: 'TAX_INVOICE',
      matchedTokens: matchedWhitelist.length > 0 ? matchedWhitelist : ['PHONE_NUMBER_DETECTED']
    };
  }

  return {
    isFinalBill: false,
    docType: 'UNKNOWN_OR_INSUFFICIENT_METADATA',
    matchedTokens: []
  };
}

/**
 * Category D1: In-Memory Raster ESC/POS Bitmap Decoder (GS v 0 / ESC *)
 */
export function isRasterBitmapPayload(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  // Look for GS v 0 (0x1D, 0x76, 0x30) or ESC * (0x1B, 0x2A)
  for (let i = 0; i < Math.min(buffer.length - 3, 256); i++) {
    if (buffer[i] === 0x1D && buffer[i+1] === 0x76 && buffer[i+2] === 0x30) {
      return true;
    }
    if (buffer[i] === 0x1B && buffer[i+1] === 0x2A) {
      return true;
    }
  }
  return false;
}

/**
 * Category B1, B2, B3, B6, D1: Universal Receipt Parser Engine
 */
export function parseReceiptStream(rawInput, storeConfig = null) {
  const config = storeConfig || storage.getConfig();
  let text = '';
  let isRaster = false;

  if (Buffer.isBuffer(rawInput)) {
    if (isRasterBitmapPayload(rawInput)) {
      isRaster = true;
      text = rawInput.toString('latin1').replace(/[^\x20-\x7E\r\n\t]/g, ' ');
    } else {
      // 1. Try standard utf-8
      const utf8Str = rawInput.toString('utf8');
      const classUtf8 = classifyDocument(utf8Str);
      
      if (classUtf8.isFinalBill) {
        text = utf8Str;
      } else {
        // 2. Try UTF-16LE (common in Windows GDI / Notepad spool EMF records)
        let utf16Str = '';
        try { utf16Str = rawInput.toString('utf16le').replace(/[^\x20-\x7E\r\n\t]/g, ' '); } catch (e) {}
        const classUtf16 = classifyDocument(utf16Str);
        
        if (classUtf16.isFinalBill) {
          text = utf16Str;
        } else {
          // 3. Extract contiguous printable ASCII strings from binary spool buffer
          const rawLatin = rawInput.toString('latin1');
          const matches = rawLatin.match(/[\x20-\x7E\r\n\t]{3,}/g) || [];
          const extractedAscii = matches.join('\n');
          const classAscii = classifyDocument(extractedAscii);
          text = classAscii.isFinalBill ? extractedAscii : utf8Str;
        }
      }
    }
  } else {
    text = String(rawInput || '');
  }

  // 1. Classify Document (Category B2)
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

  // 2. Extract Lines & Implement Category B1: Dual-Zone Parsing
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const totalLines = lines.length;
  const headerCutoffIndex = Math.max(1, Math.floor(totalLines * 0.25));

  // Top 25% is Header Zone, remaining is Body/Footer Zone
  const headerLines = lines.slice(0, headerCutoffIndex);
  const bodyFooterLines = lines.slice(headerCutoffIndex);

  // 3. Extract Invoice Number
  let invoiceNo = null;
  const invRegex = /(?:Bill\s*(?:No|#)?|Inv(?:oice)?\s*(?:No|#)?|Cash\s*Memo\s*#?)[\s.:#-]*([A-Z0-9\/-]{3,20})/i;
  for (const line of lines) {
    const m = line.match(invRegex);
    if (m && m[1]) {
      invoiceNo = m[1].trim();
      break;
    }
  }
  if (!invoiceNo) {
    invoiceNo = `INV-${Date.now().toString().slice(-5)}`;
  }

  // 4. Extract Total Amount
  let totalAmount = null;
  const totalRegex = /(?:Total\s*Amount|Grand\s*Total|Net\s*(?:Payable|Amount)|TOTAL|Amount\s*Due)[\s.:$₹Rs]*([0-9,]+\.?[0-9]{0,2})/i;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(totalRegex);
    if (m && m[1]) {
      totalAmount = m[1].replace(/,/g, '');
      break;
    }
  }
  if (!totalAmount) {
    totalAmount = '0.00';
  }

  // 5. Extract Customer Name (if available)
  let customerName = 'Valued Customer';
  const nameRegex = /(?:Customer|Cust|Name|Party|Guest)[\s.:#-]+([A-Za-z\s]{3,30})/i;
  for (const line of lines) {
    const m = line.match(nameRegex);
    if (m && m[1] && !m[1].toUpperCase().includes('MOBILE') && !m[1].toUpperCase().includes('TOTAL')) {
      customerName = m[1].trim();
      break;
    }
  }

  // 6. Category B1, B3, B6: Find and Validate Customer Phone Number
  // Search strictly in Body/Footer Zone first
  const phonePattern = /(?:(?:\+|0{0,2})91[\s.-]?)?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9})/g;
  
  let validPhone = null;
  let candidateMatches = [];

  // Inspect Body & Footer lines
  for (const line of bodyFooterLines) {
    let match;
    while ((match = phonePattern.exec(line)) !== null) {
      candidateMatches.push({ phone: match[0], zone: 'BODY_FOOTER' });
    }
  }

  // Also check Header lines to track collisions
  for (const line of headerLines) {
    let match;
    while ((match = phonePattern.exec(line)) !== null) {
      candidateMatches.push({ phone: match[0], zone: 'HEADER_STORE' });
    }
  }

  // Prioritize candidates found in Body/Footer
  for (const item of candidateMatches) {
    const validation = validateIndianMobile(item.phone, config.storePhone);
    if (validation.valid) {
      if (item.zone === 'HEADER_STORE') {
        // If it was in the header, only accept if no other number exists and it's not the store owner
        if (!validPhone) {
          validPhone = validation;
        }
      } else {
        validPhone = validation;
        break; // Priority found in body/footer!
      }
    } else if (validation.reason === 'STORE_OWNER_NUMBER_COLLISION') {
      storage.incrementMetric('storeOwnerNumbersFiltered');
    } else if (validation.reason.includes('DUMMY') || validation.reason.includes('LOW_ENTROPY')) {
      storage.incrementMetric('dummyNumbersRejected');
    }
  }

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
      rawText: text
    };
  }

  // 7. Category B4: 24-Hour SHA-256 Idempotency Duplicate Suppression
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
      isRaster
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
    rawText: text
  };
}
