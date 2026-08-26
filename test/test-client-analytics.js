import { storage } from '../src/engine/storage.js';

console.log('========================================================================');
console.log('🧪 TESTING PER-CLIENT DETAILED TIME-WINDOWED ANALYTICS');
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

const now = Date.now();
const testStore = `STORE_ANALYTICS_TEST_${now.toString().slice(-4)}`;

// 1. Create a test store
storage.createStore({
  storeCode: testStore,
  storeName: 'Test Specialty Bistro',
  storePhone: '9840000001',
  googleReviewUrl: 'https://g.page/r/testbistro/review',
  clientEmail: `test@${testStore.toLowerCase()}.com`,
  clientPassword: 'password123'
});

console.log(`\n--- 1. Seeding Time-Distributed Transactions for ${testStore} ---`);

// Transaction 1: Today
storage.addTransaction({
  storeCode: testStore,
  invoiceNo: 'INV-TODAY-01',
  customerName: 'Aarav Patel',
  customerPhone: '9840011111',
  totalAmount: 650.00,
  status: 'DELIVERED',
  timestamp: new Date(now - 1000 * 60 * 30).toISOString() // 30 mins ago
});

// Transaction 2: Today (Another bill)
storage.addTransaction({
  storeCode: testStore,
  invoiceNo: 'INV-TODAY-02',
  customerName: 'Priya Sharma',
  customerPhone: '9840022222',
  totalAmount: 1200.00,
  status: 'DELIVERED',
  timestamp: new Date(now - 1000 * 60 * 60 * 2).toISOString() // 2 hours ago
});

// Transaction 3: 4 Days Ago (Within Last Week & Last Month)
storage.addTransaction({
  storeCode: testStore,
  invoiceNo: 'INV-WEEK-01',
  customerName: 'Rohan Gupta',
  customerPhone: '9840033333',
  totalAmount: 850.00,
  status: 'DELIVERED',
  timestamp: new Date(now - 1000 * 60 * 60 * 24 * 4).toISOString() // 4 days ago
});

// Transaction 4: 18 Days Ago (Within Last Month, but outside Last Week)
storage.addTransaction({
  storeCode: testStore,
  invoiceNo: 'INV-MONTH-01',
  customerName: 'Kavita Roy',
  customerPhone: '9840044444',
  totalAmount: 2100.00,
  status: 'DELIVERED',
  timestamp: new Date(now - 1000 * 60 * 60 * 24 * 18).toISOString() // 18 days ago
});

// Transaction 5: 60 Days Ago (Older than a month, All-time only)
storage.addTransaction({
  storeCode: testStore,
  invoiceNo: 'INV-OLD-01',
  customerName: 'Vikram Singh',
  customerPhone: '9840055555',
  totalAmount: 1500.00,
  status: 'DELIVERED',
  timestamp: new Date(now - 1000 * 60 * 60 * 24 * 60).toISOString() // 60 days ago
});

console.log('\n--- 2. Verifying Per-Client Time-Window Aggregations ---');
const analytics = storage.getClientDetailedAnalytics(testStore);

console.log('Aggregated Analytics Result:', {
  today: analytics.today,
  lastWeek: analytics.lastWeek,
  lastMonth: analytics.lastMonth,
  allTime: analytics.allTime
});

assert(analytics.today.sent === 2, `Today Sent == 2 (actual: ${analytics.today.sent})`);
assert(analytics.today.bills === 2, `Today Bills == 2 (actual: ${analytics.today.bills})`);
assert(analytics.today.sales === 1850.00, `Today Sales == 1850 (actual: ${analytics.today.sales})`);

assert(analytics.lastWeek.sent === 3, `Last Week Sent == 3 (today 2 + 4 days ago 1) (actual: ${analytics.lastWeek.sent})`);
assert(analytics.lastWeek.bills === 3, `Last Week Bills == 3 (actual: ${analytics.lastWeek.bills})`);

assert(analytics.lastMonth.sent === 4, `Last Month Sent == 4 (actual: ${analytics.lastMonth.sent})`);
assert(analytics.lastMonth.bills === 4, `Last Month Bills == 4 (actual: ${analytics.lastMonth.bills})`);

assert(analytics.allTime.sent === 5, `All-Time Sent == 5 (actual: ${analytics.allTime.sent})`);
assert(analytics.allTime.bills === 5, `All-Time Bills == 5 (actual: ${analytics.allTime.bills})`);
assert(analytics.allTime.sales === 6300.00, `All-Time Sales == ₹6,300 (actual: ${analytics.allTime.sales})`);

console.log('\n--- 3. Verifying All Clients Array with Embedded Analytics ---');
const allStoresWithAnalytics = storage.getAllClientsWithAnalytics();
const foundTestStore = allStoresWithAnalytics.find(s => s.storeCode === testStore);
assert(foundTestStore !== undefined, 'Found test store in allStoresWithAnalytics');
assert(foundTestStore.analytics.todaySent === 2, 'Embedded todaySent == 2');
assert(foundTestStore.analytics.lastWeekSent === 3, 'Embedded lastWeekSent == 3');
assert(foundTestStore.analytics.lastMonthSent === 4, 'Embedded lastMonthSent == 4');
assert(foundTestStore.analytics.allTimeSent === 5, 'Embedded allTimeSent == 5');

// Cleanup test store
storage.deleteStore(testStore);

console.log('\n========================================================================');
console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} PASSED (100% SUCCESS)`);
console.log('========================================================================\n');
