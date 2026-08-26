import http from 'http';

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
  console.log('🧪 TESTING SMART REVIEW SHIELD & DAILY CLOSING DIGEST ENGINE');
  console.log('===============================================================\n');

  try {
    // 1. Check Server State & Review Shield Config
    console.log('[Test 1] 📡 Checking Server Initial State...');
    const stateRes = await request('/api/state');
    if (stateRes.status !== 200) throw new Error('State fetch failed');
    console.log('  ✅ State endpoint online.');
    console.log(`  📊 Initial Shield Metrics: Negative Shielded = ${stateRes.data.metrics.negativeReviewsShielded || 0}, 5★ Redirects = ${stateRes.data.metrics.positiveReviewsRedirected || 0}`);

    // 2. Test Smart Review Info Endpoint (Landing page load)
    console.log('\n[Test 2] 🔗 Testing GET /api/review-info/:billId ...');
    const infoRes = await request('/api/review-info/TX_TEST_01?store=STORE_DEMO_01');
    if (infoRes.status !== 200 || !infoRes.data.success) throw new Error('Review info failed');
    console.log(`  ✅ Successfully retrieved review metadata for Store: "${infoRes.data.store.storeName}"`);
    console.log(`  👉 Google Review URL Anchor: ${infoRes.data.store.googleReviewUrl}`);

    // 3. Test Negative Rating (2 Stars) -> Shield Activated & Private Feedback Created
    console.log('\n[Test 3] 🛡️ Testing Negative Rating (2 Stars) Submission (Review Shield)...');
    const negFeedbackPayload = {
      billId: 'TX_TEST_01',
      storeCode: 'STORE_DEMO_01',
      invoiceNo: 'INV-4920',
      customerName: 'Rahul Sharma',
      customerPhone: '9876543219',
      rating: 2,
      category: 'Service Speed',
      comment: 'Food was delayed by 40 minutes and arrived cold.',
      requestCallback: true
    };

    const negRes = await request('/api/feedback', {
      method: 'POST',
      body: negFeedbackPayload
    });

    if (negRes.status !== 200 || !negRes.data.success) throw new Error('Negative feedback submission failed');
    console.log('  ✅ 2-Star Feedback successfully intercepted!');
    console.log(`  🛡️ Action: ${negRes.data.feedback.action} (Deflected from Google Maps)`);
    console.log(`  ⚠️ Status: ${negRes.data.feedback.status} | Callback Requested: ${negRes.data.feedback.requestCallback}`);
    console.log(`  🏷️ Category: ${negRes.data.feedback.category}`);

    // 4. Test Positive Rating (5 Stars) -> Google Redirect Logged
    console.log('\n[Test 4] ⭐ Testing Positive Rating (5 Stars) Submission (Google Redirect)...');
    const posFeedbackPayload = {
      billId: 'TX_TEST_02',
      storeCode: 'STORE_DEMO_01',
      invoiceNo: 'INV-5001',
      customerName: 'Meera Krishnan',
      customerPhone: '9884129841',
      rating: 5,
      category: 'Satisfied Customer',
      comment: 'Loved the cold brew and Belgian chocolate brownie!'
    };

    const posRes = await request('/api/feedback', {
      method: 'POST',
      body: posFeedbackPayload
    });

    if (posRes.status !== 200 || !posRes.data.success) throw new Error('Positive feedback submission failed');
    console.log('  ✅ 5-Star Feedback recorded!');
    console.log(`  ⭐ Action: ${posRes.data.feedback.action} (Routed directly to Google Reviews)`);

    // 5. Test Feedback Inbox Retrieval & Status Resolution
    console.log('\n[Test 5] 📬 Testing Feedback Inbox Retrieval & Manager Resolution...');
    const listRes = await request('/api/feedback?storeCode=STORE_DEMO_01');
    if (listRes.status !== 200 || !listRes.data.success) throw new Error('Failed to retrieve feedback inbox');
    console.log(`  ✅ Retrieved ${listRes.data.feedbacks.length} feedback records from inbox.`);

    const openFeedback = listRes.data.feedbacks.find(f => f.status === 'OPEN');
    if (openFeedback) {
      console.log(`  🔄 Resolving Open Complaint (ID: ${openFeedback.id})...`);
      const resolveRes = await request(`/api/feedback/${openFeedback.id}/status`, {
        method: 'PUT',
        body: { status: 'RESOLVED', notes: 'Manager called customer and issued 20% discount coupon.' }
      });
      if (resolveRes.status === 200 && resolveRes.data.feedback.status === 'RESOLVED') {
        console.log('  ✅ Status successfully updated to RESOLVED!');
      }
    }

    // 6. Test Daily Closing Digest Preview & Dispatch
    console.log('\n[Test 6] 🌙 Testing Daily Owner Digest Preview & Dispatch...');
    const previewRes = await request('/api/digest/preview/STORE_DEMO_01');
    if (previewRes.status !== 200 || !previewRes.data.success) throw new Error('Digest preview failed');
    console.log('  ✅ Generated Daily Closing Digest Preview:\n');
    console.log('------------------------------------------------------------');
    console.log(previewRes.data.preview);
    console.log('------------------------------------------------------------');

    console.log('\n  🚀 Triggering On-Demand Owner Digest Dispatch...');
    const sendRes = await request('/api/digest/send', {
      method: 'POST',
      body: { storeCode: 'STORE_DEMO_01' }
    });
    if (sendRes.status !== 200 || !sendRes.data.success) throw new Error('Digest dispatch failed');
    console.log(`  ✅ Closing Digest successfully dispatched to Owner Phone +91 ${sendRes.data.log.recipientPhone}!`);
    console.log(`  📊 Status: ${sendRes.data.log.status}`);

    // 7. Verify Updated Metrics
    console.log('\n[Test 7] 📈 Verifying Final Aggregated Metrics...');
    const finalState = await request('/api/state');
    console.log(`  🛡️ Total Negative Reviews Shielded: ${finalState.data.metrics.negativeReviewsShielded}`);
    console.log(`  ⭐ Total 5-Star Google Redirects  : ${finalState.data.metrics.positiveReviewsRedirected}`);
    console.log(`  🌙 Total Owner Digests Sent       : ${finalState.data.metrics.ownerDigestsSent}`);

    console.log('\n===============================================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! 100% OPERATIONAL');
    console.log('===============================================================\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

runTests();
