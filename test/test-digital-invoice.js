import { parseReceiptItems, generateInvoicePdfBuffer } from '../src/engine/invoice-generator.js';

const BASE_URL = 'http://127.0.0.1:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) {
    const arrayBuffer = await res.arrayBuffer();
    return { status: res.status, buffer: Buffer.from(arrayBuffer) };
  }
  return { status: res.status, data: await res.json() };
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('🧪 TESTING DIGITAL E-BILL & WHATSAPP PDF INVOICING ENGINE');
  console.log('===============================================================\n');

  try {
    // 1. Test Receipt Item Parser
    console.log('[Test 1] 🧾 Testing Receipt Item & Tax Parser...');
    const sampleReceipt = `========================================
           SUNSHINE CAFE & BISTRO       
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: 16/08/2026      Bill #: INV-PDF-001
Customer: Priya Sundaram
Mobile: 9840188888
----------------------------------------
1x Truffle Mushroom Pasta             ₹450.00
2x Cold Brew Hazelnut                 ₹380.00
1x Tiramisu Classic                   ₹220.00
----------------------------------------
Subtotal:                             ₹1050.00
CGST (2.5%):                          ₹26.25
SGST (2.5%):                          ₹26.25
----------------------------------------
TOTAL AMOUNT:                         ₹1102.50
========================================
          TAX INVOICE - PAID VIA UPI    
========================================`;

    const parsed = parseReceiptItems(sampleReceipt);
    console.log(`  ✅ Parsed Items Count: ${parsed.items.length}`);
    console.log(`  ✅ Subtotal: ₹${parsed.subtotal}, CGST: ₹${parsed.cgst}, SGST: ₹${parsed.sgst}, Total: ₹${parsed.total}`);
    console.log(`  ✅ Payment Method: ${parsed.paymentMethod}`);

    if (parsed.items.length !== 3 || parsed.total !== 1102.5) {
      throw new Error(`Receipt item parsing failed! Expected 3 items & 1102.5 total, got ${parsed.items.length} items & ₹${parsed.total}`);
    }

    // 2. Test In-Memory Pure-JS PDF Generator
    console.log('\n[Test 2] 📄 Testing In-Memory Pure-JS PDF Generator...');
    const storeObj = {
      storeName: 'Sunshine Cafe & Bistro',
      storePhone: '9840012345',
      storeGstin: '33AABCS1429B1ZB',
      googleReviewUrl: 'https://g.page/r/sunshine-cafe/review'
    };
    const txObj = {
      id: 'TX_PDF_TEST_01',
      invoiceNo: 'INV-PDF-001',
      customerName: 'Priya Sundaram',
      customerPhone: '9840188888',
      totalAmount: '1102.50',
      rawText: sampleReceipt
    };

    const pdfBuffer = generateInvoicePdfBuffer(storeObj, txObj);
    const pdfHeader = pdfBuffer.slice(0, 8).toString('utf8');
    console.log(`  ✅ Generated PDF Buffer: ${pdfBuffer.length} bytes`);
    console.log(`  ✅ Valid PDF Signature: "${pdfHeader.trim()}"`);

    if (!pdfHeader.startsWith('%PDF-1.4')) {
      throw new Error(`Invalid PDF signature! Expected %PDF-1.4, got ${pdfHeader}`);
    }

    // 3. Test Store Account Creation with enableDigitalReceipts Flag (Admin API)
    console.log('\n[Test 3] 🏬 Testing Store Account Creation with Digital PDF Invoicing Flag...');
    const storeCodeEnabled = `STORE_PDF_${Math.floor(1000 + Math.random() * 9000)}`;
    const createRes1 = await request('/api/admin/clients', {
      method: 'POST',
      body: {
        storeCode: storeCodeEnabled,
        storeName: 'Sourdough Artisan Bakery',
        storePhone: '9876500001',
        googleReviewUrl: 'https://g.page/artisan/review',
        enableDigitalReceipts: true
      }
    });

    if (createRes1.status !== 200 || !createRes1.data.success) throw new Error('Create store with PDF enabled failed');
    console.log(`  ✅ Created Store [${storeCodeEnabled}] with enableDigitalReceipts: ${createRes1.data.store.enableDigitalReceipts}`);

    const storeCodeDisabled = `STORE_NOPDF_${Math.floor(1000 + Math.random() * 9000)}`;
    const createRes2 = await request('/api/admin/clients', {
      method: 'POST',
      body: {
        storeCode: storeCodeDisabled,
        storeName: 'Fast Express Chai',
        storePhone: '9876500002',
        googleReviewUrl: 'https://g.page/chai/review',
        enableDigitalReceipts: false
      }
    });

    if (createRes2.status !== 200 || !createRes2.data.success) throw new Error('Create store with PDF disabled failed');
    console.log(`  ✅ Created Store [${storeCodeDisabled}] with enableDigitalReceipts: ${createRes2.data.store.enableDigitalReceipts}`);

    // 4. Test Public Web E-Bill API (/api/bill-info/:id)
    console.log('\n[Test 4] 🌐 Testing GET /api/bill-info/:billId ...');
    const billInfoRes = await request(`/api/bill-info/TX_PDF_TEST_01?store=${storeCodeEnabled}`);
    if (billInfoRes.status !== 200 || !billInfoRes.data.success) throw new Error('Bill info fetch failed');
    console.log(`  ✅ Retrieved Digital E-Bill for Store: "${billInfoRes.data.store.storeName}"`);
    console.log(`  ✅ Items in E-Bill: ${billInfoRes.data.parsed.items.length}`);

    // 5. Test Public Web PDF Download API (/api/bill-pdf/:id)
    console.log('\n[Test 5] 📥 Testing GET /api/bill-pdf/:billId (Direct PDF Streaming)...');
    const pdfStreamRes = await request(`/api/bill-pdf/TX_PDF_TEST_01?store=${storeCodeEnabled}`);
    if (pdfStreamRes.status !== 200) throw new Error(`PDF download failed with status ${pdfStreamRes.status}`);
    const downloadedHeader = pdfStreamRes.buffer.slice(0, 8).toString('utf8');
    console.log(`  ✅ Successfully Streamed PDF: ${pdfStreamRes.buffer.length} bytes`);
    console.log(`  ✅ Stream Header: "${downloadedHeader.trim()}"`);

    if (!downloadedHeader.startsWith('%PDF-1.4')) {
      throw new Error(`Invalid streamed PDF header! Got ${downloadedHeader}`);
    }

    console.log('\n===============================================================');
    console.log('🎉 ALL DIGITAL E-BILL & PDF INVOICING TESTS PASSED (100%)');
    console.log('===============================================================\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

runTests();
