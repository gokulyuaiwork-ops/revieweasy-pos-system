const MENU_ITEMS = [
  { id: 1, name: "Margherita Pizza", price: 350, icon: "🍕" },
  { id: 2, name: "Chicken Biryani", price: 320, icon: "🍗" },
  { id: 3, name: "Cold Brew Coffee", price: 180, icon: "☕" },
  { id: 4, name: "Chocolate Brownie", price: 150, icon: "🍫" },
  { id: 5, name: "Paneer Butter Masala", price: 280, icon: "🧀" },
  { id: 6, name: "Butter Garlic Naan", price: 60, icon: "🫓" },
  { id: 7, name: "Veg Hakka Noodles", price: 210, icon: "🍜" },
  { id: 8, name: "Mango Lassi", price: 120, icon: "🥭" }
];

let cart = [
  { id: 1, name: "Margherita Pizza", price: 350, qty: 1 },
  { id: 3, name: "Cold Brew Coffee", price: 180, qty: 1 },
  { id: 4, name: "Chocolate Brownie", price: 150, qty: 1 }
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
  const gst = subtotal * 0.05; // 5% GST (2.5% CGST + 2.5% SGST)
  const grandTotal = subtotal + gst;

  document.getElementById('totSubtotal').innerText = `₹${subtotal.toFixed(2)}`;
  document.getElementById('totGst').innerText = `₹${gst.toFixed(2)}`;
  document.getElementById('totGrandTotal').innerText = `₹${grandTotal.toFixed(2)}`;

  return { subtotal, gst, grandTotal };
}

function generateReceiptText(docType = 'TAX_INVOICE') {
  const name = document.getElementById('custName').value.trim() || 'Valued Customer';
  const phone = document.getElementById('custPhone').value.trim() || '9876543219';
  const { subtotal, gst, grandTotal } = calculateTotals();
  const date = new Date().toLocaleDateString();
  const time = new Date().toLocaleTimeString();
  const invNo = 'INV-' + Math.floor(1000 + Math.random() * 9000);

  if (docType === 'KOT') {
    return `========================================
          KITCHEN ORDER TICKET (KOT)     
========================================
Table: T-04                  Server: Manoj
Time: ${time}
----------------------------------------
${cart.map(i => `${i.qty}x ${i.name}`).join('\n')}
----------------------------------------
RUNNING KOT - NOT FOR BILLING / PAYMENT
========================================`;
  }

  if (docType === 'ESTIMATE') {
    return `========================================
           SUNSHINE CAFE & BISTRO       
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
           SUNSHINE CAFE & BISTRO       
     Ph: 9840012345 (Store Helpline)    
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: ${date} ${time}
Bill #: ${invNo}
Customer: ${name}
Mobile: ${phone}
----------------------------------------
${cart.map(i => `${i.qty}x ${i.name.padEnd(20)} ₹${(i.price * i.qty).toFixed(2).padStart(8)}`).join('\n')}
----------------------------------------
Subtotal:                         ₹${subtotal.toFixed(2)}
CGST (2.5%):                       ₹${(gst/2).toFixed(2)}
SGST (2.5%):                       ₹${(gst/2).toFixed(2)}
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
      { id: 1, name: "Margherita Pizza", price: 350, qty: 1 },
      { id: 3, name: "Cold Brew Coffee", price: 180, qty: 1 },
      { id: 4, name: "Chocolate Brownie", price: 150, qty: 1 }
    ];
  } else if (type === 'KOT') {
    document.getElementById('custName').value = 'Table 4 (Dine-in)';
    document.getElementById('custPhone').value = '—';
    cart = [
      { id: 2, name: "Chicken Biryani", price: 320, qty: 2 },
      { id: 6, name: "Butter Garlic Naan", price: 60, qty: 2 }
    ];
  } else if (type === 'OWNER_PHONE') {
    document.getElementById('custName').value = 'Vikram Malhotra';
    document.getElementById('custPhone').value = '9988776655';
    cart = [
      { id: 5, name: "Paneer Butter Masala", price: 280, qty: 1 },
      { id: 6, name: "Butter Garlic Naan", price: 60, qty: 3 }
    ];
  } else if (type === 'DUMMY') {
    document.getElementById('custName').value = 'Cash Walk-in';
    document.getElementById('custPhone').value = '9999999999';
    cart = [
      { id: 8, name: "Mango Lassi", price: 120, qty: 1 }
    ];
  } else if (type === 'ESTIMATE') {
    document.getElementById('custName').value = 'Event Catering Query';
    document.getElementById('custPhone').value = '9811223344';
    cart = [
      { id: 1, name: "Margherita Pizza", price: 350, qty: 5 },
      { id: 2, name: "Chicken Biryani", price: 320, qty: 5 }
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

window.addEventListener('DOMContentLoaded', () => {
  renderMenu();
  renderCart();
});
