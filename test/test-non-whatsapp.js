import assert from 'assert';
import { storage } from '../src/engine/storage.js';
import { WhatsAppDispatcher } from '../src/engine/dispatcher.js';

console.log('🧪 RUNNING NON-WHATSAPP NUMBER SAFEGUARD VERIFICATION TESTS...\n');

// 1. Setup mock Baileys engine where a number does NOT exist on WhatsApp
const mockBaileys = {
  status: 'CONNECTED',
  async sendMessage(phone, messageText) {
    if (phone === '9111111111') {
      // Simulate non-WhatsApp number
      return { 
        success: false, 
        reason: 'NOT_ON_WHATSAPP', 
        error: 'Phone number has no WhatsApp account',
        jid: '919111111111@s.whatsapp.net' 
      };
    }
    return { success: true, mode: 'LIVE_BAILEYS_SOCKET' };
  }
};

let cloudSyncLogs = [];
const mockSupabaseSync = {
  syncBillToCloud(tx) { cloudSyncLogs.push({ type: 'BILL', tx }); },
  syncDispatchToCloud(txId, status, details) { cloudSyncLogs.push({ type: 'DISPATCH', txId, status, details }); }
};

let broadcastLogs = [];
const mockBroadcast = (type, data) => { broadcastLogs.push({ type, data }); };

const dispatcher = new WhatsAppDispatcher(mockBroadcast, mockBaileys, mockSupabaseSync);

// Reset test data
storage.state.transactions = [];
storage.state.config.dailyLimitMax = 70;
storage.state.config.pacingDelayMinSeconds = 0;
storage.state.config.pacingDelayMaxSeconds = 0;

const initialQuota = storage.getTodayQuotaUsage('STORE_DEMO_01');
console.log(`1. Initial Quota: ${initialQuota.dailyUsed} / ${initialQuota.dailyMax} (Remaining: ${initialQuota.dailyRemaining})`);

// 2. Process bill for a NON-WHATSAPP customer
const tx = dispatcher.processIncomingBill({
  storeCode: 'STORE_DEMO_01',
  invoiceNo: 'INV-NON-WA-01',
  customerName: 'Aakash Verma (No WhatsApp)',
  customerPhone: '9111111111',
  totalAmount: '450.00',
  success: true,
  status: 'VALID_INVOICE'
});

// Trigger dispatch
console.log('\n2. Dispatching to non-WhatsApp number: 9111111111...');
await dispatcher.dispatchWhatsAppMessage(tx.id);

const updatedTx = storage.state.transactions.find(t => t.id === tx.id);
console.log('3. Final Transaction Status:', updatedTx.status);
console.log('   Reason:', updatedTx.statusDetails.reason);

// Check 1: Status is NOT_ON_WHATSAPP
assert.strictEqual(updatedTx.status, 'NOT_ON_WHATSAPP', 'Status must be NOT_ON_WHATSAPP');
console.log('✅ Check 1 Passed: Status is correctly marked as NOT_ON_WHATSAPP.');

// Check 2: Quota is NOT consumed (remains 0 used)
const postQuota = storage.getTodayQuotaUsage('STORE_DEMO_01');
console.log(`4. Quota after non-WhatsApp dispatch: ${postQuota.dailyUsed} / ${postQuota.dailyMax} (Remaining: ${postQuota.dailyRemaining})`);
assert.strictEqual(postQuota.dailyUsed, 0, 'Quota must NOT be consumed for non-WhatsApp numbers');
assert.strictEqual(postQuota.dailyRemaining, 70, 'All 70 quota messages must remain available');
console.log('✅ Check 2 Passed: Daily 70 quota is 100% protected and preserved.');

// Check 3: Cloud sync logged the status
const dispatchSync = cloudSyncLogs.find(c => c.type === 'DISPATCH' && c.txId === tx.id);
assert.ok(dispatchSync, 'Dispatch must be synced to Supabase');
assert.strictEqual(dispatchSync.status, 'NOT_ON_WHATSAPP', 'Supabase status must be NOT_ON_WHATSAPP');
console.log('✅ Check 3 Passed: Supabase Cloud synced status NOT_ON_WHATSAPP.');

// Check 4: No infinite retries or crashes
assert.strictEqual(storage.getQueue().length, 0, 'No failed retry jobs enqueued in queue');
console.log('✅ Check 4 Passed: Zero infinite loops or stuck queue items.');

console.log('\n🎉 ALL 4/4 NON-WHATSAPP SAFEGUARD CHECKS VERIFIED AND PASSING!\n');
process.exit(0);
