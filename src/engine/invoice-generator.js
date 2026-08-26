import fs from 'fs';
import path from 'path';

/**
 * Parses receipt text into structured line items, subtotals, and taxes
 */
export function parseReceiptItems(rawText = '') {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  let subtotal = 0;
  let cgst = 0;
  let sgst = 0;
  let total = 0;
  let paymentMethod = 'CASH / UPI';
  let dateStr = new Date().toLocaleDateString('en-IN');
  let timeStr = new Date().toLocaleTimeString('en-IN');

  for (const line of lines) {
    // Check Date / Time
    const dateMatch = line.match(/Date[:\s]+([\d\/\-\.\w]+)/i);
    if (dateMatch) dateStr = dateMatch[1];

    const timeMatch = line.match(/Time[:\s]+([\d\:\sAPMapm]+)/i);
    if (timeMatch) timeStr = timeMatch[1];

    // Check payment mode
    if (/UPI/i.test(line)) paymentMethod = 'UPI';
    else if (/CARD/i.test(line)) paymentMethod = 'CREDIT / DEBIT CARD';
    else if (/CASH/i.test(line)) paymentMethod = 'CASH';

    // Parse Item Lines (e.g., "1x Margherita Pizza ₹350.00" or "2x Chicken Biryani 450.00")
    const itemMatch = line.match(/^(\d+)x\s+([A-Za-z0-9\s\-\(\)\[\]\.\&]+?)\s+[₹Rs\.\s]*([\d,]+\.?\d*)$/i);
    if (itemMatch) {
      const qty = parseInt(itemMatch[1], 10);
      const name = itemMatch[2].trim();
      const price = parseFloat(itemMatch[3].replace(/,/g, ''));
      items.push({ qty, name, price, total: price });
    }

    // Parse Subtotal / CGST / SGST / Total
    const subMatch = line.match(/Subtotal[:\s]+[₹Rs\.\s]*([\d,]+\.?\d*)/i);
    if (subMatch) subtotal = parseFloat(subMatch[1].replace(/,/g, ''));

    const cgstMatch = line.match(/CGST.*?[:\s]+[₹Rs\.\s]*([\d,]+\.?\d*)/i);
    if (cgstMatch) cgst = parseFloat(cgstMatch[1].replace(/,/g, ''));

    const sgstMatch = line.match(/SGST.*?[:\s]+[₹Rs\.\s]*([\d,]+\.?\d*)/i);
    if (sgstMatch) sgst = parseFloat(sgstMatch[1].replace(/,/g, ''));

    const totMatch = line.match(/TOTAL.*?[:\s]+[₹Rs\.\s]*([\d,]+\.?\d*)/i);
    if (totMatch) total = parseFloat(totMatch[1].replace(/,/g, ''));
  }

  // Fallback if no specific item regex matched
  if (items.length === 0 && total > 0) {
    items.push({ qty: 1, name: 'Dining / Retail Order', price: total, total: total });
  }

  if (subtotal === 0 && total > 0) subtotal = total - cgst - sgst;
  if (total === 0 && items.length > 0) total = items.reduce((a, b) => a + b.total, 0) + cgst + sgst;

  return {
    items,
    subtotal: subtotal || total,
    cgst,
    sgst,
    total: total || subtotal,
    paymentMethod,
    dateStr,
    timeStr
  };
}

/**
 * Creates a valid, lightweight pure-JS PDF document buffer without heavy binary dependencies
 */
export function generateInvoicePdfBuffer(store, tx) {
  const storeName = store.storeName || 'Merchant Store';
  const gstin = store.storeGstin || '33AABCS1429B1ZB';
  const phone = store.storePhone || '9840012345';
  const invoiceNo = tx.invoiceNo || 'INV-1001';
  const customerName = tx.customerName || 'Valued Customer';
  const customerPhone = tx.customerPhone || 'N/A';
  const parsed = parseReceiptItems(tx.rawText || '');
  const total = tx.totalAmount || parsed.total || '0.00';

  // Construct PDF Content Streams
  const pdfLines = [];
  pdfLines.push(`%PDF-1.4`);
  
  // Object 1: Catalog
  pdfLines.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`);
  
  // Object 2: Pages
  pdfLines.push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`);
  
  // Object 3: Page (A4 format: 595 x 842 pt)
  pdfLines.push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj`);
  
  // Object 4 & 5: Fonts
  pdfLines.push(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`);
  pdfLines.push(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);

  // Stream text drawing commands
  let stream = `BT\n`;
  // Header: Store Name
  stream += `/F1 20 Tf\n50 780 Td\n(${escapePdf(storeName.toUpperCase())}) Tj\n`;
  
  // Subheader: GSTIN & Phone
  stream += `/F2 10 Tf\n0 -20 Td\n(GSTIN: ${escapePdf(gstin)}  |  Phone: +91 ${escapePdf(phone)}) Tj\n`;
  stream += `0 -15 Td\n(OFFICIAL TAX INVOICE) Tj\n`;
  
  // Divider
  stream += `0 -15 Td\n(----------------------------------------------------------------------------------------------------) Tj\n`;
  
  // Invoice Meta
  stream += `/F1 11 Tf\n0 -20 Td\n(Invoice #: ${escapePdf(invoiceNo)}      Date: ${escapePdf(parsed.dateStr)} ${escapePdf(parsed.timeStr)}) Tj\n`;
  stream += `/F2 11 Tf\n0 -16 Td\n(Billed To: ${escapePdf(customerName)}   |   Mobile: +91 ${escapePdf(customerPhone)}) Tj\n`;
  stream += `0 -15 Td\n(Payment Mode: ${escapePdf(parsed.paymentMethod)}) Tj\n`;
  
  // Table Header
  stream += `0 -20 Td\n(----------------------------------------------------------------------------------------------------) Tj\n`;
  stream += `/F1 11 Tf\n0 -16 Td\n(QTY    ITEM DESCRIPTION                                                   PRICE (INR)    TOTAL) Tj\n`;
  stream += `/F2 10 Tf\n0 -12 Td\n(----------------------------------------------------------------------------------------------------) Tj\n`;
  
  // Line Items
  for (const item of parsed.items) {
    const itemDesc = item.name.padEnd(50, ' ').slice(0, 50);
    const lineStr = `${String(item.qty).padEnd(6, ' ')} ${itemDesc} ₹${item.price.toFixed(2).padStart(10, ' ')}   ₹${item.total.toFixed(2)}`;
    stream += `0 -16 Td\n(${escapePdf(lineStr)}) Tj\n`;
  }
  
  // Summary Totals
  stream += `0 -20 Td\n(----------------------------------------------------------------------------------------------------) Tj\n`;
  if (parsed.cgst > 0 || parsed.sgst > 0) {
    stream += `0 -16 Td\n(Subtotal:                                                                               ₹${parsed.subtotal.toFixed(2)}) Tj\n`;
    stream += `0 -14 Td\n(CGST (2.5%):                                                                           ₹${parsed.cgst.toFixed(2)}) Tj\n`;
    stream += `0 -14 Td\n(SGST (2.5%):                                                                           ₹${parsed.sgst.toFixed(2)}) Tj\n`;
  }
  
  stream += `/F1 14 Tf\n0 -22 Td\n(GRAND TOTAL:                                                                 INR ${total}) Tj\n`;
  stream += `/F2 10 Tf\n0 -15 Td\n(----------------------------------------------------------------------------------------------------) Tj\n`;
  
  // Footer & Review Invitation
  stream += `0 -30 Td\n(Thank you for your business! Powered by ReviewEasy Digital Invoicing.) Tj\n`;
  stream += `0 -14 Td\n(Share your feedback online: ${escapePdf(store.googleReviewUrl || '')}) Tj\n`;
  stream += `ET\n`;

  // Object 6: Stream Contents
  const streamLength = Buffer.byteLength(stream, 'utf8');
  pdfLines.push(`6 0 obj\n<< /Length ${streamLength} >>\nstream\n${stream}\nendstream\nendobj`);

  // XREF Table
  let offset = 0;
  const xrefOffsets = [];
  let pdfString = '';
  for (const line of pdfLines) {
    xrefOffsets.push(offset);
    pdfString += line + '\n';
    offset = Buffer.byteLength(pdfString, 'utf8');
  }

  const xrefStart = offset;
  let xref = `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 0; i < 6; i++) {
    xref += String(xrefOffsets[i]).padStart(10, '0') + ` 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  pdfString += xref + trailer;

  return Buffer.from(pdfString, 'utf8');
}

function escapePdf(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ''); // ASCII printable
}
