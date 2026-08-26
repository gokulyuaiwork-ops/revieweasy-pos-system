import { storage } from '../src/engine/storage.js';

console.log('===============================================================');
console.log('🧪 TESTING CLIENT 3-PERIOD DASHBOARD (TODAY / 30D / ALL-TIME)');
console.log('===============================================================\n');

let passed = 0;
let total = 0;

function assert(condition, desc) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${desc}`);
  }
}

const testStoreCode = `STORE_3TIER_${Math.floor(1000 + Math.random() * 9000)}`;

// 1. Create client store
storage.createStore({
  storeCode: testStoreCode,
  storeName: "The Grand Bistro",
  storePhone: "9840199999"
});

// 2. Add transactions across different timestamps
const now = new Date();
const todayTs = now.toISOString();

const twentyDaysAgo = new Date(now.getTime() - (20 * 24 * 60 * 60 * 1000)).toISOString();
const fortyFiveDaysAgo = new Date(now.getTime() - (45 * 24 * 60 * 60 * 1000)).toISOString();

// Transaction 1: Today (Delivered)
storage.addTransaction({
  id: `TX_T1_${Date.now()}`,
  storeCode: testStoreCode,
  invoiceNo: 'INV-T-1',
  customerName: 'Aarav Mehta',
  customerPhone: '9840111111',
  totalAmount: '450.00',
  status: 'DELIVERED',
  timestamp: todayTs
});

// Transaction 2: 20 Days ago (Delivered)
storage.addTransaction({
  id: `TX_T2_${Date.now()}`,
  storeCode: testStoreCode,
  invoiceNo: 'INV-T-2',
  customerName: 'Riya Sen',
  customerPhone: '9840222222',
  totalAmount: '850.00',
  status: 'DELIVERED',
  timestamp: twentyDaysAgo
});

// Transaction 3: 45 Days ago (Delivered)
storage.addTransaction({
  id: `TX_T3_${Date.now()}`,
  storeCode: testStoreCode,
  invoiceNo: 'INV-T-3',
  customerName: 'Karan Johar',
  customerPhone: '9840333333',
  totalAmount: '1200.00',
  status: 'DELIVERED',
  timestamp: fortyFiveDaysAgo
});

// 3. Add feedbacks (Google 5-Star & Review Shield)
// Today 5-star
storage.addFeedback({
  storeCode: testStoreCode,
  rating: 5,
  action: 'GOOGLE_REDIRECT',
  timestamp: todayTs
});

// 20 Days ago 2-star (Review Shield)
storage.addFeedback({
  storeCode: testStoreCode,
  rating: 2,
  action: 'PRIVATE_FEEDBACK',
  comment: 'Soup was cold',
  timestamp: twentyDaysAgo
});

// 4. Fetch 3-Tier Analytics
const analytics = storage.getClientDetailedAnalytics(testStoreCode);

console.log('--- 1. Testing Today Section ---');
assert(analytics.today.sent === 1, 'Today WhatsApp Sent = 1');
assert(analytics.today.bills === 1, 'Today Bills = 1');
assert(analytics.today.sales === 450, 'Today Sales = 450');
assert(analytics.today.positiveRedirects === 1, 'Today Google 5★ = 1');
assert(analytics.today.shieldedGrievances === 0, 'Today Shielded Complaints = 0');

console.log('\n--- 2. Testing Last 30 Days Section ---');
assert(analytics.lastMonth.sent === 2, '30-Day WhatsApp Sent = 2 (Today + 20d ago)');
assert(analytics.lastMonth.bills === 2, '30-Day Bills = 2');
assert(analytics.lastMonth.sales === 1300, '30-Day Sales = 1300 (450 + 850)');
assert(analytics.lastMonth.positiveRedirects === 1, '30-Day Google 5★ = 1');
assert(analytics.lastMonth.shieldedGrievances === 1, '30-Day Shielded Complaints = 1');

console.log('\n--- 3. Testing All-Time Section ---');
assert(analytics.allTime.sent === 3, 'All-Time WhatsApp Sent = 3');
assert(analytics.allTime.bills === 3, 'All-Time Bills = 3');
assert(analytics.allTime.sales === 2500, 'All-Time Sales = 2500 (450 + 850 + 1200)');
assert(analytics.allTime.positiveRedirects === 1, 'All-Time Google 5★ = 1');
assert(analytics.allTime.shieldedGrievances === 1, 'All-Time Shielded Complaints = 1');

console.log('\n===============================================================');
console.log(`📊 RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}% SUCCESS)`);
console.log('===============================================================');

if (passed !== total) process.exit(1);
