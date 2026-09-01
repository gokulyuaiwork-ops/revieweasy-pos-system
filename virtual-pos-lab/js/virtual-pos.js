let currentStoreInfo = {
  storeCode: 'ABC STORE',
  storeName: 'Demo business',
  storePhone: '9342350747',
  storeGstin: '33AABCS1429B1ZB',
  businessCategory: 'AUTOMOBILE_SERVICE'
};

const CATEGORY_CATALOGS = {
  AUTOMOBILE_SERVICE: [
    { id: 1, name: "Periodic General Service", price: 1850, icon: "🚗" },
    { id: 2, name: "Synthetic Engine Oil 5W30", price: 1200, icon: "🛢️" },
    { id: 3, name: "Front Brake Pad Set", price: 650, icon: "🛑" },
    { id: 4, name: "AC Cabin Filter Clean", price: 450, icon: "❄️" },
    { id: 5, name: "Wheel Alignment & Balance", price: 550, icon: "🛞" },
    { id: 6, name: "Full Body Foam Wash & Wax", price: 350, icon: "✨" }
  ],
  RESTAURANT_CAFE: [
    { id: 1, name: "Margherita Pizza", price: 350, icon: "🍕" },
    { id: 2, name: "Chicken Biryani", price: 320, icon: "🍗" },
    { id: 3, name: "Cold Brew Coffee", price: 180, icon: "☕" },
    { id: 4, name: "Chocolate Brownie", price: 150, icon: "🍫" },
    { id: 5, name: "Paneer Butter Masala", price: 280, icon: "🧀" },
    { id: 6, name: "Butter Garlic Naan", price: 60, icon: "🫓" }
  ],
  GENERAL_SERVICES: [
    { id: 1, name: "Premium Service Package", price: 1500, icon: "⭐" },
    { id: 2, name: "Standard Consultation", price: 800, icon: "📋" },
    { id: 3, name: "Express Diagnostic", price: 450, icon: "🔍" },
    { id: 4, name: "Maintenance Tune-up", price: 650, icon: "🛠️" }
  ]
};

let MENU_ITEMS = CATEGORY_CATALOGS.AUTOMOBILE_SERVICE;

let cart = [
  { id: 1, name: "Periodic General Service", price: 1850, qty: 1 },
  { id: 2, name: "Synthetic Engine Oil 5W30", price: 1200, qty: 1 }
];

let lastGeneratedBill = null;

function renderMenu() {
  const grid = document.getElementById('menuGrid');
  if (!grid) return;

  grid.innerHTML = MENU_ITEMS.map(item => `
    <button class="menu-item-btn" onclick="addToCart(${item.id})">
      <span class="item-icon">${item.icon}</span>
      <span class="item-name">${item.name}</span>
      <span class="item-price">₹${item.price}</span>
    </button>
  `).join('');
}

function renderCart() {
  const tbody = document.getElementById('cartTableBody');
  if (!tbody) return;

  if (cart.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #64748b; padding: 16px;">Cart is empty. Click items on the left!</td></tr>`;
    calculateTotals();
    return;
  }

  tbody.innerHTML = cart.map((item, idx) => `
    <tr>
      <td><strong>${item.name}</strong></td>
      <td>
        <input type="number" min="1" value="${item.qty}" style="width: 38px; padding: 2px 4px; background: rgba(0,0,0,0.3); border: 1px solid #334155; color: white; border-radius: 4px;" onchange="updateQty(${idx}, this.value)">
      </td>
      <td style="color: #38bdf8; font-weight: 700;">₹${item.price * item.qty}</td>
      <td><button class="btn-del" onclick="removeFromCart(${idx})">✕</button></td>
    </tr>
  `).join('');

  calculateTotals();
}

function addToCart(itemId) {
  const found = cart.find(c => c.id === itemId);
  if (found) {
    found.qty++;
  } else {
    const item = MENU_ITEMS.find(m => m.id === itemId);
    if (item) {
      cart.push({ ...item, qty: 1 });
    }
  }
  renderCart();
}

function updateQty(idx, newQty) {
  const qty = parseInt(newQty);
  if (qty <= 0) {
    removeFromCart(idx);
  } else {
    cart[idx].qty = qty;
    renderCart();
  }
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  renderCart();
}

function calculateTotals() {
  const subtotal = cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
  const gst = subtotal * 0.18; // 18% GST (9% CGST + 9% SGST)
  const grandTotal = subtotal + gst;

  const subEl = document.getElementById('totSubtotal');
  const gstEl = document.getElementById('totGst');
  const grandEl = document.getElementById('totGrandTotal');
  if (subEl) subEl.innerText = `₹${subtotal.toFixed(2)}`;
  if (gstEl) gstEl.innerText = `₹${gst.toFixed(2)}`;
  if (grandEl) grandEl.innerText = `₹${grandTotal.toFixed(2)}`;

  return { subtotal, gst, grandTotal };
}

function generateReceiptText(docType = 'TAX_INVOICE') {
  const name = document.getElementById('custName').value.trim() || 'Rahul Sharma';
  const phone = document.getElementById('custPhone').value.trim() || '9876543219';
  const { subtotal, gst, grandTotal } = calculateTotals();
  const date = new Date().toLocaleDateString();
  const time = new Date().toLocaleTimeString();
  const invNo = 'INV-' + Math.floor(1000 + Math.random() * 9000);

  const storeNameUpper = (currentStoreInfo.storeName || 'Demo business').toUpperCase();
  const storePhone = currentStoreInfo.storePhone || '9342350747';
  const storeGstin = currentStoreInfo.storeGstin || '33AABCS1429B1ZB';

  if (docType === 'KOT') {
    return `========================================
          JOB CARD / WORK ORDER TICKET     
========================================
Bay: Bay #02                  Tech: Manoj
Time: ${time}
----------------------------------------
${cart.map(i => `${i.qty}x ${i.name}`).join('\n')}
----------------------------------------
RUNNING JOB - NOT FOR BILLING / PAYMENT
========================================`;
  }

  if (docType === 'ESTIMATE') {
    return `========================================
           ${storeNameUpper.padStart(20 + Math.floor(storeNameUpper.length / 2)).padEnd(40)}
========================================
Date: ${date} ${time}
Customer: ${name}
Mobile: ${phone}
----------------------------------------
${cart.map(i => `${i.qty}x ${i.name.padEnd(20)} ₹${(i.price * i.qty).toFixed(2).padStart(8)}`).join('\n')}
----------------------------------------
TOTAL ESTIMATE AMOUNT:        ₹${subtotal.toFixed(2)}
========================================
      ROUGH ESTIMATE - NOT A TAX INVOICE
========================================`;
  }

  // Standard Tax Invoice
  return `========================================
           ${storeNameUpper.padStart(20 + Math.floor(storeNameUpper.length / 2)).padEnd(40)}
     Ph: ${storePhone} (Helpline)    
       GSTIN: ${storeGstin}             
========================================
Date: ${date} ${time}
Bill #: ${invNo}
Customer: ${name}
Mobile: ${phone}
----------------------------------------
${cart.map(i => `${i.qty}x ${i.name.padEnd(20)} ₹${(i.price * i.qty).toFixed(2).padStart(8)}`).join('\n')}
----------------------------------------
Subtotal:                         ₹${subtotal.toFixed(2)}
CGST (9.0%):                       ₹${(gst/2).toFixed(2)}
SGST (9.0%):                       ₹${(gst/2).toFixed(2)}
----------------------------------------
TOTAL AMOUNT:                     ₹${grandTotal.toFixed(2)}
========================================
          TAX INVOICE - PAID VIA UPI     
        THANK YOU! VISIT AGAIN          
========================================`;
}

function loadPreset(type) {
  if (type === 'NORMAL') {
    document.getElementById('custName').value = 'Rahul Sharma';
    document.getElementById('custPhone').value = '9876543219';
    cart = [
      { id: 1, name: "Periodic General Service", price: 1850, qty: 1 },
      { id: 2, name: "Synthetic Engine Oil 5W30", price: 1200, qty: 1 }
    ];
  } else if (type === 'KOT') {
    document.getElementById('custName').value = 'Bay 2 (Service In-Progress)';
    document.getElementById('custPhone').value = '—';
    cart = [
      { id: 3, name: "Front Brake Pad Set", price: 650, qty: 1 },
      { id: 4, name: "AC Cabin Filter Clean", price: 450, qty: 1 }
    ];
  } else if (type === 'OWNER_PHONE') {
    document.getElementById('custName').value = 'Store Owner Test';
    document.getElementById('custPhone').value = currentStoreInfo.storePhone || '9342350747';
    cart = [
      { id: 6, name: "Full Body Foam Wash & Wax", price: 350, qty: 1 }
    ];
  } else if (type === 'DUMMY') {
    document.getElementById('custName').value = 'Cash Customer';
    document.getElementById('custPhone').value = '9999999999';
    cart = [
      { id: 5, name: "Wheel Alignment & Balance", price: 550, qty: 1 }
    ];
  } else if (type === 'ESTIMATE') {
    document.getElementById('custName').value = 'Fleet Maintenance Query';
    document.getElementById('custPhone').value = '9811223344';
    cart = [
      { id: 1, name: "Periodic General Service", price: 1850, qty: 3 },
      { id: 2, name: "Synthetic Engine Oil 5W30", price: 1200, qty: 3 }
    ];
  }

  renderCart();
}

function triggerPrint(docType) {
  let receiptText = '';
  if (docType === 'REPRINT') {
    receiptText = lastGeneratedBill || generateReceiptText('TAX_INVOICE');
  } else {
    receiptText = generateReceiptText(docType);
    if (docType === 'TAX_INVOICE') {
      lastGeneratedBill = receiptText;
    }
  }

  // Send to the 80mm Virtual Printer
  if (window.VirtualPrinter) {
    window.VirtualPrinter.printReceipt(receiptText, docType);
  }
}

function getActiveStoreCode() {
  const select = document.getElementById('posStoreSelect');
  const input = document.getElementById('posStoreCode');
  const val = (select && select.value) || (input && input.value) || 'ABC STORE';
  return val.trim().toUpperCase();
}

function onStoreCodeChanged(newCode) {
  const cleanCode = (newCode || 'ABC STORE').trim().toUpperCase();
  localStorage.setItem('revieweasy_lab_store_code', cleanCode);
  
  const input = document.getElementById('posStoreCode');
  if (input) input.value = cleanCode;

  const dashLink = document.getElementById('dashLinkBtn');
  if (dashLink) {
    dashLink.href = `http://localhost:3000?store=${cleanCode}`;
  }

  if (window.registeredStores) {
    const s = window.registeredStores.find(st => (st.storeCode || '').toUpperCase() === cleanCode);
    if (s) {
      currentStoreInfo = {
        storeCode: s.storeCode,
        storeName: s.storeName,
        storePhone: s.storePhone || '9342350747',
        storeGstin: s.storeGstin || '33AABCS1429B1ZB',
        businessCategory: s.businessCategory || 'AUTOMOBILE_SERVICE'
      };

      // Switch catalog based on store category
      MENU_ITEMS = CATEGORY_CATALOGS[s.businessCategory] || CATEGORY_CATALOGS.AUTOMOBILE_SERVICE;
      loadPreset('NORMAL');
      renderMenu();

      const titleEl = document.querySelector('.pos-title h2');
      if (titleEl) {
        titleEl.innerText = `🚗 ${s.storeName} POS`;
      }
    }
  }
}

async function loadStoreList() {
  try {
    const res = await fetch('http://localhost:3000/api/admin/clients');
    const data = await res.json();
    if (data && data.stores && data.stores.length > 0) {
      window.registeredStores = data.stores;
      const select = document.getElementById('posStoreSelect');
      if (select) {
        select.innerHTML = data.stores.map(s => `
          <option value="${s.storeCode}" ${s.storeCode === 'ABC STORE' ? 'selected' : ''}>
            ${s.storeCode} (${s.storeName})
          </option>
        `).join('');
      }
      onStoreCodeChanged(select ? select.value : 'ABC STORE');
    }
  } catch (e) {
    console.warn('[Virtual POS] Could not fetch live stores, using default ABC STORE');
  }
}

window.getActiveStoreCode = getActiveStoreCode;
window.onStoreCodeChanged = onStoreCodeChanged;

window.addEventListener('DOMContentLoaded', () => {
  renderMenu();
  renderCart();
  loadStoreList();
});
