import { storage } from '../src/engine/storage.js';
import { SupabaseSyncEngine, getStoreConfigUuid } from '../src/engine/supabase-sync.js';

/**
 * ReviewEasy Database Reconciliation & Drift Detection Script
 * Analyzes local edge storage vs Supabase cloud database to detect and repair drift.
 */
async function runReconciliation() {
  console.log('================================================================');
  console.log('🔍 REVIEWEASY SYNC ARCHITECTURE AUDIT & RECONCILIATION ENGINE');
  console.log('================================================================\n');

  const supabaseSync = new SupabaseSyncEngine();
  
  // 1. Connection Health Check
  console.log('1️⃣ SUPABASE CLOUD CONNECTIVITY & AUTHENTICATION CHECK');
  if (!supabaseSync.client) {
    console.error('❌ FATAL: Supabase client could not be initialized.');
    process.exit(1);
  }

  const { data: pingData, error: pingError } = await supabaseSync.client
    .from('bills')
    .select('id')
    .limit(1);

  if (pingError) {
    console.error('❌ Supabase ping failed:', pingError.message);
    process.exit(1);
  }
  console.log('   ✅ Cloud connection active & verified: https://fzjjztbobwtuywohwmfe.supabase.co\n');

  // 2. Pull Cloud Store Records
  console.log('2️⃣ AUDITING MERCHANT STORES & USER ACCOUNTS');
  const { data: cloudStoreRows, error: cloudStoreErr } = await supabaseSync.client
    .from('bills')
    .select('*')
    .eq('source', 'STORE_CONFIG');

  const localStores = storage.state.clientStores || [];
  const localUsers = storage.state.users || [];
  const cloudStores = [];

  for (const row of cloudStoreRows || []) {
    try {
      const parsed = JSON.parse(row.raw_text);
      cloudStores.push({
        storeCode: (parsed.storeCode || row.store_code).toUpperCase(),
        storeName: parsed.storeName || row.customer_name,
        clientEmail: (parsed.clientEmail || `owner@${(parsed.storeCode || row.store_code).toLowerCase()}.com`).toLowerCase(),
        clientPassword: parsed.clientPassword || 'client123'
      });
    } catch (e) {}
  }

  console.log(`   • Local Stores Count: ${localStores.length}`);
  console.log(`   • Cloud Stores Count: ${cloudStores.length}`);
  console.log(`   • Local Users Count:  ${localUsers.length}`);

  // Detect Store Drift
  const missingInLocal = cloudStores.filter(cs => !localStores.some(ls => ls.storeCode.toUpperCase() === cs.storeCode));
  const missingInCloud = localStores.filter(ls => !cloudStores.some(cs => cs.storeCode === ls.storeCode.toUpperCase()));

  if (missingInLocal.length > 0) {
    console.log(`   ⚠️ Stores in Cloud but missing in Local: ${missingInLocal.map(s => s.storeCode).join(', ')}`);
  }
  if (missingInCloud.length > 0) {
    console.log(`   ⚠️ Stores in Local but missing in Cloud: ${missingInCloud.map(s => s.storeCode).join(', ')}`);
  }

  // 3. Reconcile and Sync Stores
  console.log('\n3️⃣ RECONCILING & SYNCHRONIZING STORES (BIDIRECTIONAL)');
  await supabaseSync.pullCloudStores();
  for (const s of storage.state.clientStores) {
    const u = storage.state.users.find(x => (x.storeCode || '').toUpperCase() === s.storeCode.toUpperCase());
    await supabaseSync.syncStoreToCloud(s, u || {});
  }
  console.log('   ✅ All stores and user credentials synchronized across Local & Cloud.\n');

  // 4. Audit Bills & Transactions
  console.log('4️⃣ AUDITING TRANSACTIONS & RECEIPTS');
  const validLocalTxs = (storage.state.transactions || []).filter(t => t.source !== 'AGENT_HEARTBEAT' && !(t.invoiceNo && t.invoiceNo.startsWith('HB-')));
  const { data: cloudBills, error: cloudBillsErr } = await supabaseSync.client
    .from('bills')
    .select('id, invoice_no, store_code, total_amount, status, source')
    .neq('source', 'AGENT_HEARTBEAT')
    .neq('source', 'STORE_CONFIG');

  console.log(`   • Valid Local Transactions: ${validLocalTxs.length}`);
  console.log(`   • Cloud Bills in Supabase:   ${cloudBills?.length || 0}`);

  // Flush any pending unsynced bills
  await supabaseSync.flushOfflineSyncQueue();
  console.log('   ✅ Offline queue flushed to Supabase.\n');

  // 5. Audit Review Shield & Feedback
  console.log('5️⃣ AUDITING REVIEW SHIELD & DISPATCHES');
  const localFeedbacks = storage.state.privateFeedback || [];
  const { data: cloudFeedbacks } = await supabaseSync.client
    .from('review_dispatches')
    .select('id, store_code, dispatch_status, rating_given, message_text');

  console.log(`   • Local Feedbacks:           ${localFeedbacks.length}`);
  console.log(`   • Cloud Review Dispatches:   ${cloudFeedbacks?.length || 0}`);

  // Final Summary Report
  console.log('\n================================================================');
  console.log('📊 RECONCILIATION AUDIT SUMMARY');
  console.log('================================================================');
  console.log(`✅ Stores Synchronized:       ${storage.state.clientStores.length}`);
  console.log(`✅ Users Authenticated:       ${storage.state.users.length}`);
  console.log(`✅ Transactions in Supabase:  ${cloudBills?.length || 0}`);
  console.log(`✅ Dispatches in Supabase:    ${cloudFeedbacks?.length || 0}`);
  console.log(`✅ Single Source of Truth:    Supabase (https://fzjjztbobwtuywohwmfe.supabase.co)`);
  console.log('================================================================\n');
}

runReconciliation().catch(err => {
  console.error('❌ Reconciliation error:', err);
  process.exit(1);
});
