import { storage } from '../src/engine/storage.js';
import { BUSINESS_CATEGORIES, getCategoryTemplate, formatWhatsAppMessage } from '../src/engine/business-templates.js';
import { WhatsAppDispatcher } from '../src/engine/dispatcher.js';

console.log('===============================================================');
console.log('🧪 TESTING BUSINESS CATEGORIES & INDUSTRY TEMPLATES');
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

// 1. Test Category Definitions
console.log('--- 1. Testing Business Category Presets ---');
assert(Object.keys(BUSINESS_CATEGORIES).length >= 7, 'All 7 industry categories present');
assert(BUSINESS_CATEGORIES.RESTAURANT_CAFE.label.includes('Restaurant'), 'Restaurant category configured');
assert(BUSINESS_CATEGORIES.RETAIL_FASHION.label.includes('Retail'), 'Retail / Fashion category configured');
assert(BUSINESS_CATEGORIES.SALON_SPA.label.includes('Salon'), 'Salon / Spa category configured');
assert(BUSINESS_CATEGORIES.CLINIC_HEALTHCARE.label.includes('Clinic'), 'Clinic / Healthcare category configured');
assert(BUSINESS_CATEGORIES.AUTOMOBILE_SERVICE.label.includes('Automobile'), 'Automobile / Garage category configured');
assert(BUSINESS_CATEGORIES.SUPERMARKET_GROCERY.label.includes('Supermarket'), 'Supermarket category configured');

// 2. Test Message Formatter
console.log('\n--- 2. Testing Dynamic Template Formatter ---');
const salonTmpl = BUSINESS_CATEGORIES.SALON_SPA.defaultMessageTemplate;
const formattedSalon = formatWhatsAppMessage(salonTmpl, {
  customerName: 'Ananya Roy',
  storeName: 'Luxe Salon & Spa',
  invoiceNo: 'INV-SPA-501',
  totalAmount: '1850.00',
  ebillUrl: 'http://localhost:3000/bill.html?id=123',
  reviewLink: 'https://g.page/r/luxe/review'
});

assert(formattedSalon.includes('Ananya Roy'), 'Replaced {{name}} with customer name');
assert(formattedSalon.includes('Luxe Salon & Spa'), 'Replaced {{store_name}} with store name');
assert(formattedSalon.includes('INV-SPA-501'), 'Replaced {{invoice_no}} with invoice number');
assert(formattedSalon.includes('₹1850.00'), 'Replaced {{total_amount}} with total amount');
assert(formattedSalon.includes('rate your stylist on Google'), 'Contains salon-specific message copy');

// 3. Test Store Creation with Business Category in Storage
console.log('\n--- 3. Testing Store Storage with Category & Custom Template ---');
const testStoreCode = `STORE_TEST_CAT_${Math.floor(1000 + Math.random() * 9000)}`;
const createdStore = storage.createStore({
  storeCode: testStoreCode,
  storeName: "Apollo Dental Clinic",
  storePhone: "9840199999",
  businessCategory: "CLINIC_HEALTHCARE",
  customWhatsAppTemplate: "Dear {{name}}, thank you for choosing {{store_name}}. Please review Dr. Sharma: {{review_link}}"
});

assert(createdStore.businessCategory === 'CLINIC_HEALTHCARE', 'Store created with CLINIC_HEALTHCARE category');
assert(createdStore.customWhatsAppTemplate.includes('Dr. Sharma'), 'Store persisted custom WhatsApp template');

// 4. Test Store Update with Business Category
const updatedStore = storage.updateStore(testStoreCode, {
  businessCategory: "RETAIL_FASHION",
  customWhatsAppTemplate: "Hi {{name}}! Loved shopping at {{store_name}}? Share feedback: {{review_link}}"
});

assert(updatedStore.businessCategory === 'RETAIL_FASHION', 'Store updated to RETAIL_FASHION');
assert(updatedStore.customWhatsAppTemplate.includes('Loved shopping'), 'Store updated custom WhatsApp template');

console.log('\n===============================================================');
console.log(`📊 RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}% SUCCESS)`);
console.log('===============================================================');

if (passed !== total) process.exit(1);
