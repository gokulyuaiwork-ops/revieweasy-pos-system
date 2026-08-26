import { storage } from '../src/engine/storage.js';

const BASE_URL = 'http://127.0.0.1:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: res.status, data: await res.json() };
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('🧪 TESTING LAPSED CUSTOMER WIN-BACK ENGINE & ROI ATTRIBUTION');
  console.log('===============================================================\n');

  try {
    // Clear history to ensure clean test state
    await request('/api/clear-history', { method: 'POST' });

    const STORE_CODE = 'STORE_DEMO_01';
    const TEST_PHONE = `98401${Math.floor(10000 + Math.random() * 90000)}`;
    const CUSTOMER_NAME = 'Arjun Kapoor';

    // 1. Seed Historical Transaction (45 Days Ago) via Server API
    console.log('[Test 1] ⏳ Seeding Inactive Customer History (Last Visited 45 Days Ago)...');
    const fortyFiveDaysAgo = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)).toISOString();
    
    const historicalReceipt = `========================================
           SUNSHINE CAFE & BISTRO       
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: 01/07/2026      Bill #: INV-HIST-490
Customer: Arjun Kapoor
Mobile: ${TEST_PHONE}
----------------------------------------
1x Cold Brew Coffee                   ₹220.00
1x Blueberry Muffin                   ₹180.00
----------------------------------------
TOTAL AMOUNT:                     ₹400.00
========================================
              TAX INVOICE               
========================================`;

    await request('/api/simulate-print', {
      method: 'POST',
      body: {
        rawText: historicalReceipt,
        customTimestamp: fortyFiveDaysAgo,
        storeCode: STORE_CODE
      }
    });
    console.log('  ✅ Seeded bill from 45 days ago via server API.');

    // 2. Query Customer Directory & RFM Segmentation
    console.log('\n[Test 2] 🔍 Testing GET /api/winback/customers & Segmentation...');
    const custRes = await request(`/api/winback/customers?storeCode=${STORE_CODE}`);
    if (custRes.status !== 200 || !custRes.data.success) throw new Error('Customer directory fetch failed');

    const customer = custRes.data.customers.find(c => c.phone === TEST_PHONE);
    if (!customer) throw new Error('Seeded customer not found in directory');

    console.log(`  ✅ Customer Identified: "${customer.name}" (+91 ${customer.phone})`);
    console.log(`  📅 Days Inactive: ${customer.daysSinceLastVisit} days`);
    console.log(`  🏷️ Segment: ${customer.segment} (Expected: LAPSED)`);
    console.log(`  🎯 Win-Back Eligibility: ${customer.winBackStatus}`);

    if (customer.segment !== 'LAPSED') {
      throw new Error(`Expected segment LAPSED, got ${customer.segment}`);
    }

    // 3. Dispatch Warm Win-Back Invitation (Verify NO discount/voucher)
    console.log('\n[Test 3] 💬 Testing Win-Back Dispatch (NO Discount / Pure Relationship)...');
    const dispatchRes = await request('/api/winback/dispatch', {
      method: 'POST',
      body: {
        storeCode: STORE_CODE,
        customerPhone: TEST_PHONE
      }
    });

    if (dispatchRes.status !== 200 || !dispatchRes.data.success) throw new Error('Win-Back dispatch failed');
    console.log('  ✅ Win-Back message successfully dispatched!');
    console.log('  📝 Message Preview:\n');
    console.log('  -------------------------------------------------------------');
    console.log('  ' + dispatchRes.data.messagePreview.split('\n').join('\n  '));
    console.log('  -------------------------------------------------------------');

    // Verify no discount or voucher text exists
    const msgLower = dispatchRes.data.messagePreview.toLowerCase();
    const hasDiscount = msgLower.includes('discount') || msgLower.includes('% off') || msgLower.includes('voucher') || msgLower.includes('coupon');
    if (hasDiscount) {
      throw new Error('Message contains discount/voucher words, which was explicitly forbidden!');
    }
    console.log('  ✅ Confirmed: 0% discount / 0% voucher references in win-back message.');

    // 4. Test Customer Return & Closed-Loop ROI Attribution
    console.log('\n[Test 4] 💰 Testing Customer Re-Visit & Closed-Loop ROI Attribution...');
    const returnReceiptText = `========================================
           SUNSHINE CAFE & BISTRO       
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-WINBACK-RECOVERED
Customer: Arjun Kapoor
Mobile: ${TEST_PHONE}
----------------------------------------
2x Signature Hazelnut Cold Brew       ₹380.00
1x Avocado Sourdough Toast            ₹320.00
1x Blueberry Cheesecake               ₹250.00
----------------------------------------
TOTAL AMOUNT:                     ₹950.00
========================================
    TAX INVOICE - RECOVERED WIN-BACK    
========================================`;

    const simPrintRes = await request('/api/simulate-print', {
      method: 'POST',
      body: {
        rawText: returnReceiptText,
        storeCode: STORE_CODE
      }
    });

    if (simPrintRes.status !== 200 || !simPrintRes.data.success) throw new Error('Simulated print failed');
    console.log(`  ✅ Customer Re-visit bill processed (#${simPrintRes.data.transaction.invoiceNo}) for ₹${simPrintRes.data.transaction.totalAmount}`);
    console.log(`  🎯 Is Win-Back Recovered Flag: ${simPrintRes.data.transaction.isWinBackRecovered}`);

    if (!simPrintRes.data.transaction.isWinBackRecovered) {
      throw new Error('Transaction was not flagged as isWinBackRecovered!');
    }

    // 5. Verify Win-Back Analytics Dashboard Data
    console.log('\n[Test 5] 📊 Verifying Win-Back Analytics & Recovered Revenue...');
    const analyticsRes = await request(`/api/winback/analytics?storeCode=${STORE_CODE}`);
    if (analyticsRes.status !== 200 || !analyticsRes.data.success) throw new Error('Win-back analytics fetch failed');

    const a = analyticsRes.data.analytics;
    console.log(`  💬 Win-Backs Sent        : ${a.winBacksSent}`);
    console.log(`  🔄 Customers Recovered   : ${a.customersRecovered}`);
    console.log(`  📈 Recovery Rate         : ${a.recoveryRate}%`);
    console.log(`  💰 Total Recovered Sales : ₹${a.totalRecoveredRevenue.toFixed(2)} (Expected: ₹950.00)`);

    if (a.customersRecovered < 1 || a.totalRecoveredRevenue < 950) {
      throw new Error(`Attribution error: Expected >= ₹950 recovered, got ₹${a.totalRecoveredRevenue}`);
    }

    console.log('\n===============================================================');
    console.log('🎉 ALL WIN-BACK & ATTRIBUTION TESTS PASSED (100% SUCCESS)');
    console.log('===============================================================\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

runTests();
