import assert from 'assert';
import { storage } from '../src/engine/storage.js';
import { SupabaseSyncEngine, getStoreConfigUuid, getBillUuid } from '../src/engine/supabase-sync.js';

/**
 * Full Sync Architecture End-to-End Audit & Verification Test
 * Recreates the reported bug scenario: Admin Account Creation -> Supabase Cloud Write -> Local Pull -> Authentication
 */
async function testSyncArchitecture() {
  console.log('🧪 RUNNING FULL SYNC ARCHITECTURE AUDIT SUITE...\n');

  const supabaseSync = new SupabaseSyncEngine();

  // Test 1: Unified Client & Connectivity
  console.log('Test 1: Unified Supabase Client Initialization');
  assert(supabaseSync.client !== null, 'Supabase client must be non-null');
  const { data: ping, error: pingErr } = await supabaseSync.client.from('bills').select('id').limit(1);
  assert(!pingErr, `Ping must succeed without error: ${pingErr?.message}`);
  console.log('  ✅ Passed: Supabase client connected to cloud endpoint.\n');

  // Test 2: Admin Account Creation & Cloud Persistence
  console.log('Test 2: Account Creation -> Supabase Cloud Persistence');
  const testStoreCode = `AUDIT_${Date.now().toString().slice(-4)}`;
  const testEmail = `audit_${testStoreCode.toLowerCase()}@revieweasy.in`;
  const testPassword = 'auditPassword123';

  const testStoreData = {
    storeCode: testStoreCode,
    storeName: 'Audit Test Cafe',
    storePhone: '9840112233',
    storeGstin: '33AABCS1429B1ZB',
    googleReviewUrl: 'https://g.page/r/audit-test/review',
    businessCategory: 'RESTAURANT_CAFE',
    clientEmail: testEmail,
    clientPassword: testPassword
  };

  const newStore = storage.createStore(testStoreData);
  const syncResult = await supabaseSync.syncStoreToCloud(newStore, {
    email: testEmail,
    password: testPassword
  });

  assert(syncResult.success, 'Store cloud sync must return success');
  console.log(`  ✅ Passed: Store [${testStoreCode}] created locally & synced to cloud.\n`);

  // Test 3: Confirm Row in Supabase Cloud DB
  console.log('Test 3: Confirm Record in Supabase Cloud DB');
  const cfgUuid = getStoreConfigUuid(testStoreCode);
  const { data: cloudStoreRow, error: cloudErr } = await supabaseSync.client
    .from('bills')
    .select('*')
    .eq('id', cfgUuid)
    .maybeSingle();

  assert(!cloudErr, `Supabase query must succeed: ${cloudErr?.message}`);
  assert(cloudStoreRow !== null, `Supabase must contain STORE_CONFIG row for ${testStoreCode}`);
  assert(cloudStoreRow.source === 'STORE_CONFIG', 'Row source must be STORE_CONFIG');
  const parsedConfig = JSON.parse(cloudStoreRow.raw_text);
  assert(parsedConfig.clientEmail.toLowerCase() === testEmail.toLowerCase(), 'Cloud stored email must match');
  assert(parsedConfig.clientPassword === testPassword, 'Cloud stored password must match');
  console.log('  ✅ Passed: Store configuration & credentials verified in Supabase Cloud table.\n');

  // Test 4: Simulate Local App Fresh Pull & Authentication
  console.log('Test 4: Simulate Local App Fresh Pull & Authentication');
  // Temporarily remove store from local disk state to simulate another clean PC
  storage.state.clientStores = storage.state.clientStores.filter(s => s.storeCode !== testStoreCode);
  storage.state.users = storage.state.users.filter(u => u.storeCode !== testStoreCode);
  storage.save();

  // Before pull, authentication should fail
  const failedAuth = storage.authenticateUser(testEmail, testPassword);
  assert(failedAuth === null, 'Authentication must fail before cloud sync on fresh machine');

  // Trigger cloud pull
  await supabaseSync.pullCloudStores();

  // After pull, authentication must succeed
  const successAuth = storage.authenticateUser(testEmail, testPassword);
  assert(successAuth !== null, 'Authentication must succeed after cloud sync pull');
  assert(successAuth.email.toLowerCase() === testEmail.toLowerCase(), 'Authenticated user email matches');
  assert(successAuth.storeCode === testStoreCode, 'Authenticated storeCode matches');
  console.log(`  ✅ Passed: User [${testEmail}] authenticated successfully after auto-pull.\n`);

  // Test 5: Cleanup Test Store from Supabase & Storage
  console.log('Test 5: Account Deletion & Cloud Cascade Cleanup');
  storage.deleteStore(testStoreCode);
  await supabaseSync.deleteStoreFromCloud(testStoreCode);

  const { data: deletedRow } = await supabaseSync.client
    .from('bills')
    .select('id, status, source')
    .eq('id', cfgUuid)
    .maybeSingle();

  assert(deletedRow && (deletedRow.status === 'DELETED' || deletedRow.source === 'DELETED_STORE'), 'Store record must be marked DELETED in Supabase');
  console.log(`  ✅ Passed: Store [${testStoreCode}] removed from local storage and marked DELETED in Supabase.\n`);

  console.log('================================================================');
  console.log('🎉 ALL 5 SYNC ARCHITECTURE AUDIT TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

testSyncArchitecture().catch(err => {
  console.error('❌ Audit Test Suite Failed:', err);
  process.exit(1);
});
