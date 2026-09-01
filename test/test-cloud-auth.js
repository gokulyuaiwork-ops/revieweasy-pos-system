import { SupabaseSyncEngine } from '../src/engine/supabase-sync.js';
import { storage } from '../src/engine/storage.js';

console.log('Testing Cloud Supabase STORE_CONFIG Hydration & Login...');

const supabaseSync = new SupabaseSyncEngine();

async function testAuth(identifier, password) {
  const { data, error } = await supabaseSync.client
    .from('bills')
    .select('*')
    .eq('source', 'STORE_CONFIG');

  if (data) {
    for (const row of data) {
      const configData = typeof row.raw_text === 'string' ? JSON.parse(row.raw_text) : row.raw_text;
      const sCode = (configData.storeCode || row.store_code || '').toUpperCase();
      const sName = configData.storeName || sCode;
      const sEmail = (configData.clientEmail || configData.email || `owner@${sCode.toLowerCase().replace(/\s+/g, '')}.com`).toLowerCase();
      const sPass = configData.clientPassword || configData.password || 'client123';
      const sPhone = configData.storePhone || '';

      const storeObj = {
        id: configData.id || sCode,
        storeCode: sCode,
        storeName: sName,
        storePhone: sPhone,
        clientEmail: sEmail,
        clientPassword: sPass,
        status: 'ACTIVE'
      };

      const existingIdx = storage.state.clientStores.findIndex(s => s.storeCode === sCode);
      if (existingIdx >= 0) {
        storage.state.clientStores[existingIdx] = { ...storage.state.clientStores[existingIdx], ...storeObj };
      } else {
        storage.state.clientStores.push(storeObj);
      }
    }
  }

  const user = storage.authenticateUser(identifier, password);
  console.log(`Login attempt for [${identifier}] ->`, user ? `✅ SUCCESS (${user.name}, store: ${user.storeCode})` : '❌ FAILED');
  return user;
}

async function run() {
  await testAuth('owner@abcstore.com', 'client123');
  await testAuth('owner@login.com', 'client123');
  await testAuth('ABC STORE', 'client123');
  await testAuth('9342350747', 'client123');
  await testAuth('admin@revieweasy.com', 'admin123');
  process.exit(0);
}

run();
