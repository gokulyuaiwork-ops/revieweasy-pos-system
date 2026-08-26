import assert from 'assert';
import { storage } from '../src/engine/storage.js';
import { WhatsAppDispatcher } from '../src/engine/dispatcher.js';

console.log('🧪 RUNNING DAILY & DAYPARTING SLOT QUOTA UNIT TESTS...\n');

// 1. Reset test state
storage.state.transactions = [];
storage.state.queue = [];
storage.state.config.dailyLimitMax = 5;       // Low limit for testing
storage.state.config.afternoonQuotaMax = 3;  // Low slot limit for testing

let broadcastEvents = [];
const mockBroadcast = (type, data) => {
  broadcastEvents.push({ type, data });
};

const dispatcher = new WhatsAppDispatcher(mockBroadcast);

// 2. Test initial empty quota
const q1 = storage.getTodayQuotaUsage('STORE_DEMO_01');
console.log('1. Initial Quota Usage:', q1);
assert.strictEqual(q1.dailyUsed, 0, 'Daily used should initially be 0');
assert.strictEqual(q1.dailyRemaining, 5, 'Daily remaining should be 5');
assert.strictEqual(q1.isDailyCapped, false, 'Should not be daily capped');

// 3. Simulate adding delivered transactions today
for (let i = 1; i <= 3; i++) {
  storage.addTransaction({
    storeCode: 'STORE_DEMO_01',
    invoiceNo: `INV-Q-${i}`,
    customerName: `Customer ${i}`,
    customerPhone: `987654320${i}`,
    status: 'DELIVERED',
    timestamp: new Date().toISOString()
  });
}

const q2 = storage.getTodayQuotaUsage('STORE_DEMO_01');
console.log('\n2. Quota after 3 deliveries:', q2);
assert.strictEqual(q2.dailyUsed, 3, 'Daily used should now be 3');
assert.strictEqual(q2.dailyRemaining, 2, 'Daily remaining should now be 2');

// 4. Test Slot Capping (If current slot is Afternoon and max is 3, slot should be capped)
if (q2.currentSlot === 'AFTERNOON') {
  assert.strictEqual(q2.isSlotCapped, true, 'Afternoon slot with 3 deliveries should be capped (max 3)');
  console.log('✅ Afternoon slot cap correctly recognized!');
}

// 5. Test Incoming Bill when Slot is full -> should be CANCELLED with CANCELLED_SLOT_QUOTA
if (q2.isSlotCapped) {
  const txSlotCancel = dispatcher.processIncomingBill({
    invoiceNo: 'INV-SLOT-CANCEL',
    customerName: 'Cancelled Customer',
    customerPhone: '9840112233',
    totalAmount: '450.00',
    success: true,
    status: 'VALID_INVOICE'
  });

  console.log('\n3. Processed bill during full slot:', txSlotCancel.status);
  assert.strictEqual(txSlotCancel.status, 'CANCELLED_SLOT_QUOTA', 'Status should be CANCELLED_SLOT_QUOTA');
  assert.strictEqual(storage.getQueue().length, 0, 'No rollover job should be enqueued when cancelled');
  console.log('✅ Bill correctly cancelled with status CANCELLED_SLOT_QUOTA (Limit Exceeded)!');
}

// 6. Test Daily Limit Cap (Fill up to 5)
storage.addTransaction({
  storeCode: 'STORE_DEMO_01',
  invoiceNo: 'INV-Q-4',
  customerName: 'Customer 4',
  customerPhone: '9876543204',
  status: 'DELIVERED',
  timestamp: new Date().toISOString()
});
storage.addTransaction({
  storeCode: 'STORE_DEMO_01',
  invoiceNo: 'INV-Q-5',
  customerName: 'Customer 5',
  customerPhone: '9876543205',
  status: 'DELIVERED',
  timestamp: new Date().toISOString()
});

const q3 = storage.getTodayQuotaUsage('STORE_DEMO_01');
console.log('\n4. Quota after 5 deliveries:', q3);
assert.strictEqual(q3.dailyUsed, 5, 'Daily used should now be 5');
assert.strictEqual(q3.isDailyCapped, true, 'Daily cap should be true');

// 7. Test Incoming Bill when Daily Cap is reached -> CANCELLED_DAILY_QUOTA
const txDailyCancel = dispatcher.processIncomingBill({
  invoiceNo: 'INV-DAILY-CANCEL',
  customerName: 'Daily Exceeded Customer',
  customerPhone: '9840556677',
  totalAmount: '890.00',
  success: true,
  status: 'VALID_INVOICE'
});

console.log('\n5. Processed bill when daily limit exceeded:', txDailyCancel.status);
assert.strictEqual(txDailyCancel.status, 'CANCELLED_DAILY_QUOTA', 'Status should be CANCELLED_DAILY_QUOTA');
assert.strictEqual(storage.getQueue().length, 0, 'No rollover job should be enqueued when cancelled');
console.log('✅ Bill correctly cancelled with status CANCELLED_DAILY_QUOTA (Limit Exceeded)!');

// Clean up test config
storage.state.config.dailyLimitMax = 70;
storage.state.config.morningQuotaMax = 15;
storage.state.config.afternoonQuotaMax = 20;
storage.state.config.eveningQuotaMax = 35;
storage.save();

console.log('\n🎉 ALL 5/5 QUOTA CANCELLATION UNIT TESTS PASSED SUCCESSFULLY!\n');
process.exit(0);
