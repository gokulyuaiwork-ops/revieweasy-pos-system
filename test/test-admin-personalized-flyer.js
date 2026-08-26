import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PersonalizedImageGenerator } from '../src/engine/personalized-image-generator.js';
import { storage } from '../src/engine/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING MASTER ADMIN & PERSONALIZED FLYER TEST SUITE');
  console.log('====================================================\n');

  // Test 1: Personalized Image Generator Template Rendering
  console.log('🔹 Test 1: Template Name Token Replacement...');
  const text1 = PersonalizedImageGenerator.renderTemplateText('Specially for {{name}}! ✨', 'Rahul Sharma');
  assert.strictEqual(text1, 'Specially for Rahul Sharma! ✨');

  const text2 = PersonalizedImageGenerator.renderTemplateText('Hi {{first_name}}, thank you! ⭐', 'Priya Sundaram');
  assert.strictEqual(text2, 'Hi Priya, thank you! ⭐');

  const textFallback = PersonalizedImageGenerator.renderTemplateText('Specially for {{name}}! ✨', '');
  assert.strictEqual(textFallback, 'Specially for Valued Guest! ✨');
  console.log('  ✅ Template rendering tests passed!\n');

  // Test 2: Composite Personalized Image Buffer Generation
  console.log('🔹 Test 2: In-Memory Personalized SVG Flyer Generation...');
  const defaultFlyerPath = path.join(__dirname, '../public/assets/default-review-flyer.jpg');
  let baseBuffer;
  if (fs.existsSync(defaultFlyerPath)) {
    baseBuffer = fs.readFileSync(defaultFlyerPath);
  } else {
    baseBuffer = Buffer.from('MockImageData');
  }

  const customOverlay = {
    enabled: true,
    template: 'Specially for {{name}}! 🎁',
    posX: 50,
    posY: 20,
    fontSize: 32,
    color: '#FFD700',
    badgeBg: 'rgba(0, 0, 0, 0.8)'
  };

  const outputBuffer = PersonalizedImageGenerator.generatePersonalizedFlyer(baseBuffer, 'Vikram Malhotra', customOverlay);
  assert(Buffer.isBuffer(outputBuffer), 'Output must be a Buffer');
  const svgString = outputBuffer.toString('utf8');
  assert(svgString.includes('Vikram Malhotra'), 'Generated SVG must contain the customer name');
  assert(svgString.includes('#FFD700'), 'Generated SVG must contain the configured text color');
  console.log('  ✅ Dynamic SVG compositing verified! (Length: ' + outputBuffer.length + ' bytes)\n');

  // Test 3: Admin Store Provisioning with flyerOverlayConfig
  console.log('🔹 Test 3: Master Admin Store Account Creation with Custom Flyer Settings...');
  const testStoreCode = `TEST_${Date.now().toString().slice(-4)}`;
  const newStore = storage.createStore({
    storeCode: testStoreCode,
    storeName: 'Artisan Bakery & Cafe',
    storePhone: '9876501234',
    googleReviewUrl: 'https://g.page/r/artisan/review',
    clientEmail: `owner_${testStoreCode.toLowerCase()}@artisan.com`,
    clientPassword: 'bakerypassword123',
    flyerOverlayConfig: {
      enabled: true,
      template: 'Fresh treats for {{first_name}}! 🥐',
      posX: 50,
      posY: 15,
      fontSize: 30,
      color: '#FFFFFF'
    }
  });

  assert.strictEqual(newStore.storeCode, testStoreCode);
  assert.strictEqual(newStore.flyerOverlayConfig.template, 'Fresh treats for {{first_name}}! 🥐');
  console.log(`  ✅ Store account [${testStoreCode}] created with secret key: ${newStore.secretKey}\n`);

  // Test 4: Merchant Login & Credential Verification
  console.log('🔹 Test 4: Merchant Authentication Gate...');
  const authUser = storage.authenticateUser(`owner_${testStoreCode.toLowerCase()}@artisan.com`, 'bakerypassword123');
  assert(authUser !== null, 'User must authenticate successfully');
  assert.strictEqual(authUser.role, 'CLIENT');
  assert.strictEqual(authUser.storeCode, testStoreCode);
  assert.strictEqual(authUser.store.storeName, 'Artisan Bakery & Cafe');
  console.log('  ✅ Merchant login authentication verified!\n');

  // Test 5: Secret Key Validation & Agent Configuration Hydration
  console.log('🔹 Test 5: Client Agent Secret Key Binding...');
  const bindResult = storage.validateSecretKey(newStore.secretKey);
  assert(bindResult.valid === true, 'Secret key must be valid');
  assert.strictEqual(storage.getConfig().storeCode, testStoreCode);
  assert.strictEqual(storage.getConfig().flyerOverlayConfig.template, 'Fresh treats for {{first_name}}! 🥐');
  console.log('  ✅ Agent successfully bound and hydrated store configuration!\n');

  // Test 6: Multi-Tier Analytics Breakdown
  console.log('🔹 Test 6: Multi-Tier Time-Window Analytics (Today, 30d, All-Time)...');
  storage.addTransaction({
    storeCode: testStoreCode,
    invoiceNo: 'INV-TEST-01',
    customerName: 'Ananya Desai',
    customerPhone: '9840123456',
    totalAmount: '450.00',
    status: 'DELIVERED'
  });

  const analytics = storage.getClientDetailedAnalytics(testStoreCode);
  assert.strictEqual(analytics.today.bills, 1);
  assert.strictEqual(analytics.today.sent, 1);
  assert.strictEqual(analytics.today.sales, 450);
  assert.strictEqual(analytics.allTime.bills, 1);
  console.log('  ✅ Multi-tier analytics accurately computed per-store metrics!\n');

  // Clean up test store
  storage.deleteStore(testStoreCode);
  console.log(`  🧹 Cleaned up test store [${testStoreCode}].\n`);

  console.log('====================================================');
  console.log('🎉 ALL MASTER ADMIN & PERSONALIZED FLYER TESTS PASSED!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
