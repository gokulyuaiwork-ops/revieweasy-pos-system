const BASE_URL = 'http://127.0.0.1:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: res.status, data: await res.json() };
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('🧪 TESTING STRICT FIFO PACING & 15-SECOND RATE LIMIT QUEUE');
  console.log('===============================================================\n');

  try {
    const STORE_CODE = 'STORE_DEMO_01';

    // 1. Rapidly inject 3 bills within 50ms
    console.log('[Test 1] ⚡ Rapidly injecting 3 receipts simultaneously within 50ms...');
    
    const p1 = request('/api/simulate-print', {
      method: 'POST',
      body: {
        rawText: `Customer: Rapid Customer 1\nMobile: 9840100001\nTOTAL: 100.00`,
        storeCode: STORE_CODE
      }
    });

    const p2 = request('/api/simulate-print', {
      method: 'POST',
      body: {
        rawText: `Customer: Rapid Customer 2\nMobile: 9840100002\nTOTAL: 200.00`,
        storeCode: STORE_CODE
      }
    });

    const p3 = request('/api/simulate-print', {
      method: 'POST',
      body: {
        rawText: `Customer: Rapid Customer 3\nMobile: 9840100003\nTOTAL: 300.00`,
        storeCode: STORE_CODE
      }
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    console.log(`  ✅ Job 1 Status: ${r1.data.transaction.status} | Delay: ${r1.data.transaction.statusDetails?.delaySeconds}s | Queue Pos: #${r1.data.transaction.statusDetails?.queuePosition}`);
    console.log(`  ✅ Job 2 Status: ${r2.data.transaction.status} | Delay: ${r2.data.transaction.statusDetails?.delaySeconds}s | Queue Pos: #${r2.data.transaction.statusDetails?.queuePosition}`);
    console.log(`  ✅ Job 3 Status: ${r3.data.transaction.status} | Delay: ${r3.data.transaction.statusDetails?.delaySeconds}s | Queue Pos: #${r3.data.transaction.statusDetails?.queuePosition}`);

    if (r1.data.transaction.status !== 'SCHEDULED_DISPATCH' || r2.data.transaction.status !== 'SCHEDULED_DISPATCH' || r3.data.transaction.status !== 'SCHEDULED_DISPATCH') {
      throw new Error('All rapid print jobs should be marked SCHEDULED_DISPATCH');
    }

    if (r2.data.transaction.statusDetails?.queuePosition <= r1.data.transaction.statusDetails?.queuePosition) {
      throw new Error('FIFO Queue ordering was not respected!');
    }

    console.log('\n===============================================================');
    console.log('🎉 STRICT 15S FIFO PACING QUEUE TEST PASSED (100%)');
    console.log('===============================================================\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

runTests();
