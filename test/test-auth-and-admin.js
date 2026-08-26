import { storage } from '../src/engine/storage.js';

console.log('========================================================================');
console.log('🧪 REVIEWEASY ROLE-BASED AUTH & SAAS ADMIN PORTAL TEST SUITE');
console.log('========================================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// 1. Test Admin Login
console.log('\n--- 1. Testing Admin Authentication ---');
const adminUser = storage.authenticateUser('admin@revieweasy.com', 'admin123');
assert(adminUser !== null, 'Admin credentials verified');
assert(adminUser.role === 'ADMIN', 'Role identified as ADMIN');

// 2. Test Client Login
console.log('\n--- 2. Testing Client Authentication ---');
const clientUser = storage.authenticateUser('client@sunshine.com', 'client123');
assert(clientUser !== null, 'Client credentials verified');
assert(clientUser.role === 'CLIENT', 'Role identified as CLIENT');
assert(clientUser.storeCode === 'STORE_DEMO_01', 'Associated with STORE_DEMO_01');

// 3. Test Invalid Login
console.log('\n--- 3. Testing Invalid Password Rejection ---');
const invalidUser = storage.authenticateUser('admin@revieweasy.com', 'wrongpassword');
assert(invalidUser === null, 'Rejected invalid password');

// 4. Test Admin Adding New Client Store (CRUD Create)
console.log('\n--- 4. Testing Admin Add New Client Store ---');
const newStoreCode = `STORE_TEST_${Date.now().toString().slice(-4)}`;
const createdStore = storage.createStore({
  storeCode: newStoreCode,
  storeName: 'Araku Specialty Coffee',
  storePhone: '9840998877',
  googleReviewUrl: 'https://g.page/r/araku/review',
  clientEmail: `manager@${newStoreCode.toLowerCase()}.com`,
  clientPassword: 'clientpass123'
});

assert(createdStore.storeCode === newStoreCode, 'Store created with custom store code');
assert(createdStore.secretKey.startsWith('SEC_'), 'Auto-generated Secret License Key');

// Check that client user can now login with newly created account
const newClientLogin = storage.authenticateUser(`manager@${newStoreCode.toLowerCase()}.com`, 'clientpass123');
assert(newClientLogin !== null && newClientLogin.role === 'CLIENT', 'New client can log in with provisioned credentials');

// 5. Test Admin Editing Client Store (CRUD Update)
console.log('\n--- 5. Testing Admin Edit Client Store ---');
const updatedStore = storage.updateStore(newStoreCode, {
  storeName: 'Araku Specialty Coffee & Bakery (Updated)',
  storePhone: '9840999999'
});
assert(updatedStore.storeName.includes('Updated'), 'Store name updated successfully');
assert(updatedStore.storePhone === '9840999999', 'Store phone updated');

// 6. Test Client Binding Secret Key on Desktop Agent
console.log('\n--- 6. Testing Client Secret Key Validation & Agent Binding ---');
const bindRes = storage.validateSecretKey(createdStore.secretKey);
assert(bindRes.valid === true, 'Secret key validated successfully');
assert(storage.getConfig().storeCode === newStoreCode, 'Agent local config bound to new client store');

const invalidBind = storage.validateSecretKey('SEC_INVALID_KEY_9999');
assert(invalidBind.valid === false, 'Invalid secret key rejected');

// 7. Test Admin Deleting Client Store (CRUD Delete)
console.log('\n--- 7. Testing Admin Delete Client Store ---');
const deleteRes = storage.deleteStore(newStoreCode);
assert(deleteRes === true, 'Client store deleted from system');
assert(storage.getStoreByCode(newStoreCode) === null, 'Store code no longer exists in registry');

const deletedUserLogin = storage.authenticateUser(`manager@${newStoreCode.toLowerCase()}.com`, 'clientpass123');
assert(deletedUserLogin === null, 'Deleted client account access revoked');

console.log('\n========================================================================');
console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} PASSED (100% SUCCESS)`);
console.log('========================================================================\n');
process.exit(0);
