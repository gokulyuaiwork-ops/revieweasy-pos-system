let clientStores = [];
let globalSummary = null;
let currentPeriod = 'today'; // 'today' | 'month' | 'alltime'

// Business Category Templates & Presets
const BUSINESS_CATEGORIES = {
  RESTAURANT_CAFE: {
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

// Authentication Gate: Ensure User is Admin
function checkAdminAuth() {
  const userJson = localStorage.getItem('revieweasy_user');
  if (!userJson) {
    window.location.href = '/login.html';
    return null;
  }
  const user = JSON.parse(userJson);
  if (user.role !== 'ADMIN') {
    alert('Access Denied: Admin role required');
    window.location.href = '/index.html';
    return null;
  }
  document.getElementById('adminUserName').innerText = user.name || 'Admin';
  return user;
}

async function fetchClients() {
  try {
    const res = await fetch('/api/admin/clients');
    const data = await res.json();
    if (data.success) {
      clientStores = data.stores;
      renderClientsTable(data.stores);
      await fetchGlobalSummary();
    }
  } catch (err) {
    console.error('Failed to fetch client stores:', err);
  }
}

async function fetchGlobalSummary() {
  try {
    const res = await fetch('/api/admin/analytics/summary');
    const data = await res.json();
    if (data.success) {
      globalSummary = data;
      renderPeriodMetrics(currentPeriod);
    }
  } catch (err) {
    console.error('Failed to fetch global summary:', err);
  }
}

function switchPeriod(period) {
  currentPeriod = period;
  
  document.getElementById('tabToday').classList.toggle('active', period === 'today');
  document.getElementById('tabMonth').classList.toggle('active', period === 'month');
  document.getElementById('tabAllTime').classList.toggle('active', period === 'alltime');

  renderPeriodMetrics(period);
}

function renderPeriodMetrics(period) {
  if (!globalSummary) return;

  const totalStores = globalSummary.totalStores || clientStores.length || 0;
  document.getElementById('m_totalStores').innerText = totalStores;

  let activeData = globalSummary.today;
  let prefix = 'Today';

  if (period === 'month') {
    activeData = globalSummary.lastMonth;
    prefix = 'Monthly (30d)';
  } else if (period === 'alltime') {
    activeData = globalSummary.allTime;
    prefix = 'All-Time';
  }

  document.getElementById('lbl_m2').innerText = `${prefix} Receipts Intercepted`;
  document.getElementById('lbl_m3').innerText = `${prefix} WhatsApp Sent`;
  document.getElementById('lbl_m4').innerText = `${prefix} Revenue Tracked`;

  document.getElementById('m_totalPrints').innerText = activeData.bills || 0;
  document.getElementById('m_whatsAppDelivered').innerText = activeData.sent || 0;
  document.getElementById('m_salesTracked').innerText = `₹${(activeData.sales || 0).toLocaleString('en-IN')}`;
}

function renderClientsTable(stores) {
  const tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;

  if (stores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #64748b; padding: 24px;">No client stores configured yet. Click "Add New Client Store" above!</td></tr>`;
    return;
  }

  tbody.innerHTML = stores.map(store => {
    const a = store.analytics || { todaySent: 0, lastWeekSent: 0, lastMonthSent: 0, allTimeSent: 0 };
    const cat = BUSINESS_CATEGORIES[store.businessCategory] || BUSINESS_CATEGORIES.GENERAL_SERVICES;
    const catShort = cat.label.split('/')[0].trim();

    return `
      <tr>
        <td><strong style="color: #c084fc; font-family: 'JetBrains Mono', monospace;">${store.storeCode}</strong></td>
        <td><strong>${store.storeName}</strong></td>
        <td>
          <span style="font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25);">
            ${catShort}
          </span>
        </td>
        <td style="font-family: 'JetBrains Mono', monospace;">${store.storePhone}</td>
        <td>
          <span class="badge-status" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 700;">
            ⚡ ${a.todaySent} sent
          </span>
        </td>
        <td>
          <span class="badge-status" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">
            📅 ${a.lastWeekSent} sent
          </span>
        </td>
        <td>
          <span class="badge-status" style="background: rgba(139, 92, 246, 0.15); color: #c084fc;">
            🗓️ ${a.lastMonthSent} sent
          </span>
        </td>
        <td>
          <span class="badge-status" style="background: rgba(14, 165, 233, 0.15); color: #38bdf8; font-weight: 700;">
            ⭐ ${a.allTimeSent} sent
          </span>
        </td>
        <td>
          <div class="secret-key-chip">
            <span>${store.secretKey}</span>
            <button class="btn-copy" onclick="copySecretKey('${store.secretKey}')" title="Copy Secret Key">📋</button>
          </div>
        </td>
        <td>
          <div class="action-btns">
            <button class="btn-action" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border-color: rgba(14, 165, 233, 0.4);" onclick="openDetailsModal('${store.storeCode}')">👁️</button>
            <button class="btn-action btn-edit" onclick="openEditModal('${store.storeCode}')">✏️</button>
            <button class="btn-action btn-delete" onclick="deleteClient('${store.storeCode}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// Category & Message Template Handlers
// -------------------------------------------------------------
function handleCategoryChange(mode = 'add') {
  const catKey = document.getElementById(`${mode}_businessCategory`).value;
  const cat = BUSINESS_CATEGORIES[catKey] || BUSINESS_CATEGORIES.GENERAL_SERVICES;

  // Set message template
  document.getElementById(`${mode}_customMessageTemplate`).value = cat.defaultMessageTemplate;

  // Set flyer name template
  document.getElementById(`${mode}_flyerTemplate`).value = cat.defaultFlyerTemplate;

  if (mode === 'add') {
    updateAddFlyerStudioPreview();
  } else {
    updateEditFlyerStudioPreview();
  }
}

function resetCategoryTemplate(mode = 'add') {
  const catKey = document.getElementById(`${mode}_businessCategory`).value;
  const cat = BUSINESS_CATEGORIES[catKey] || BUSINESS_CATEGORIES.GENERAL_SERVICES;
  document.getElementById(`${mode}_customMessageTemplate`).value = cat.defaultMessageTemplate;
}

// Client Deep-Dive Modal Handlers
async function openDetailsModal(storeCode) {
  try {
    const res = await fetch(`/api/admin/clients/${storeCode}/details`);
    const data = await res.json();
    if (!data.success) {
      alert('Error fetching store details: ' + data.error);
      return;
    }

    const { store, analytics } = data;
    document.getElementById('det_storeTitle').innerHTML = `<span>🏪</span> ${store.storeName}`;
    document.getElementById('det_storeSubtitle').innerText = `Code: ${store.storeCode} | Category: ${store.businessCategory || 'RESTAURANT_CAFE'} | Helpline: ${store.storePhone}`;

    // 4-Card Time-Window Values
    document.getElementById('det_todaySent').innerText = analytics.today.sent;
    document.getElementById('det_todayBills').innerText = analytics.today.bills;
    document.getElementById('det_todaySales').innerText = analytics.today.sales.toLocaleString('en-IN');

    document.getElementById('det_weekSent').innerText = analytics.lastWeek.sent;
    document.getElementById('det_weekBills').innerText = analytics.lastWeek.bills;
    document.getElementById('det_weekSales').innerText = analytics.lastWeek.sales.toLocaleString('en-IN');

    document.getElementById('det_monthSent').innerText = analytics.lastMonth.sent;
    document.getElementById('det_monthBills').innerText = analytics.lastMonth.bills;
    document.getElementById('det_monthSales').innerText = analytics.lastMonth.sales.toLocaleString('en-IN');

    document.getElementById('det_allTimeSent').innerText = analytics.allTime.sent;
    document.getElementById('det_allTimeBills').innerText = analytics.allTime.bills;
    document.getElementById('det_reachRate').innerText = analytics.allTime.reachRate;

    // Render Store's Transaction Log
    const tbody = document.getElementById('det_billsTableBody');
    if (!analytics.recentTransactions || analytics.recentTransactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 20px;">No print jobs intercepted yet for ${store.storeName}.</td></tr>`;
    } else {
      tbody.innerHTML = analytics.recentTransactions.map(tx => {
        const timeStr = new Date(tx.timestamp).toLocaleString();
        const statusColor = tx.status === 'DELIVERED' ? '#34d399' : (tx.status === 'IGNORED_KOT' ? '#f87171' : '#60a5fa');
        return `
          <tr>
            <td style="color: #94a3b8; font-family: 'JetBrains Mono', monospace; font-size: 11px;">${timeStr}</td>
            <td><strong style="color: #38bdf8;">${tx.invoiceNo || 'N/A'}</strong></td>
            <td>${tx.customerName || 'Walk-in'}</td>
            <td style="font-family: 'JetBrains Mono', monospace;">${tx.customerPhone || '—'}</td>
            <td style="font-weight: 700; color: #f8fafc;">₹${tx.totalAmount || '0.00'}</td>
            <td>
              <span class="badge-status" style="background: rgba(255,255,255,0.05); color: ${statusColor}; font-size: 10px;">
                ${tx.status}
              </span>
            </td>
          </tr>
        `;
      }).join('');
    }

    document.getElementById('detailsModal').style.display = 'flex';
  } catch (err) {
    alert('Failed to load store analytics: ' + err.message);
  }
}

function closeDetailsModal() {
  document.getElementById('detailsModal').style.display = 'none';
}

function copySecretKey(key) {
  navigator.clipboard.writeText(key);
  alert(`📋 Secret Token copied to clipboard:\n${key}\n\nProvide this key to the merchant to bind their desktop agent!`);
}

// -------------------------------------------------------------
// Image Upload & Preview Helpers
// -------------------------------------------------------------
let addFlyerBase64 = null;
let editFlyerBase64 = null;

function previewFlyerImage(input, previewImgId, urlInputId, callback) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById(previewImgId).src = e.target.result;
      if (urlInputId === 'add_flyerUrl') {
        addFlyerBase64 = e.target.result;
      } else {
        editFlyerBase64 = e.target.result;
      }
      if (callback) callback();
    };
    reader.readAsDataURL(file);
  }
}

async function uploadFlyerImageIfNeeded(base64Data, storeCode) {
  if (!base64Data) return null;
  try {
    const res = await fetch('/api/admin/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeCode: storeCode,
        imageBase64: base64Data,
        fileName: `${storeCode}_flyer.jpg`
      })
    });
    const data = await res.json();
    if (data.success) {
      return data.imageUrl;
    }
  } catch (err) {
    console.error('Image upload failed:', err);
  }
  return null;
}

// -------------------------------------------------------------
// Dynamic Flyer Studio Controls (Add Modal)
// -------------------------------------------------------------
function setAddTemplate(tmpl) {
  document.getElementById('add_flyerTemplate').value = tmpl;
  updateAddFlyerStudioPreview();
}

function updateAddFlyerImgSrc(url) {
  if (url) {
    document.getElementById('add_flyerCanvasImg').src = url;
    updateAddFlyerStudioPreview();
  }
}

function updateAddFlyerStudioPreview() {
  const isEnabled = document.getElementById('add_flyerPersonalizeEnabled').checked;
  const badge = document.getElementById('add_nameBadge');
  
  if (!isEnabled) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'block';

  const posX = document.getElementById('add_flyerPosX').value;
  const posY = document.getElementById('add_flyerPosY').value;
  const fontSize = document.getElementById('add_flyerFontSize').value;
  const color = document.getElementById('add_flyerTextColor').value;
  const template = document.getElementById('add_flyerTemplate').value || 'Freshly prepared for {{name}}! 🍽️';

  document.getElementById('add_lblPosX').innerText = `${posX}%`;
  document.getElementById('add_lblPosY').innerText = `${posY}%`;
  document.getElementById('add_lblFontSize').innerText = `${fontSize}px`;

  const rendered = template.replace(/\{\{\s*name\s*\}\}/gi, 'Rahul Sharma').replace(/\{\{\s*first_name\s*\}\}/gi, 'Rahul');
  
  badge.innerText = rendered;
  badge.style.left = `${posX}%`;
  badge.style.top = `${posY}%`;
  badge.style.fontSize = `${Math.round(fontSize * 0.55)}px`;
  badge.style.color = color;
}

// -------------------------------------------------------------
// Dynamic Flyer Studio Controls (Edit Modal)
// -------------------------------------------------------------
function setEditTemplate(tmpl) {
  document.getElementById('edit_flyerTemplate').value = tmpl;
  updateEditFlyerStudioPreview();
}

function updateEditFlyerImgSrc(url) {
  if (url) {
    document.getElementById('edit_flyerCanvasImg').src = url;
    updateEditFlyerStudioPreview();
  }
}

function updateEditFlyerStudioPreview() {
  const isEnabled = document.getElementById('edit_flyerPersonalizeEnabled').checked;
  const badge = document.getElementById('edit_nameBadge');
  
  if (!isEnabled) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'block';

  const posX = document.getElementById('edit_flyerPosX').value;
  const posY = document.getElementById('edit_flyerPosY').value;
  const fontSize = document.getElementById('edit_flyerFontSize').value;
  const color = document.getElementById('edit_flyerTextColor').value;
  const template = document.getElementById('edit_flyerTemplate').value || 'Specially for {{name}}! ✨';

  document.getElementById('edit_lblPosX').innerText = `${posX}%`;
  document.getElementById('edit_lblPosY').innerText = `${posY}%`;
  document.getElementById('edit_lblFontSize').innerText = `${fontSize}px`;

  const rendered = template.replace(/\{\{\s*name\s*\}\}/gi, 'Rahul Sharma').replace(/\{\{\s*first_name\s*\}\}/gi, 'Rahul');
  
  badge.innerText = rendered;
  badge.style.left = `${posX}%`;
  badge.style.top = `${posY}%`;
  badge.style.fontSize = `${Math.round(fontSize * 0.55)}px`;
  badge.style.color = color;
}

// Drag and drop positioning on interactive canvases
function setupCanvasDrag(canvasId, posXInputId, posYInputId, updateCallback) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  let isDragging = false;

  const handlePointer = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    if (clientX !== undefined && clientY !== undefined) {
      let x = Math.round(((clientX - rect.left) / rect.width) * 100);
      let y = Math.round(((clientY - rect.top) / rect.height) * 100);
      x = Math.max(5, Math.min(95, x));
      y = Math.max(5, Math.min(95, y));

      document.getElementById(posXInputId).value = x;
      document.getElementById(posYInputId).value = y;
      updateCallback();
    }
  };

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    handlePointer(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) handlePointer(e);
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  canvas.addEventListener('touchstart', (e) => {
    isDragging = true;
    handlePointer(e);
  });

  window.addEventListener('touchmove', (e) => {
    if (isDragging) handlePointer(e);
  });

  window.addEventListener('touchend', () => {
    isDragging = false;
  });
}

// -------------------------------------------------------------
// Add Client Modal Handlers
// -------------------------------------------------------------
function openAddModal() {
  addFlyerBase64 = null;
  document.getElementById('addModal').style.display = 'flex';
  
  // Set default category template
  handleCategoryChange('add');
  
  updateAddFlyerStudioPreview();
  setupCanvasDrag('add_canvasWrapper', 'add_flyerPosX', 'add_flyerPosY', updateAddFlyerStudioPreview);
}

function closeAddModal() {
  document.getElementById('addModal').style.display = 'none';
}

async function handleAddClient(e) {
  e.preventDefault();
  const storeCode = document.getElementById('add_storeCode').value.trim();

  let flyerImageUrl = document.getElementById('add_flyerUrl').value.trim() || '/assets/default-review-flyer.jpg';
  if (addFlyerBase64) {
    const uploadedUrl = await uploadFlyerImageIfNeeded(addFlyerBase64, storeCode);
    if (uploadedUrl) flyerImageUrl = uploadedUrl;
  }

  const flyerOverlayConfig = {
    enabled: document.getElementById('add_flyerPersonalizeEnabled').checked,
    template: document.getElementById('add_flyerTemplate').value.trim() || 'Specially for {{name}}! ✨',
    posX: parseInt(document.getElementById('add_flyerPosX').value, 10) || 50,
    posY: parseInt(document.getElementById('add_flyerPosY').value, 10) || 18,
    fontSize: parseInt(document.getElementById('add_flyerFontSize').value, 10) || 28,
    color: document.getElementById('add_flyerTextColor').value || '#FFFFFF',
    badgeBg: 'rgba(0, 0, 0, 0.70)'
  };

  const payload = {
    storeCode: storeCode,
    storeName: document.getElementById('add_storeName').value.trim(),
    storePhone: document.getElementById('add_storePhone').value.trim(),
    storeGstin: document.getElementById('add_storeGstin').value.trim(),
    googleReviewUrl: document.getElementById('add_reviewUrl').value.trim(),
    businessCategory: document.getElementById('add_businessCategory').value,
    customWhatsAppTemplate: document.getElementById('add_customMessageTemplate').value.trim(),
    clientEmail: document.getElementById('add_clientEmail').value.trim(),
    clientPassword: document.getElementById('add_clientPassword').value,
    enableDigitalReceipts: document.getElementById('add_enableDigitalReceipts').checked,
    enableImageMessage: true,
    flyerImageUrl: flyerImageUrl,
    flyerOverlayConfig: flyerOverlayConfig
  };

  try {
    const res = await fetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      alert(`✅ New Merchant Store Account Created!\n\nStore: ${data.store.storeName}\nCategory: ${payload.businessCategory}\nLogin Email: ${payload.clientEmail || 'N/A'}\nSecret Key: ${data.store.secretKey}`);
      closeAddModal();
      fetchClients();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Failed to add client: ' + err.message);
  }
}

// -------------------------------------------------------------
// Edit Client Modal Handlers
// -------------------------------------------------------------
function openEditModal(storeCode) {
  const store = clientStores.find(s => s.storeCode === storeCode);
  if (!store) return;

  editFlyerBase64 = null;
  document.getElementById('edit_storeCode').value = store.storeCode;
  document.getElementById('edit_storeName').value = store.storeName;
  document.getElementById('edit_storePhone').value = store.storePhone;
  document.getElementById('edit_reviewUrl').value = store.googleReviewUrl;
  document.getElementById('edit_status').value = store.status || 'ACTIVE';
  document.getElementById('edit_enableDigitalReceipts').checked = store.enableDigitalReceipts !== false;

  const category = store.businessCategory || 'RESTAURANT_CAFE';
  document.getElementById('edit_businessCategory').value = category;

  const catDefault = (BUSINESS_CATEGORIES[category] || BUSINESS_CATEGORIES.GENERAL_SERVICES).defaultMessageTemplate;
  document.getElementById('edit_customMessageTemplate').value = store.customWhatsAppTemplate || catDefault;

  const flyerUrl = store.flyerImageUrl || '/assets/default-review-flyer.jpg';
  document.getElementById('edit_flyerUrl').value = flyerUrl;
  document.getElementById('edit_flyerCanvasImg').src = flyerUrl;

  const overlay = store.flyerOverlayConfig || {
    enabled: true,
    template: 'Specially for {{name}}! ✨',
    posX: 50,
    posY: 18,
    fontSize: 28,
    color: '#FFFFFF'
  };

  document.getElementById('edit_flyerPersonalizeEnabled').checked = overlay.enabled !== false;
  document.getElementById('edit_flyerTemplate').value = overlay.template || 'Specially for {{name}}! ✨';
  document.getElementById('edit_flyerPosX').value = overlay.posX || 50;
  document.getElementById('edit_flyerPosY').value = overlay.posY || 18;
  document.getElementById('edit_flyerFontSize').value = overlay.fontSize || 28;
  document.getElementById('edit_flyerTextColor').value = overlay.color || '#FFFFFF';

  document.getElementById('editModal').style.display = 'flex';
  updateEditFlyerStudioPreview();
  setupCanvasDrag('edit_canvasWrapper', 'edit_flyerPosX', 'edit_flyerPosY', updateEditFlyerStudioPreview);
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
}

async function handleEditClient(e) {
  e.preventDefault();
  const storeCode = document.getElementById('edit_storeCode').value;

  let flyerImageUrl = document.getElementById('edit_flyerUrl').value.trim() || '/assets/default-review-flyer.jpg';
  if (editFlyerBase64) {
    const uploadedUrl = await uploadFlyerImageIfNeeded(editFlyerBase64, storeCode);
    if (uploadedUrl) flyerImageUrl = uploadedUrl;
  }

  const flyerOverlayConfig = {
    enabled: document.getElementById('edit_flyerPersonalizeEnabled').checked,
    template: document.getElementById('edit_flyerTemplate').value.trim() || 'Specially for {{name}}! ✨',
    posX: parseInt(document.getElementById('edit_flyerPosX').value, 10) || 50,
    posY: parseInt(document.getElementById('edit_flyerPosY').value, 10) || 18,
    fontSize: parseInt(document.getElementById('edit_flyerFontSize').value, 10) || 28,
    color: document.getElementById('edit_flyerTextColor').value || '#FFFFFF',
    badgeBg: 'rgba(0, 0, 0, 0.70)'
  };

  const payload = {
    storeName: document.getElementById('edit_storeName').value.trim(),
    storePhone: document.getElementById('edit_storePhone').value.trim(),
    googleReviewUrl: document.getElementById('edit_reviewUrl').value.trim(),
    status: document.getElementById('edit_status').value,
    businessCategory: document.getElementById('edit_businessCategory').value,
    customWhatsAppTemplate: document.getElementById('edit_customMessageTemplate').value.trim(),
    enableDigitalReceipts: document.getElementById('edit_enableDigitalReceipts').checked,
    enableImageMessage: true,
    flyerImageUrl: flyerImageUrl,
    flyerOverlayConfig: flyerOverlayConfig
  };

  try {
    const res = await fetch(`/api/admin/clients/${storeCode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      alert(`✅ Store ${storeCode} updated successfully with category & customized WhatsApp template!`);
      closeEditModal();
      fetchClients();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Failed to update client: ' + err.message);
  }
}

async function deleteClient(storeCode) {
  if (confirm(`⚠️ Are you sure you want to delete client store [${storeCode}]?\nThis will revoke their secret key and delete merchant access.`)) {
    try {
      const res = await fetch(`/api/admin/clients/${storeCode}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        alert(`🗑️ Client store ${storeCode} deleted.`);
        fetchClients();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Failed to delete client: ' + err.message);
    }
  }
}

function logout() {
  localStorage.removeItem('revieweasy_user');
  window.location.href = '/login.html';
}

window.addEventListener('DOMContentLoaded', () => {
  if (checkAdminAuth()) {
    fetchClients();
  }
});
