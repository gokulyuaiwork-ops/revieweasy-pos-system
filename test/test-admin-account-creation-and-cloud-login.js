import { SupabaseSyncEngine } from '../src/engine/supabase-sync.js';
import { storage } from '../src/engine/storage.js';

console.log('--- TEST: ADMIN CREATED ACCOUNT TO SUPABASE & CLOUD LOGIN ---');

const supabaseSync = new SupabaseSyncEngine();

async function run() {
  const testStoreCode = 'STORE_TEST_AUTO';
  const testEmail = 'manager@testauto.com';
  const testPassword = 'auto123';
  const testStoreName = 'Test Auto Care';

  console.log('\n1. Admin creating new store account...');
  const newStore = storage.createStore({
    storeCode: testStoreCode,
    storeName: testStoreName,
    storePhone: '9840112233',
    googleReviewUrl: 'https://g.page/testauto/review',
    businessCategory: 'AUTOMOBILE_SERVICE',
    clientEmail: testEmail,
    clientPassword: testPassword
  });

  console.log('✅ Store created in storage:', newStore.storeName);

  console.log('\n2. Syncing newly created store to Supabase Cloud...');
  const syncRes = await supabaseSync.syncStoreToCloud(newStore, {
    email: testEmail,
    password: testPassword
  });
  console.log('✅ Sync response:', syncRes);

  console.log('\n3. Verifying record in Supabase bills table...');
  const { data: cloudStore } = await supabaseSync.client
    .from('bills')
    .select('*')
    .eq('source', 'STORE_CONFIG')
    .eq('store_code', testStoreCode);

  console.log('✅ Retrieved from Supabase:', cloudStore?.length > 0 ? cloudStore[0].store_code : 'NOT FOUND');

  console.log('\n4. Simulating Cloud Serverless Cold Boot (Clearing in-memory cache)...');
  storage.state.clientStores = [];
  storage.state.users = [
    {
      id: "USR_ADMIN_01",
      email: "admin@revieweasy.com",
      password: "admin123",
      name: "SaaS Administrator",
      role: "ADMIN"
    }
  ];

  console.log('\n5. Attempting Cloud Login with Email & Password...');
  const { data: allConfigs } = await supabaseSync.client
    .from('bills')
    .select('*')
    .eq('source', 'STORE_CONFIG');

  for (const row of allConfigs) {
    const cfg = JSON.parse(row.raw_text);
    const sCode = (cfg.storeCode || row.store_code).toUpperCase();
    const sEmail = (cfg.clientEmail || cfg.email).toLowerCase();
    const sPass = cfg.clientPassword || cfg.password || 'client123';

    storage.state.clientStores.push({
      ...cfg,
      storeCode: sCode,
      status: 'ACTIVE'
    });

    storage.state.users.push({
      id: `USR_${sCode}`,
      email: sEmail,
      password: sPass,
      name: cfg.storeName,
      role: 'CLIENT',
      storeCode: sCode
    });
  }

  const userByEmail = storage.authenticateUser(testEmail, testPassword);
  console.log('Login by Email:', userByEmail ? `✅ SUCCESS (${userByEmail.name}, ${userByEmail.storeCode})` : '❌ FAILED');

  const userByCode = storage.authenticateUser(testStoreCode, testPassword);
  console.log('Login by StoreCode:', userByCode ? `✅ SUCCESS (${userByCode.name}, ${userByCode.storeCode})` : '❌ FAILED');

  console.log('\n6. Cleaning up test account from Supabase...');
  await supabaseSync.client.from('bills').delete().eq('store_code', testStoreCode);
  storage.deleteStore(testStoreCode);
  console.log('✅ Cleanup complete.');

  process.exit(0);
}

run();
