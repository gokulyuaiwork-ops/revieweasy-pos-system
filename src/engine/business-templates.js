/**
 * Business Category Definitions & Industry-Tailored WhatsApp Message Templates
 */
export const BUSINESS_CATEGORIES = {
  RESTAURANT_CAFE: {
    id: 'RESTAURANT_CAFE',
    label: '🍽️ Restaurant / Cafe / Bakery / QSR',
    defaultFlyerTemplate: 'Freshly prepared for {{name}}! 🍽️',
    defaultMessageTemplate: `Hi {{name}}! ✨ Thank you for dining with us at {{store_name}} today.

🧾 *Bill #{{invoice_no}}* | Total: ₹{{total_amount}}
🌐 View Digital E-Bill: {{ebill_url}}

Did you enjoy your meal and service? We would love your feedback on Google:
⭐⭐⭐⭐⭐
👉 {{review_link}}

(Reply STOP to unsubscribe)`
  },

  RETAIL_FASHION: {
    id: 'RETAIL_FASHION',
    label: '🛍️ Retail / Clothing / Fashion & Footwear',
    defaultFlyerTemplate: 'Styled specially for {{name}}! ✨',
    defaultMessageTemplate: `Hi {{name}}! 🛍️ Thank you for shopping at {{store_name}} today.

🧾 *Invoice #{{invoice_no}}* | Total: ₹{{total_amount}}
🌐 View Digital Receipt: {{ebill_url}}

How was your shopping experience and our latest collection? Let us know on Google:
⭐⭐⭐⭐⭐
👉 {{review_link}}

(Reply STOP to unsubscribe)`
  },

  SALON_SPA: {
    id: 'SALON_SPA',
    label: '💇 Salon / Spa / Beauty & Wellness',
    defaultFlyerTemplate: 'Glow curated for {{name}}! 💅',
    defaultMessageTemplate: `Hi {{name}}! 💆‍♀️ Thank you for visiting {{store_name}} today.

🧾 *Appointment Bill #{{invoice_no}}* | Total: ₹{{total_amount}}
🌐 View Digital E-Bill: {{ebill_url}}

We hope you loved your treatment & styling! Please take 5 seconds to rate your stylist on Google:
⭐⭐⭐⭐⭐
👉 {{review_link}}

(Reply STOP to unsubscribe)`
  },

  CLINIC_HEALTHCARE: {
    id: 'CLINIC_HEALTHCARE',
    label: '🏥 Clinic / Dental / Diagnostics / Pharmacy',
    defaultFlyerTemplate: 'Care tailored for {{name}} 🩺',
    defaultMessageTemplate: `Dear {{name}}, 🩺 Thank you for consulting with {{store_name}} today.

🧾 *Receipt #{{invoice_no}}* | Amount: ₹{{total_amount}}
🌐 View Digital Prescription & Bill: {{ebill_url}}

Your health, comfort, and satisfaction are our top priority. Please share your experience:
⭐⭐⭐⭐⭐
👉 {{review_link}}

(Reply STOP to unsubscribe)`
  },

  AUTOMOBILE_SERVICE: {
    id: 'AUTOMOBILE_SERVICE',
    label: '🚗 Automobile / Garage / Car Detailing',
    defaultFlyerTemplate: 'Ready for {{name}}! 🚘',
    defaultMessageTemplate: `Hi {{name}}! 🚗 Your vehicle service at {{store_name}} is complete.

🧾 *Job Card / Bill #{{invoice_no}}* | Total: ₹{{total_amount}}
🌐 View Detailed Service Invoice: {{ebill_url}}

How was the quality of service & repair? Please rate our service team on Google:
⭐⭐⭐⭐⭐
👉 {{review_link}}

(Reply STOP to unsubscribe)`
  },

  SUPERMARKET_GROCERY: {
    id: 'SUPERMARKET_GROCERY',
    label: '🛒 Supermarket / Grocery / Electronics',
    defaultFlyerTemplate: 'Specially for {{name}}! 🛍️',
    defaultMessageTemplate: `Hi {{name}}! 🛒 Thank you for choosing {{store_name}} for your shopping today.

🧾 *Bill #{{invoice_no}}* | Total: ₹{{total_amount}}
🌐 View Itemized Digital Receipt: {{ebill_url}}

Could you take 5 seconds to rate our store and staff on Google? It helps our team a lot:
⭐⭐⭐⭐⭐
👉 {{review_link}}

(Reply STOP to unsubscribe)`
  },

  GENERAL_SERVICES: {
    id: 'GENERAL_SERVICES',
    label: '🏢 General Services / Custom Business',
    defaultFlyerTemplate: 'Specially for {{name}}! ✨',
    defaultMessageTemplate: `Hi {{name}}! ✨ Thank you for choosing {{store_name}} today.

🧾 *Bill #{{invoice_no}}* | Total: ₹{{total_amount}}
🌐 View Digital E-Bill: {{ebill_url}}

Could you take 5 seconds to share your experience on Google? It means the world to our team:
⭐⭐⭐⭐⭐
👉 {{review_link}}

(Reply STOP to unsubscribe)`
  }
};

/**
 * Helper to get template by category ID
 */
export function getCategoryTemplate(categoryId = 'RESTAURANT_CAFE') {
  return BUSINESS_CATEGORIES[categoryId] || BUSINESS_CATEGORIES.GENERAL_SERVICES;
}

/**
 * Render message template with dynamic placeholders
 */
export function formatWhatsAppMessage(template, placeholders = {}) {
  let msg = template || BUSINESS_CATEGORIES.GENERAL_SERVICES.defaultMessageTemplate;
  const {
    customerName = 'Valued Customer',
    storeName = 'Our Store',
    invoiceNo = 'INV-1001',
    totalAmount = '0.00',
    ebillUrl = '',
    reviewLink = ''
  } = placeholders;

  return msg
    .replace(/\{\{\s*name\s*\}\}/gi, customerName)
    .replace(/\{\{\s*store_name\s*\}\}/gi, storeName)
    .replace(/\{\{\s*invoice_no\s*\}\}/gi, invoiceNo)
    .replace(/\{\{\s*total_amount\s*\}\}/gi, totalAmount)
    .replace(/\{\{\s*ebill_url\s*\}\}/gi, ebillUrl)
    .replace(/\{\{\s*review_link\s*\}\}/gi, reviewLink);
}
