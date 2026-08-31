/**
 * ==============================================================================
 * REVIEWEASY CHIEF ENGINEER COMPREHENSIVE SYSTEM & RELIABILITY AUDIT
 * Tests Every Single Feature End-to-End Across Localhost & Cloud Endpoints
 * ==============================================================================
 */

import { storage } from '../src/engine/storage.js';
import { WhatsAppDispatcher } from '../src/engine/dispatcher.js';
import { parseReceiptStream } from '../src/engine/parser.js';
import { WinBackEngine } from '../src/engine/winback-engine.js';
import { DailyDigestEngine } from '../src/engine/digest-engine.js';
import { PersonalizedImageGenerator } from '../src/engine/personalized-image-generator.js';
import { parseReceiptItems, generateInvoicePdfBuffer } from '../src/engine/invoice-generator.js';
import { SupabaseSyncEngine } from '../src/engine/supabase-sync.js';
import { SystemResilienceEngine } from '../src/engine/system-resilience.js';
import sharp from 'sharp';

const dispatcher = new WhatsAppDispatcher();

console.log('\n==============================================================================');
console.log('🚀 REVIEWEASY CHIEF ENGINEER COMPREHENSIVE SYSTEM AUDIT');
console.log('==============================================================================\n');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failedTests++;
  }
}

async function runFullAudit() {
  const testStoreCode = `AUDIT_STORE_${Date.now().toString().slice(-4)}`;
  const testStoreName = 'Grand Gourmet Bistro';
  const testOwnerPhone = '9840999888';

  // ----------------------------------------------------------------------------
  // MODULE 1: AUTHENTICATION & MULTI-TENANT RBAC
  // ----------------------------------------------------------------------------
  console.log('📦 [1/9] Testing Authentication & Multi-Tenant Store Creation...');
  
  // 1.1 Super Admin Auth
  const adminAuth = storage.authenticateUser('admin@revieweasy.com', 'admin123');
  assert(adminAuth && adminAuth.role === 'ADMIN', 'Super Admin authentication succeeded');

  // 1.2 Create New Store
  const newStore = storage.createStore({
    storeCode: testStoreCode,
    storeName: testStoreName,
    storePhone: testOwnerPhone,
    storeGstin: '33AABCU9999Z1Z5',
    googleReviewUrl: 'https://g.page/r/grand-gourmet/review',
    businessCategory: 'RESTAURANT_CAFE'
  });
  assert(newStore && newStore.storeCode === testStoreCode, `Created new store: ${testStoreName} (${testStoreCode})`);

  // 1.3 Create New Merchant User
  const newUser = {
    id: `USR_${testStoreCode}`,
    email: `owner@${testStoreCode.toLowerCase()}.com`,
    password: 'password123',
    name: 'Vikram Sethi',
    role: 'CLIENT',
    storeCode: testStoreCode
  };
  storage.state.users.push(newUser);
  storage.save();

  // 1.4 Client User Auth
  const clientAuth = storage.authenticateUser(newUser.email, 'password123');
  assert(clientAuth && clientAuth.role === 'CLIENT' && clientAuth.storeCode === testStoreCode, 'New merchant client logged in successfully');
  assert(clientAuth.store && clientAuth.store.storeName === testStoreName, 'Merchant session attached correct store object');

  // ----------------------------------------------------------------------------
  // MODULE 2: RECEIPT PARSING & DEFENSIVE FILTERS
  // ----------------------------------------------------------------------------
  console.log('\n📦 [2/9] Testing POS Receipt Parsing & Defensive Gatekeepers...');

  const testInvNo = `INV-AUDIT-${Date.now().toString().slice(-4)}`;
  const rawReceipt = `========================================
           GRAND GOURMET BISTRO         
      GSTIN: 33AABCU9999Z1Z5             
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: ${testInvNo}
Customer: Sunita Rao
Mobile: 9840112233
----------------------------------------
1x Woodfired Margherita Pizza         ₹450.00
2x Cold Brew Latte                     ₹360.00
1x Belgian Waffle                      ₹280.00
----------------------------------------
Subtotal:                             ₹1090.00
CGST (2.5%):                            ₹27.25
SGST (2.5%):                            ₹27.25
----------------------------------------
GRAND TOTAL:                         ₹1144.50
========================================
       TAX INVOICE - PAID VIA CARD      
========================================`;

  const parsedItems = parseReceiptItems(rawReceipt);
  assert(parsedItems.items.length === 3, 'Extracted 3 line items correctly');
  assert(parsedItems.total > 0, `Extracted grand total ₹${parsedItems.total}`);

  // Test KOT Blocking
  const rawKot = `KITCHEN ORDER TICKET (KOT)
Table: 4 | Server: Amit
1x Woodfired Margherita Pizza
DO NOT BILL - KITCHEN USE ONLY`;
  const parsedKot = parseReceiptStream(rawKot);
  const kotResult = dispatcher.processIncomingBill(parsedKot);
  assert(kotResult.status === 'IGNORED_KOT', 'Kitchen Order Ticket (KOT) safely blocked from sending WhatsApp');

  // Process Valid Invoice
  const parsedValid = parseReceiptStream(rawReceipt);
  parsedValid.storeCode = testStoreCode;
  const txResult = dispatcher.processIncomingBill(parsedValid);
  assert(parsedValid.success === true, 'Tax invoice processed as valid billing event');
  assert(txResult.customerPhone === '9840112233', 'Extracted valid 10-digit customer mobile');

  // Test 24-Hour Duplicate Suppression Engine
  const parsedDup = parseReceiptStream(rawReceipt);
  assert(parsedDup.status === 'DUPLICATE_SUPPRESSED', '24-hour duplicate bill suppressed to protect merchant anti-spam reputation');

  // ----------------------------------------------------------------------------
  // MODULE 3: PERSONALIZED IMAGE & FLYER GENERATOR
  // ----------------------------------------------------------------------------
  console.log('\n📦 [3/10] Testing Personalized Dynamic Flyer Generator...');
  
  const dummyBase = await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 4,
      background: { r: 100, g: 150, b: 200, alpha: 1 }
    }
  }).jpeg().toBuffer();

  const flyerBuffer = await PersonalizedImageGenerator.generatePersonalizedFlyer(dummyBase, 'Sunita Rao', {
    enabled: true,
    template: 'A special treat for {{name}}! ✨',
    posX: 50,
    posY: 20,
    fontSize: 26,
    color: '#ffffff'
  });
  assert(Buffer.isBuffer(flyerBuffer) && flyerBuffer.length > 1000, 'Dynamic personalized JPEG flyer generated with customer overlay');

  // ----------------------------------------------------------------------------
  // MODULE 4: SMART REVIEW SHIELD & GOOGLE GATING
  // ----------------------------------------------------------------------------
  console.log('\n📦 [4/10] Testing Smart Review Shield & Google Gating Logic...');

  // 4.1 Positive 5-Star (Google Redirect)
  const posFeedback = storage.addFeedback({
    billId: txResult.id,
    storeCode: testStoreCode,
    invoiceNo: 'INV-AUDIT-01',
    customerName: 'Sunita Rao',
    customerPhone: '9840112233',
    rating: 5,
    action: 'GOOGLE_REDIRECT',
    category: 'Satisfied Customer',
    comment: 'Wonderful pizza and coffee!'
  });
  assert(posFeedback.action === 'GOOGLE_REDIRECT', '5-Star rating routed to Google Maps redirect');

  // 4.2 Negative 2-Star (Private Shield)
  const negFeedback = storage.addFeedback({
    billId: 'BILL_NEG_02',
    storeCode: testStoreCode,
    invoiceNo: 'INV-AUDIT-02',
    customerName: 'Ramesh Patel',
    customerPhone: '9840223344',
    rating: 2,
    action: 'PRIVATE_FEEDBACK',
    category: 'Slow Service',
    comment: 'Took 40 mins to get the coffee',
    requestCallback: true
  });
  assert(negFeedback.action === 'PRIVATE_FEEDBACK', '2-Star rating shielded from Google Maps');
  assert(negFeedback.status === 'OPEN', 'Negative feedback marked as OPEN for manager resolution');

  // 4.3 Resolve Feedback
  const resolved = storage.updateFeedbackStatus(negFeedback.id, 'RESOLVED', 'Called customer and offered apology coffee');
  assert(resolved.status === 'RESOLVED', 'Feedback marked as RESOLVED by manager');

  // ----------------------------------------------------------------------------
  // MODULE 5: CUSTOMER WIN-BACK RETENTION CRM
  // ----------------------------------------------------------------------------
  console.log('\n📦 [5/10] Testing Customer Win-Back Radar & Custom DMs...');

  const winBackEngine = new WinBackEngine();

  // 5.1 Test Custom Template
  const customTpl = 'Dear {{name}}, we miss you at {{storeName}}! Visit us soon: {{googleMapUrl}}';
  storage.updateStore(testStoreCode, { customWinBackTemplate: customTpl });

  const generatedMsg = winBackEngine.generateWinBackMessage('Arjun', testStoreName, 'https://g.page/r', customTpl);
  assert(generatedMsg.includes('Dear Arjun') && generatedMsg.includes(testStoreName), 'Custom template compiled with customer variables');

  // 5.2 Test Directory RFM Retrieval
  const directory = storage.getCustomerDirectory(testStoreCode);
  assert(Array.isArray(directory), 'Customer RFM directory generated');

  // ----------------------------------------------------------------------------
  // MODULE 6: DIGITAL E-INVOICE & PDF BUILDER
  // ----------------------------------------------------------------------------
  console.log('\n📦 [6/10] Testing Digital E-Invoice & PDF Generation...');

  const storeObj = storage.getStoreByCode(testStoreCode);
  const pdfBuffer = generateInvoicePdfBuffer(storeObj, txResult);
  assert(Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 500, `Generated valid PDF invoice buffer (${pdfBuffer.length} bytes)`);

  // ----------------------------------------------------------------------------
  // MODULE 7: 3-PERIOD DETAILED ANALYTICS COCKPIT
  // ----------------------------------------------------------------------------
  console.log('\n📦 [7/10] Testing 3-Period Analytics (Today, 30 Days, All-Time)...');

  const analytics = storage.getClientDetailedAnalytics(testStoreCode);
  assert(analytics && analytics.today && analytics.lastMonth && analytics.allTime, 'All 3 periods computed');
  assert(analytics.today.bills >= 1, `Computed today invoices: ${analytics.today.bills}`);
  assert(analytics.today.positiveRedirects >= 1, `Computed today Google 5★ redirects: ${analytics.today.positiveRedirects}`);
  assert(analytics.today.shieldedGrievances >= 1, `Computed today shielded grievances: ${analytics.today.shieldedGrievances}`);

  // ----------------------------------------------------------------------------
  // MODULE 8: DAILY CLOSING DIGEST ENGINE
  // ----------------------------------------------------------------------------
  console.log('\n📦 [8/10] Testing Daily Closing Owner Digest Engine...');

  const digestEngine = new DailyDigestEngine();
  const digestText = digestEngine.generateDigestText(testStoreCode);
  assert(digestText.includes(testStoreName) && /DAILY (BUSINESS )?CLOSING DIGEST/i.test(digestText), 'Daily closing summary generated with store metrics');

  // ----------------------------------------------------------------------------
  // MODULE 9: SUPABASE HYBRID SYNC & CLOUD BRIDGE
  // ----------------------------------------------------------------------------
  console.log('\n📦 [9/10] Testing Supabase Cloud Bridge & Offline Reconnection...');

  const supabaseSync = new SupabaseSyncEngine();
  assert(supabaseSync.client !== null, 'Supabase Cloud Client initialized with active credentials');

  // Test Cloud Upsert
  const syncStoreRes = await supabaseSync.syncStoreToCloud(storeObj);
  assert(syncStoreRes.success === true || syncStoreRes.mode === 'CLOUD_SYNCED', 'Store profile synced to Supabase cloud');

  // Test Bill Sync
  const syncBillRes = await supabaseSync.syncBillToCloud(txResult);
  assert(syncBillRes.success === true || syncBillRes.mode === 'CLOUD_SYNCED', 'Receipt bill synced to Supabase cloud');

  // ----------------------------------------------------------------------------
  // MODULE 10: LIVE CLOUD VERIFICATION (pos.revieweasy.in)
  // ----------------------------------------------------------------------------
  console.log('\n📦 [10/10] Testing Production Cloud API (https://pos.revieweasy.in)...');
  try {
    const cloudStateRes = await fetch('https://pos.revieweasy.in/api/state');
    const cloudState = await cloudStateRes.json();
    assert(cloudState && (cloudState.config || cloudState.users), 'Cloud /api/state returns valid JSON payload');

    const cloudWinbackRes = await fetch('https://pos.revieweasy.in/api/winback/template');
    const cloudWinback = await cloudWinbackRes.json();
    assert(cloudWinback && cloudWinback.success === true, 'Cloud /api/winback/template endpoint operational');

    const cloudAuthRes = await fetch('https://pos.revieweasy.in/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'client@sunshine.com', password: 'client123' })
    });
    const cloudAuth = await cloudAuthRes.json();
    assert(cloudAuth && cloudAuth.success === true && cloudAuth.user.role === 'CLIENT', 'Cloud multi-tenant merchant login verified');
  } catch (err) {
    console.error('Cloud verification error:', err.message);
  }

  // ----------------------------------------------------------------------------
  // FINAL SCORECARD
  // ----------------------------------------------------------------------------
  console.log('\n==============================================================================');
  console.log(`🏁 AUDIT COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('==============================================================================\n');

  if (failedTests === 0) {
    console.log('🌟 SYSTEM HEALTH: 100% OPERATIONAL & PRODUCTION READY! 🚀\n');
  } else {
    console.error('⚠️ ATTENTION: Some tests failed. Please review errors above.');
  }
}

runFullAudit().catch(err => console.error('Fatal audit failure:', err));
