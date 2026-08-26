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
  console.log('🧪 TESTING SILENT AUTO-UPDATER & SELF-HEALING PROTOCOL ENGINE');
  console.log('===============================================================\n');

  try {
    // Test 1: Fetch Initial Updater Status
    console.log('[Test 1] 📊 Testing GET /api/updater/status ...');
    const res1 = await request('/api/updater/status');
    if (res1.status !== 200 || !res1.data.success) {
      throw new Error(`Failed to get updater status: HTTP ${res1.status}`);
    }
    const status = res1.data.status;
    console.log(`  ✅ Package: ${status.packageName}`);
    console.log(`  ✅ Installed Version: v${status.installedVersion}`);
    console.log(`  ✅ Latest Version: v${status.latestVersion}`);
    console.log(`  ✅ Is Updating: ${status.isUpdating}`);

    // Test 2: Trigger Live Update Check
    console.log('\n[Test 2] 🔍 Testing POST /api/updater/check (NPM Registry Query)...');
    const res2 = await request('/api/updater/check', { method: 'POST' });
    if (res2.status !== 200 || !res2.data.success) {
      throw new Error(`Failed to run update check: HTTP ${res2.status}`);
    }
    const checkResult = res2.data.result;
    console.log(`  ✅ NPM Registry Query Complete:`);
    console.log(`  📦 Target Package : ${checkResult.packageName}`);
    console.log(`  📌 Installed Local : v${checkResult.installedVersion}`);
    console.log(`  🌐 Latest On NPM   : v${checkResult.latestVersion}`);
    console.log(`  🚀 Update Needed   : ${checkResult.hasUpdate}`);
    console.log(`  🕒 Last Checked    : ${checkResult.lastChecked}`);

    // Test 3: SemVer Verification Unit Test
    console.log('\n[Test 3] 🔢 Testing Semantic Version (SemVer) Resolution...');
    const { AutoUpdaterEngine } = await import('../src/engine/auto-updater.js');
    const engine = new AutoUpdaterEngine();

    if (engine.compareVersions('6.7.9', '6.7.8') !== 1) throw new Error('SemVer test failed for 6.7.9 > 6.7.8');
    if (engine.compareVersions('6.7.8', '6.7.8') !== 0) throw new Error('SemVer test failed for 6.7.8 == 6.7.8');
    if (engine.compareVersions('6.7.0', '6.7.8') !== -1) throw new Error('SemVer test failed for 6.7.0 < 6.7.8');
    if (engine.compareVersions('7.0.0', '6.9.9') !== 1) throw new Error('SemVer test failed for 7.0.0 > 6.9.9');
    console.log('  ✅ SemVer Resolution Algorithm Passed (All edge comparisons valid)');

    console.log('\n===============================================================');
    console.log('🎉 ALL AUTO-UPDATER & PROTOCOL TESTS PASSED (100%)');
    console.log('===============================================================\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

runTests();
