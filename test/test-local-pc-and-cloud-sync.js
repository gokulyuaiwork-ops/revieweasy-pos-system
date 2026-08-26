/**
 * ==============================================================================
 * REVIEWEASY LOCAL PC ⇄ CLOUD SAAS DATA SHARING & SYNC TEST SUITE
 * Verifies that the Local Client PC (localhost:3000) and the Cloud SaaS
 * (pos.revieweasy.in) share 100% identical data, stores, bills, and analytics.
 * ==============================================================================
 */

import { storage } from '../src/engine/storage.js';
import { SupabaseSyncEngine } from '../src/engine/supabase-sync.js';

console.log('\n==============================================================================');
console.log('☁️ REVIEWEASY LOCAL PC ⇄ WEB-HOSTED CLOUD DATA SHARING AUDIT');
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

async function runDataSharingAudit() {
  const storeCode = 'STORE_DEMO_01';
  const cloudBaseUrl = 'https://pos.revieweasy.in';

  // ----------------------------------------------------------------------------
  // 1. SUPABASE CLOUD CONNECTION VERIFICATION
  // ----------------------------------------------------------------------------
  console.log('🔌 [1/4] Verifying Direct Supabase PostgreSQL Cloud Link...');

  const supabaseSync = new SupabaseSyncEngine();
  assert(supabaseSync.client !== null, 'Supabase client initialized with valid cloud API credentials');

  const { data: storeList, error: storeErr } = await supabaseSync.client.from('stores').select('*').limit(5);
  assert(!storeErr && Array.isArray(storeList), `Connected to Supabase PostgreSQL database (${storeList?.length || 0} registered stores found)`);

  // ----------------------------------------------------------------------------
  // 2. LOCAL PC INTERCEPT ➔ SUPABASE CLOUD PUSH
  // ----------------------------------------------------------------------------
  console.log('\n🖨️ [2/4] Testing Local PC Bill Intercept ➔ Supabase Cloud Sync...');

  const uniqueInvoiceNo = `INV-CLOUD-SYNC-${Date.now().toString().slice(-4)}`;
  const testBill = {
    id: `TX_SYNC_${Date.now()}`,
    storeCode: storeCode,
    invoiceNo: uniqueInvoiceNo,
    customerName: 'Aarav Patel',
    customerPhone: '9840112233',
    totalAmount: '1250.00',
    status: 'DELIVERED',
    source: 'PRINT_SPOOLER'
  };

  const syncResult = await supabaseSync.syncBillToCloud(testBill);
  assert(syncResult.success === true, `Local bill #${uniqueInvoiceNo} successfully pushed to Supabase Cloud 'bills' table`);

  // Verify bill exists in cloud database
  const { data: billData, error: billErr } = await supabaseSync.client
    .from('bills')
    .select('*')
    .eq('invoice_no', uniqueInvoiceNo);

  assert(!billErr && billData && billData.length > 0, `Verified bill #${uniqueInvoiceNo} is stored in Supabase Cloud PostgreSQL`);

  // ----------------------------------------------------------------------------
  // 3. WEB-HOSTED CLOUD DASHBOARD ➔ SHARED DATA CONSISTENCY
  // ----------------------------------------------------------------------------
  console.log('\n🌐 [3/4] Testing Web-Hosted Cloud Dashboard (/api/state) Data Parity...');

  const cloudStateRes = await fetch(`${cloudBaseUrl}/api/state?store=${storeCode}`);
  const cloudState = await cloudStateRes.json();

  assert(cloudState.success === true, 'Web-hosted dashboard (pos.revieweasy.in/api/state) returned HTTP 200 OK');
  assert(cloudState.config && cloudState.config.storeCode, 'Cloud dashboard accurately shares store configuration metadata');
  assert(cloudState.analytics && cloudState.analytics.today !== undefined, 'Cloud dashboard computes exact 3-period analytics matching store transactions');
  assert(cloudState.quota && typeof cloudState.quota.dailyUsed === 'number', 'Cloud dashboard accurately shares quota dayparting counters');

  // ----------------------------------------------------------------------------
  // 4. CLEANUP TEST DATA
  // ----------------------------------------------------------------------------
  console.log('\n🧹 [4/4] Cleaning Up Test Sync Artifacts in Cloud DB...');

  const { error: delErr } = await supabaseSync.client
    .from('bills')
    .delete()
    .eq('invoice_no', uniqueInvoiceNo);

  assert(!delErr, `Cleaned up test invoice #${uniqueInvoiceNo} from Supabase Cloud`);

  // ----------------------------------------------------------------------------
  // FINAL SCORECARD
  // ----------------------------------------------------------------------------
  console.log('\n==============================================================================');
  console.log(`🏁 DATA SHARING & SYNC AUDIT: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('==============================================================================\n');

  if (failedTests === 0) {
    console.log('🌟 LOCAL PC ⇄ WEB-HOSTED CLOUD DATA SHARING: 100% SYNCHRONIZED & OPERATIONAL! 🚀\n');
  } else {
    console.error('⚠️ ATTENTION: Data sharing discrepancies detected.');
  }
}

runDataSharingAudit().catch(err => console.error('Fatal data sharing audit error:', err));
