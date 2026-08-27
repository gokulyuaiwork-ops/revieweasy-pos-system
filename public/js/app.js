let ws = null;
let currentConfig = {};
let isInternetOffline = false;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const PRESET_SCENARIOS = {
  STANDARD_INVOICE: `========================================
           SUNSHINE CAFE & BISTRO       
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-${Math.floor(1000 + Math.random() * 9000)}
Customer: Rahul Sharma
Mobile: 9876543219
----------------------------------------
1x Margherita Pizza               ₹350.00
1x Cold Brew Coffee               ₹180.00
1x Belgian Chocolate Brownie      ₹150.00
----------------------------------------
Subtotal:                         ₹680.00
CGST (2.5%):                       ₹17.00
SGST (2.5%):                       ₹17.00
----------------------------------------
TOTAL AMOUNT:                     ₹714.00
========================================
         TAX INVOICE - PAID VIA UPI     
        THANK YOU! VISIT AGAIN          
========================================`,

  KOT_SLIP: `========================================
          KITCHEN ORDER TICKET (KOT)     
========================================
Table: T-04                  Server: Manoj
Time: ${new Date().toLocaleTimeString()}
----------------------------------------
2x Chicken Biryani [SPICY]
1x Butter Naan
1x Paneer Butter Masala
----------------------------------------
RUNNING KOT - NOT FOR PAYMENT
========================================`,

  REPRINT_JAM: `========================================
           SUNSHINE CAFE & BISTRO       
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-9901
Customer: Priya Sundaram
Mobile: 9840156789
----------------------------------------
TOTAL AMOUNT:                     ₹450.00
========================================
         TAX INVOICE - REPRINT COPY     
========================================`,

  OWNER_PHONE_HEADER: `========================================
           SUNSHINE CAFE & BISTRO       
     Ph: 9840012345 (Store Helpline)    
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-${Math.floor(1000 + Math.random() * 9000)}
Customer: Vikram Malhotra
Mobile: 9988776655
----------------------------------------
TOTAL AMOUNT:                     ₹890.00
========================================
              TAX INVOICE               
========================================`,

  DUMMY_NUMBER: `========================================
           SUNSHINE CAFE & BISTRO       
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-${Math.floor(1000 + Math.random() * 9000)}
Customer: Walk-in Cashier Bypass
Mobile: 9999999999
----------------------------------------
TOTAL AMOUNT:                     ₹120.00
========================================
              TAX INVOICE               
========================================`,

  TCP_9100_STREAM: `========================================
       PETPOOJA DIRECT LAN PRINT STREAM 
========================================
Bill No: PP-${Math.floor(1000 + Math.random() * 9000)}
Customer: Ananya Desai
Mobile: +91 97654 32101
----------------------------------------
1x Veg Fried Rice                 ₹220.00
1x Chilli Paneer                  ₹240.00
----------------------------------------
NET PAYABLE:                      ₹460.00
========================================
      TAX INVOICE - TCP PORT 9100       
========================================`,

  MIDNIGHT_OUTAGE: `========================================
           SUNSHINE CAFE & BISTRO       
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-NIGHT-01
Customer: Late Night Diner
Mobile: 9811223344
----------------------------------------
TOTAL AMOUNT:                     ₹520.00
========================================
              TAX INVOICE               
========================================`,

  RASTER_BITMAP: `\x1D\x76\x30\x00\x30\x00\x10\x00
[GRAPHIC_GDI_RASTER_CANVAS_1BIT_MONOCHROME]
========================================
           SUNSHINE CAFE (GDI)          
========================================
Bill #: INV-GDI-${Math.floor(1000 + Math.random() * 9000)}
Customer: Sneha Patel
Mobile: 9820011223
TOTAL AMOUNT:                     ₹340.00
========================================
              TAX INVOICE               
========================================`,

  SHIELD_NEGATIVE_FEEDBACK: `========================================
           SUNSHINE CAFE & BISTRO       
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-SHIELD-01
Customer: Raghavendra Nair
Mobile: 9840291823
----------------------------------------
1x Paneer Tikka Platter               ₹320.00
1x Virgin Mojito                      ₹140.00
----------------------------------------
TOTAL AMOUNT:                     ₹460.00
========================================
          TAX INVOICE - PAID VIA CARD   
========================================`,

  SHIELD_POSITIVE_GOOGLE: `========================================
           SUNSHINE CAFE & BISTRO       
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-5STAR-02
Customer: Meera Krishnan
Mobile: 9884129841
----------------------------------------
1x Truffle Mushroom Pasta             ₹450.00
1x Tiramisu Slice                     ₹220.00
----------------------------------------
TOTAL AMOUNT:                     ₹670.00
========================================
          TAX INVOICE - PAID VIA UPI    
========================================`,

  WINBACK_RECOVERED_CUSTOMER: `========================================
           SUNSHINE CAFE & BISTRO       
      GSTIN: 33AABCS1429B1ZB             
========================================
Date: ${new Date().toLocaleDateString()}      Bill #: INV-WINBACK-99
Customer: Arjun Kapoor (Lapsed Re-Visit)
Mobile: 9840199999
----------------------------------------
2x Signature Hazelnut Cold Brew       ₹380.00
1x Avocado Sourdough Toast            ₹320.00
1x Blueberry Cheesecake               ₹250.00
----------------------------------------
TOTAL AMOUNT:                     ₹950.00
========================================
    TAX INVOICE - RECOVERED WIN-BACK    
========================================`
};

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('[Dashboard] Connected to real-time telemetry feed');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleSocketMessage(msg);
    } catch (err) {
      console.error('[Dashboard] Error parsing WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    console.warn('[Dashboard] WebSocket disconnected. Reconnecting in 2s...');
    setTimeout(connectWebSocket, 2000);
  };
}

// Periodic state polling ensures live numbers on cloud and local
setInterval(() => {
  fetchState();
}, 4000);

let clientPeriod = 'today'; // 'today' | 'month' | 'alltime'
let clientAnalytics = null;

function getActiveStoreCode() {
  const userJson = localStorage.getItem('revieweasy_user');
  if (userJson) {
    try {
      const user = JSON.parse(userJson);
      if (user && (user.storeCode || (user.store && user.store.storeCode))) {
        return (user.storeCode || user.store.storeCode).toUpperCase();
      }
    } catch (e) {}
  }
  return (currentConfig && currentConfig.storeCode ? currentConfig.storeCode : 'STORE_DEMO_01').toUpperCase();
}

function handleSocketMessage(msg) {
  const { type, data } = msg;

  if (type === 'INITIAL_STATE') {
    currentConfig = data.config;
    if (data.analytics) {
      clientAnalytics = data.analytics;
      renderClientPeriodMetrics(clientPeriod);
    } else {
      renderMetrics(data.metrics);
    }
    renderConfig(data.config);
    renderQuota(data.quota);

    const storeCode = getActiveStoreCode();
    const storeTxs = (data.transactions || []).filter(t => (t.storeCode || 'STORE_DEMO_01').toUpperCase() === storeCode);
    renderTransactions(storeTxs);

    renderHealth(data.health);
    renderWhatsAppStatus(data.whatsapp);
    renderSupabaseStatus(data.supabase);
    fetchFeedbacks();
    fetchWinBackData();
  } else if (type === 'NEW_PRINT_JOB' || type === 'TRANSACTION_UPDATED') {
    fetchState();
    fetchWinBackData();
  } else if (type === 'METRICS_UPDATED') {
    fetchState();
  } else if (type === 'QUOTA_UPDATED') {
    renderQuota(data);
  } else if (type === 'FEEDBACK_RECEIVED' || type === 'FEEDBACK_UPDATED') {
    fetchFeedbacks();
    fetchState();
  } else if (type === 'WINBACK_DISPATCHED') {
    fetchWinBackData();
    fetchState();
  } else if (type === 'DIGEST_SENT') {
    alert(`🌙 Closing Digest sent to owner +91 ${data.recipientPhone} (${data.storeName})!`);
    fetchState();
  } else if (type === 'CONFIG_UPDATED') {
    currentConfig = data;
    renderConfig(data);
  } else if (type === 'USB_PORT_REBOUND') {
    document.getElementById('usbDeviceText').innerText = data.device.name;
    document.getElementById('usbStatusChip').classList.add('chip-green');
  } else if (type === 'WHATSAPP_QR') {
    renderWhatsAppQR(data.qrDataUrl);
  } else if (type === 'WHATSAPP_STATUS') {
    renderWhatsAppStatus(data);
  } else if (type === 'CLOUD_SYNC_STATUS' || type === 'CONNECTIVITY_CHANGED') {
    renderSupabaseStatus(data);
  } else if (type === 'UPDATER_STATUS') {
    renderUpdaterStatus(data);
  } else if (type === 'STATE_CLEARED') {
    fetchState();
    fetchFeedbacks();
    fetchWinBackData();
  }
}

async function fetchState() {
  try {
    const storeCode = getActiveStoreCode();
    const res = await fetch(`/api/state?store=${encodeURIComponent(storeCode)}`);
    const state = await res.json();
    
    if (state.analytics) {
      clientAnalytics = state.analytics;
      renderClientPeriodMetrics(clientPeriod);
    } else {
      renderMetrics(state.metrics);
    }

    renderQuota(state.quota);
    renderTransactions(state.transactions);
    renderHealth(state.health);
    renderWhatsAppStatus(state.whatsapp);
    renderSupabaseStatus(state.supabase);
  } catch (err) {
    console.error('Failed to fetch state:', err);
  }
}

function switchClientPeriod(period) {
  clientPeriod = period;
  const btnToday = document.getElementById('tabClientToday');
  const btnMonth = document.getElementById('tabClientMonth');
  const btnAll = document.getElementById('tabClientAllTime');

  if (btnToday) btnToday.classList.toggle('active', period === 'today');
  if (btnMonth) btnMonth.classList.toggle('active', period === 'month');
  if (btnAll) btnAll.classList.toggle('active', period === 'alltime');

  renderClientPeriodMetrics(period);
}

function renderClientPeriodMetrics(period) {
  if (!clientAnalytics) return;

  let activeData = clientAnalytics.today || {};
  let prefix = 'Today';

  if (period === 'month') {
    activeData = clientAnalytics.lastMonth || {};
    prefix = '30-Day';
  } else if (period === 'alltime') {
    activeData = clientAnalytics.allTime || {};
    prefix = 'All-Time';
  }

  // 1. Invoices & Sales
  const elPrints = document.getElementById('m_totalPrints');
  const elSales = document.getElementById('m_totalSales');
  const lblPrints = document.getElementById('lbl_totalPrints');
  if (elPrints) elPrints.innerText = activeData.bills || 0;
  if (elSales) elSales.innerText = (activeData.sales || 0).toLocaleString('en-IN');
  if (lblPrints) lblPrints.innerText = `${prefix} Invoices`;

  // 2. WhatsApp Delivered & Reach Rate
  const elSent = document.getElementById('m_whatsAppDelivered');
  const elReach = document.getElementById('m_reachRate');
  const lblSent = document.getElementById('lbl_whatsAppDelivered');
  if (elSent) elSent.innerText = activeData.sent || 0;
  if (elReach) elReach.innerText = activeData.reachRate !== undefined ? activeData.reachRate : 100;
  if (lblSent) lblSent.innerText = `${prefix} Sent`;

  // 3. Google 5-Star Reviews
  const elPos = document.getElementById('m_positiveReviewsRedirected');
  const lblPos = document.getElementById('lbl_positiveReviews');
  if (elPos) elPos.innerText = activeData.positiveRedirects || 0;
  if (lblPos) lblPos.innerText = `${prefix} Google 5★`;

  // 4. Review Shield (Deflected Complaints)
  const elNeg = document.getElementById('m_negativeReviewsShielded');
  const lblNeg = document.getElementById('lbl_negativeReviews');
  if (elNeg) elNeg.innerText = activeData.shieldedGrievances || 0;
  if (lblNeg) lblNeg.innerText = `${prefix} Review Shield`;
}

function renderMetrics(m) {
  if (!m) return;
  document.getElementById('m_totalPrints').innerText = m.totalPrintsIntercepted || 0;
  document.getElementById('m_validInvoices').innerText = m.validInvoicesProcessed || 0;
  document.getElementById('m_kotsBlocked').innerText = m.kotsBlocked || 0;
  document.getElementById('m_dummyFiltered').innerText = m.dummyNumbersRejected || 0;
  document.getElementById('m_duplicatesSuppressed').innerText = m.duplicatesSuppressed || 0;
  document.getElementById('m_whatsAppDelivered').innerText = m.whatsAppDelivered || 0;
  const neg = document.getElementById('m_negativeReviewsShielded');
  if (neg) neg.innerText = m.negativeReviewsShielded || 0;
  const pos = document.getElementById('m_positiveReviewsRedirected');
  if (pos) pos.innerText = m.positiveReviewsRedirected || 0;
}

function renderQuota(quota) {
  if (!quota) return;

  const dailyText = document.getElementById('quotaDailyText');
  const remText = document.getElementById('quotaRemainingText');
  const bar = document.getElementById('quotaProgressBar');
  const slotBadge = document.getElementById('quotaCurrentSlotBadge');

  if (dailyText) dailyText.innerText = `${quota.dailyUsed} / ${quota.dailyMax} Sent`;
  if (remText) remText.innerText = `${quota.dailyRemaining} remaining`;

  if (bar) {
    const pct = Math.min(100, Math.round((quota.dailyUsed / (quota.dailyMax || 50)) * 100));
    bar.style.width = `${pct}%`;
    if (pct >= 100) {
      bar.style.background = '#ef4444';
    } else if (pct >= 80) {
      bar.style.background = '#f59e0b';
    } else {
      bar.style.background = 'linear-gradient(90deg, #10b981, #38bdf8)';
    }
  }

  if (slotBadge) {
    if (quota.currentSlot === 'MORNING') {
      slotBadge.innerText = '🌅 MORNING SLOT ACTIVE';
      slotBadge.style.background = 'rgba(245, 158, 11, 0.2)';
      slotBadge.style.color = '#fbbf24';
    } else if (quota.currentSlot === 'AFTERNOON') {
      slotBadge.innerText = '☀️ AFTERNOON SLOT ACTIVE';
      slotBadge.style.background = 'rgba(59, 130, 246, 0.2)';
      slotBadge.style.color = '#60a5fa';
    } else if (quota.currentSlot === 'EVENING') {
      slotBadge.innerText = '🌙 EVENING SLOT ACTIVE';
      slotBadge.style.background = 'rgba(168, 85, 247, 0.2)';
      slotBadge.style.color = '#c084fc';
    } else {
      slotBadge.innerText = '🌙 QUIET HOURS (HELD)';
      slotBadge.style.background = 'rgba(100, 116, 139, 0.2)';
      slotBadge.style.color = '#94a3b8';
    }
  }

  // Render Slots
  if (quota.slots) {
    const m = quota.slots.morning;
    const a = quota.slots.afternoon;
    const e = quota.slots.evening;

    if (m) {
      const el = document.getElementById('slotMorningCount');
      if (el) el.innerText = `${m.used} / ${m.max}`;
      const st = document.getElementById('slotMorningStatus');
      if (st) st.innerText = m.used >= m.max ? '⚠️ Full (Rolls to Aft)' : `${m.remaining} left`;
    }
    if (a) {
      const el = document.getElementById('slotAfternoonCount');
      if (el) el.innerText = `${a.used} / ${a.max}`;
      const st = document.getElementById('slotAfternoonStatus');
      if (st) st.innerText = a.used >= a.max ? '⚠️ Full (Rolls to Eve)' : `${a.remaining} left`;
    }
    if (e) {
      const el = document.getElementById('slotEveningCount');
      if (el) el.innerText = `${e.used} / ${e.max}`;
      const st = document.getElementById('slotEveningStatus');
      if (st) st.innerText = e.used >= e.max ? '⚠️ Full (Rolls to Next Day)' : `${e.remaining} left`;
    }
  }
}

function renderTransactions(txList) {
  const tbody = document.getElementById('txTableBody');
  if (!tbody || !txList) return;

  const storeCode = getActiveStoreCode();
  const filteredList = txList.filter(tx => (tx.storeCode || 'STORE_DEMO_01').toUpperCase() === storeCode);

  if (filteredList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 32px 16px; font-weight: 500;">No print jobs intercepted yet. Incoming POS receipts will appear here in real-time.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredList.map(tx => {
    const timeStr = new Date(tx.timestamp).toLocaleTimeString();
    const statusClass = `status-${tx.status}`;
    const syncBadge = tx.synced === 1
      ? `<span style="color: #059669; font-size: 11px; margin-left: 4px;" title="Synced to Supabase Cloud">☁️</span>`
      : `<span style="color: #d97706; font-size: 11px; margin-left: 4px;" title="Offline Disk Cache">💾</span>`;

    return `
      <tr>
        <td style="color: #64748b; font-family: 'JetBrains Mono', monospace; font-size: 11px;">${timeStr}</td>
        <td><strong style="color: #0284c7; font-family: 'JetBrains Mono', monospace;">${escapeHtml(tx.invoiceNo || 'N/A')}</strong>${syncBadge}</td>
        <td style="font-weight: 600; color: #0f172a;">${escapeHtml(tx.customerName || 'Valued Customer')}</td>
        <td style="font-family: 'JetBrains Mono', monospace; color: #334155;">${escapeHtml(tx.formattedPhone || tx.customerPhone || '—')}</td>
        <td style="font-weight: 700; color: #0f172a;">₹${escapeHtml(tx.totalAmount || '0.00')}</td>
        <td>
          <span class="badge-status ${statusClass}">${formatStatus(tx.status)}</span>
        </td>
      </tr>
    `;
  }).join('');
}

function formatStatus(status) {
  const map = {
    'VALID_INVOICE': 'Valid Invoice',
    'SCHEDULED_DISPATCH': 'Pacing Queue',
    'DELIVERED': 'WhatsApp Sent ⭐',
    'PENDING_WHATSAPP_LINK': 'Scan QR to Send 📱',
    'CANCELLED_DAILY_QUOTA': 'Limit Exceeded (Daily 70) 🚫',
    'CANCELLED_SLOT_QUOTA': 'Limit Exceeded (Slot Full) 🚫',
    'QUEUED_DAILY_QUOTA': 'Daily Limit (Rolls Tomorrow) ⏸️',
    'QUEUED_SLOT_QUOTA': 'Slot Full (Rolls Next) ⏸️',
    'IGNORED_KOT': 'Blocked KOT / Est',
    'DUPLICATE_SUPPRESSED': 'Deduplicated (24h)',
    'ANONYMOUS_WALKIN': 'No Mobile Found',
    'QUEUED_QUIET_HOURS': 'Held (Quiet Hours)'
  };
  return map[status] || status;
}

function switchPairTab(mode) {
  const qrBox = document.getElementById('qrModeBox');
  const codeBox = document.getElementById('codeModeBox');
  const tabQrBtn = document.getElementById('tabQrBtn');
  const tabCodeBtn = document.getElementById('tabCodeBtn');

  if (mode === 'QR') {
    qrBox.style.display = 'flex';
    codeBox.style.display = 'none';
    tabQrBtn.style.background = 'var(--primary)';
    tabQrBtn.style.color = 'white';
    tabCodeBtn.style.background = 'transparent';
    tabCodeBtn.style.color = 'var(--text-muted)';
  } else {
    qrBox.style.display = 'none';
    codeBox.style.display = 'flex';
    tabCodeBtn.style.background = 'var(--primary)';
    tabCodeBtn.style.color = 'white';
    tabQrBtn.style.background = 'transparent';
    tabQrBtn.style.color = 'var(--text-muted)';
  }
}

async function requestPairingCode() {
  const phone = document.getElementById('pairingPhoneInput').value.trim();
  if (!phone) {
    alert('Please enter your 10-digit WhatsApp phone number');
    return;
  }

  try {
    const res = await fetch('/api/whatsapp/request-pairing-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: phone })
    });
    const data = await res.json();
    if (data.success && data.code) {
      document.getElementById('pairingCodeDisplay').style.display = 'block';
      document.getElementById('pairingCodeText').innerText = data.code;
    } else {
      alert('Pairing code note: ' + (data.error || 'Please use camera QR scan mode'));
    }
  } catch (err) {
    alert('Error requesting pairing code: ' + err.message);
  }
}

async function resetWhatsAppSession() {
  const loading = document.getElementById('qrLoading');
  const img = document.getElementById('qrImage');
  const connected = document.getElementById('qrConnected');

  img.style.display = 'none';
  connected.style.display = 'none';
  loading.style.display = 'flex';
  document.getElementById('whatsappStatusText').innerText = 'Generating Meta QR...';

  try {
    await fetch('/api/whatsapp/reset-session', { method: 'POST' });
  } catch (err) {
    console.error(err);
  }
}

function renderWhatsAppQR(qrUrl) {
  const img = document.getElementById('qrImage');
  const loading = document.getElementById('qrLoading');
  const connected = document.getElementById('qrConnected');

  if (qrUrl) {
    img.src = qrUrl;
    img.style.display = 'block';
    loading.style.display = 'none';
    connected.style.display = 'none';
    document.getElementById('whatsappStatusText').innerText = 'Scan QR';
    document.getElementById('whatsappStatusChip').className = 'status-chip chip-amber';
  }
}

function renderWhatsAppStatus(wsData) {
  if (!wsData) return;
  const status = wsData.status;
  const img = document.getElementById('qrImage');
  const loading = document.getElementById('qrLoading');
  const connected = document.getElementById('qrConnected');

  const isCloud = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  if (isCloud || wsData.mode === 'CLOUD_HOSTED') {
    img.style.display = 'none';
    loading.style.display = 'none';
    connected.style.display = 'flex';
    connected.innerHTML = `
      <div class="connected-icon" style="font-size: 32px;">☁️</div>
      <h4 style="color: #0284c7; font-weight: 700; margin: 4px 0;">Cloud SaaS Portal</h4>
      <p style="font-size: 11px; color: #64748b; line-height: 1.5;">Cloud Hub Active. Local POS Terminal (<code>localhost:3000</code>) on your billing counter dispatches messages to WhatsApp.</p>
      <span class="session-path" style="font-size: 10px; color: #059669; font-weight: 600; margin-top: 6px;">Sync: pos.revieweasy.in ➔ Supabase</span>
    `;
    const statusText = document.getElementById('whatsappStatusText');
    const statusChip = document.getElementById('whatsappStatusChip');
    if (statusText) statusText.innerText = 'Cloud SaaS (Online)';
    if (statusChip) statusChip.className = 'status-chip chip-cyan';
    return;
  }

  if (status === 'CONNECTED') {
    img.style.display = 'none';
    loading.style.display = 'none';
    connected.style.display = 'flex';
    document.getElementById('whatsappStatusText').innerText = 'Connected (Edge)';
    document.getElementById('whatsappStatusChip').className = 'status-chip chip-green';
  } else if (status === 'QR_READY' && wsData.qrDataUrl) {
    renderWhatsAppQR(wsData.qrDataUrl);
  } else {
    img.style.display = 'none';
    loading.style.display = 'flex';
    connected.style.display = 'none';
    document.getElementById('whatsappStatusText').innerText = 'Generating QR...';
    document.getElementById('whatsappStatusChip').className = 'status-chip chip-blue';
  }
}

function renderSupabaseStatus(sbData) {
  if (!sbData) return;
  const statusChip = document.getElementById('supabaseStatusChip');
  const statusText = document.getElementById('supabaseStatusText');
  const banner = document.getElementById('outageBanner');

  if (sbData.isOnline === false || sbData.isSimulatedOffline === true) {
    isInternetOffline = true;
    statusText.innerText = `Offline (${sbData.pendingCount || 0} Queued)`;
    statusChip.className = 'status-chip chip-amber';
    banner.style.display = 'flex';
    document.getElementById('btnOutageToggle').innerText = '⚡ Restore Internet Connection';
    document.getElementById('btnOutageToggle').className = 'btn-sm btn-reconnect w-full';
  } else {
    isInternetOffline = false;
    statusText.innerText = 'Online (Supabase)';
    statusChip.className = 'status-chip chip-cyan';
    banner.style.display = 'none';
    document.getElementById('btnOutageToggle').innerText = '🔌 Simulate Internet Disconnect';
    document.getElementById('btnOutageToggle').className = 'btn-sm btn-warning w-full';
  }
}

function renderHealth(health) {
  if (!health) return;
  document.getElementById('spoolerStatusText').innerText = health.spoolerStatus || 'Active';
}

function checkClientAuth() {
  const userJson = localStorage.getItem('revieweasy_user');
  if (userJson) {
    const user = JSON.parse(userJson);
    const nameEl = document.getElementById('clientUserName');
    if (nameEl) nameEl.innerText = user.name || 'Merchant';
    if (user.storeCode) {
      const badgeEl = document.getElementById('storeBadgeText');
      if (badgeEl) badgeEl.innerText = user.storeCode;
    }
  }
}

function clientLogout() {
  localStorage.removeItem('revieweasy_user');
  window.location.href = '/login.html';
}

async function bindSecretKey() {
  const secretKey = document.getElementById('clientSecretInput').value.trim();
  if (!secretKey) {
    alert('Please enter your Secret Store Key (e.g. SEC_SUNSHINE_4920)');
    return;
  }

  try {
    const res = await fetch('/api/client/bind-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretKey })
    });

    const data = await res.json();
    if (data.success) {
      alert(`✅ Store Agent Bound Successfully!\n\nStore: ${data.store.storeName}\nCode: ${data.store.storeCode}\nStatus: Active`);
      document.getElementById('secretStatusBadge').innerText = 'VALID & BOUND';
      document.getElementById('secretStatusBadge').style.color = '#34d399';
      document.getElementById('storeBadgeText').innerText = data.store.storeCode;
      document.getElementById('storeTaglineText').innerText = `${data.store.storeName} (Local WhatsApp Edge Dispatcher)`;
      fetchState();
    } else {
      alert('Error: ' + data.error);
      document.getElementById('secretStatusBadge').innerText = 'INVALID';
      document.getElementById('secretStatusBadge').style.color = '#ef4444';
    }
  } catch (err) {
    alert('Failed to bind secret key: ' + err.message);
  }
}

function renderConfig(cfg) {
  if (!cfg) return;
  document.getElementById('cfg_storeCode').value = cfg.storeCode || 'STORE_DEMO_01';
  document.getElementById('cfg_storeName').value = cfg.storeName || '';
  document.getElementById('cfg_storePhone').value = cfg.storePhone || '';
  document.getElementById('cfg_reviewUrl').value = cfg.googleReviewUrl || '';
  document.getElementById('cfg_supabaseUrl').value = cfg.supabaseUrl || '';
  document.getElementById('cfg_supabaseKey').value = cfg.supabaseAnonKey || '';
  document.getElementById('cfg_quietStart').value = cfg.quietHoursStart || '22:00';
  document.getElementById('cfg_quietEnd').value = cfg.quietHoursEnd || '10:00';
  document.getElementById('cfg_pacingMin').value = cfg.pacingDelayMinSeconds || 15;
  document.getElementById('cfg_pacingMax').value = cfg.pacingDelayMaxSeconds || 30;
  document.getElementById('cfg_dailyLimitMax').value = cfg.dailyLimitMax || 70;
  document.getElementById('cfg_morningQuotaMax').value = cfg.morningQuotaMax || 15;
  document.getElementById('cfg_afternoonQuotaMax').value = cfg.afternoonQuotaMax || 20;
  document.getElementById('cfg_eveningQuotaMax').value = cfg.eveningQuotaMax || 35;
  
  const digitalReceiptsCheckbox = document.getElementById('cfg_enableDigitalReceipts');
  if (digitalReceiptsCheckbox) {
    digitalReceiptsCheckbox.checked = cfg.enableDigitalReceipts !== false;
  }

  if (cfg.secretKey) {
    document.getElementById('clientSecretInput').value = cfg.secretKey;
    document.getElementById('secretStatusBadge').innerText = 'VALID';
    document.getElementById('secretStatusBadge').style.color = '#34d399';
  }
  if (cfg.storeCode) {
    document.getElementById('storeBadgeText').innerText = cfg.storeCode;
  }
  if (cfg.storeName) {
    document.getElementById('storeTaglineText').innerText = `${cfg.storeName} (Local WhatsApp Edge Dispatcher)`;
  }
}

async function saveSettings() {
  const payload = {
    storeCode: document.getElementById('cfg_storeCode').value,
    storeName: document.getElementById('cfg_storeName').value,
    storePhone: document.getElementById('cfg_storePhone').value,
    googleReviewUrl: document.getElementById('cfg_reviewUrl').value,
    supabaseUrl: document.getElementById('cfg_supabaseUrl').value,
    supabaseAnonKey: document.getElementById('cfg_supabaseKey').value,
    quietHoursStart: document.getElementById('cfg_quietStart').value,
    quietHoursEnd: document.getElementById('cfg_quietEnd').value,
    pacingDelayMinSeconds: Number(document.getElementById('cfg_pacingMin').value),
    pacingDelayMaxSeconds: Number(document.getElementById('cfg_pacingMax').value),
    dailyLimitMax: Number(document.getElementById('cfg_dailyLimitMax').value) || 70,
    morningQuotaMax: Number(document.getElementById('cfg_morningQuotaMax').value) || 15,
    afternoonQuotaMax: Number(document.getElementById('cfg_afternoonQuotaMax').value) || 20,
    eveningQuotaMax: Number(document.getElementById('cfg_eveningQuotaMax').value) || 35,
    enableDigitalReceipts: document.getElementById('cfg_enableDigitalReceipts') ? document.getElementById('cfg_enableDigitalReceipts').checked : true
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert('✅ Merchant configuration & Quota limits saved successfully!');
    }
  } catch (err) {
    alert('Error saving settings: ' + err.message);
  }
}

async function runScenario(scenarioKey) {
  const rawText = PRESET_SCENARIOS[scenarioKey];
  document.getElementById('rawReceiptInput').value = rawText;

  let customTimestamp = null;
  let source = 'VIRTUAL_PRINT_SPOOLER';

  if (scenarioKey === 'MIDNIGHT_OUTAGE') {
    // Simulate night time (11:30 PM)
    const night = new Date();
    night.setHours(23, 30, 0, 0);
    customTimestamp = night.toISOString();
  } else if (scenarioKey === 'TCP_9100_STREAM') {
    source = 'TCP_9100_NETWORK_STREAM';
  } else if (scenarioKey === 'RASTER_BITMAP') {
    source = 'GDI_MONOCHROME_RASTER';
  }

  try {
    await fetch('/api/simulate-print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, customTimestamp, source })
    });
  } catch (err) {
    console.error('Scenario error:', err);
  }
}

async function injectCustomStream() {
  const rawText = document.getElementById('rawReceiptInput').value;
  if (!rawText.trim()) {
    alert('Please enter or paste a receipt stream');
    return;
  }

  try {
    await fetch('/api/simulate-print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText })
    });
  } catch (err) {
    alert('Failed to inject stream: ' + err.message);
  }
}

async function simulatePairing() {
  try {
    const res = await fetch('/api/whatsapp/pair-simulated', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      renderWhatsAppStatus({ status: 'CONNECTED' });
    }
  } catch (err) {
    console.error(err);
  }
}

async function reconnectWhatsApp() {
  try {
    await fetch('/api/whatsapp/reconnect', { method: 'POST' });
  } catch (err) {
    console.error(err);
  }
}

async function toggleOutageClick() {
  toggleInternetOutage(!isInternetOffline);
}

async function toggleInternetOutage(isOffline) {
  try {
    const res = await fetch('/api/connectivity/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isOffline })
    });
    const data = await res.json();
    renderSupabaseStatus(data);
  } catch (err) {
    console.error(err);
  }
}

async function simulateUsbHop() {
  try {
    const res = await fetch('/api/simulate-usb-hop', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      document.getElementById('usbDeviceText').innerText = data.device.name;
    }
  } catch (err) {
    console.error(err);
  }
}

async function clearHistory() {
  if (confirm('Clear all transaction logs, feedback, and reset queue?')) {
    await fetch('/api/clear-history', { method: 'POST' });
  }
}

// -------------------------------------------------------------
// Smart Review Shield & Customer Feedback Functions
// -------------------------------------------------------------
async function fetchFeedbacks() {
  try {
    const res = await fetch('/api/feedback');
    const data = await res.json();
    if (data.success) {
      renderFeedbackTable(data.feedbacks || []);
    }
  } catch (err) {
    console.error('Error fetching feedbacks:', err);
  }
}

function renderFeedbackTable(feedbacks) {
  const tbody = document.getElementById('feedbackTableBody');
  if (!tbody) return;

  if (!feedbacks || feedbacks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 20px;">No private complaints or shielded feedback yet. 100% customer satisfaction! 🎉</td></tr>`;
    return;
  }

  tbody.innerHTML = feedbacks.map(fb => {
    const timeStr = new Date(fb.timestamp).toLocaleTimeString();
    const isShielded = fb.action === 'PRIVATE_FEEDBACK';
    
    // Star rating display
    const starEmoji = '⭐'.repeat(fb.rating);
    const ratingBadge = isShielded
      ? `<span style="color: #f43f5e; font-weight: 700;">${starEmoji} (${fb.rating}/5)</span>`
      : `<span style="color: #10b981; font-weight: 700;">${starEmoji} (${fb.rating}/5)</span>`;

    const statusBadge = fb.status === 'OPEN'
      ? `<span class="badge-status" style="background: rgba(244, 63, 94, 0.2); color: #f43f5e; font-size: 10px;">⚠️ OPEN (Needs Attention)</span>`
      : `<span class="badge-status" style="background: rgba(16, 185, 129, 0.2); color: #34d399; font-size: 10px;">✅ RESOLVED</span>`;

    const callbackText = fb.requestCallback ? `<span style="color: #fbbf24; font-size: 10px; font-weight: 700;">📞 Call Requested</span>` : ``;

    const cleanPhone = (fb.customerPhone || '').replace(/\D/g, '');
    const waLink = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(`Hi ${fb.customerName}, this is the manager from ${currentConfig.storeName || 'the store'}. We received your feedback regarding ${fb.category} on invoice #${fb.invoiceNo} and wanted to personally reach out.`)}`;

    const actionBtn = fb.status === 'OPEN'
      ? `<button class="btn-sm" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 10px; padding: 4px 8px;" onclick="resolveFeedback('${fb.id}')">Mark Resolved</button>`
      : `<button class="btn-sm" style="background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid var(--border-color); font-size: 10px; padding: 4px 8px;" onclick="reopenFeedback('${fb.id}')">Reopen</button>`;

    return `
      <tr>
        <td style="color: #94a3b8; font-family: 'JetBrains Mono', monospace; font-size: 11px;">${timeStr}</td>
        <td><strong style="color: #ffffff;">${escapeHtml(fb.customerName || 'Customer')}</strong></td>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">${escapeHtml(fb.customerPhone || '—')}</td>
        <td style="font-size: 11px;"><strong style="color: #38bdf8;">#${escapeHtml(fb.invoiceNo || 'N/A')}</strong></td>
        <td>${ratingBadge}</td>
        <td><span style="background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #cbd5e1;">${escapeHtml(fb.category || 'General')}</span></td>
        <td style="max-width: 200px; font-size: 11px; color: #e2e8f0; line-height: 1.3;">
          ${escapeHtml(fb.comment || 'No comments left')}
          <br>${callbackText}
        </td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; gap: 4px;">
            ${actionBtn}
            <a href="${waLink}" target="_blank" class="btn-sm" style="background: rgba(37, 211, 102, 0.2); color: #25d366; border: 1px solid rgba(37, 211, 102, 0.4); font-size: 10px; padding: 4px 8px; text-decoration: none; display: inline-flex; align-items: center; gap: 2px;">💬 Chat</a>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function resolveFeedback(id) {
  try {
    await fetch(`/api/feedback/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVED', notes: 'Resolved by store manager via dashboard' })
    });
    fetchFeedbacks();
  } catch (err) {
    alert('Error updating feedback status: ' + err.message);
  }
}

async function reopenFeedback(id) {
  try {
    await fetch(`/api/feedback/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'OPEN' })
    });
    fetchFeedbacks();
  } catch (err) {
    alert('Error updating feedback status: ' + err.message);
  }
}

// -------------------------------------------------------------
// Daily Closing Owner Digest Trigger
// -------------------------------------------------------------
async function triggerOwnerDigestNow() {
  const storeCode = currentConfig.storeCode || 'STORE_DEMO_01';
  try {
    const res = await fetch('/api/digest/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeCode })
    });
    const data = await res.json();
    if (data.success) {
      alert(`🌙 Closing Digest successfully dispatched to store owner (+91 ${data.log.recipientPhone})!\n\nCheck WhatsApp or console log for delivery preview.`);
    }
  } catch (err) {
    alert('Failed to send closing digest: ' + err.message);
  }
}

function openReviewShieldSimulator() {
  const storeCode = currentConfig.storeCode || 'STORE_DEMO_01';
  window.open(`/review.html?id=DEMO_${Date.now()}&store=${storeCode}`, '_blank');
}

// -------------------------------------------------------------
// Lapsed Customer Win-Back Radar & Retention CRM Functions
// -------------------------------------------------------------
let allWinBackCustomers = [];
let activeSegmentFilter = 'ALL';
let activeSelectedCustomer = null;
let currentWinBackTemplate = '';

async function fetchWinBackData() {
  try {
    const storeCode = currentConfig.storeCode || 'STORE_DEMO_01';
    const [analyticsRes, customersRes, templateRes] = await Promise.all([
      fetch(`/api/winback/analytics?storeCode=${storeCode}`),
      fetch(`/api/winback/customers?storeCode=${storeCode}`),
      fetch(`/api/winback/template?storeCode=${storeCode}`)
    ]);

    const aData = await analyticsRes.json();
    const cData = await customersRes.json();
    const tData = await templateRes.json();

    if (aData.success && aData.analytics) {
      renderWinBackKPIs(aData.analytics);
    }

    if (cData.success && cData.customers) {
      allWinBackCustomers = cData.customers;
      updateSegmentCounts(allWinBackCustomers);
      renderFilteredWinBackTable();
    }

    if (tData.success && tData.template) {
      currentWinBackTemplate = tData.template;
      const input = document.getElementById('wbTemplateInput');
      if (input && !input.value) {
        input.value = currentWinBackTemplate;
      }
      updateTemplateLivePreview();
    }
  } catch (err) {
    console.error('Error fetching win-back data:', err);
  }
}

function updateSegmentCounts(customers) {
  const cntAll = document.getElementById('cnt_all');
  const cntLapsed = document.getElementById('cnt_lapsed');
  const cntRegular = document.getElementById('cnt_regular');
  const cntDormant = document.getElementById('cnt_dormant');

  const lapsed = customers.filter(c => c.segment === 'LAPSED').length;
  const regular = customers.filter(c => c.segment === 'REGULAR' || c.segment === 'ACTIVE').length;
  const dormant = customers.filter(c => c.segment === 'DORMANT').length;

  if (cntAll) cntAll.innerText = customers.length;
  if (cntLapsed) cntLapsed.innerText = lapsed;
  if (cntRegular) cntRegular.innerText = regular;
  if (cntDormant) cntDormant.innerText = dormant;
}

function filterWinBackSegment(segment) {
  activeSegmentFilter = segment;
  const group = document.getElementById('segmentFilterGroup');
  if (group) {
    group.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btnFilter${segment.charAt(0) + segment.slice(1).toLowerCase()}`);
    if (activeBtn) activeBtn.classList.add('active');
  }
  renderFilteredWinBackTable();
}

function renderFilteredWinBackTable() {
  let list = allWinBackCustomers;
  if (activeSegmentFilter === 'LAPSED') {
    list = allWinBackCustomers.filter(c => c.segment === 'LAPSED');
  } else if (activeSegmentFilter === 'REGULAR') {
    list = allWinBackCustomers.filter(c => c.segment === 'REGULAR' || c.segment === 'ACTIVE');
  } else if (activeSegmentFilter === 'DORMANT') {
    list = allWinBackCustomers.filter(c => c.segment === 'DORMANT');
  }
  renderWinBackTable(list);
}

function renderWinBackKPIs(a) {
  const lapsed = document.getElementById('wb_lapsedCount');
  const sent = document.getElementById('wb_sentCount');
  const recovered = document.getElementById('wb_recoveredCount');
  const rev = document.getElementById('wb_recoveredRevenue');

  if (lapsed) lapsed.innerText = a.lapsedCount || 0;
  if (sent) sent.innerText = a.winBacksSent || 0;
  if (recovered) recovered.innerText = `${a.customersRecovered || 0} (${a.recoveryRate || 0}%)`;
  if (rev) rev.innerText = `₹${(a.totalRecoveredRevenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function renderWinBackTable(customers) {
  const tbody = document.getElementById('winBackTableBody');
  if (!tbody) return;

  if (!customers || customers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;">No customers matching this segment filter right now.</td></tr>`;
    return;
  }

  tbody.innerHTML = customers.map(c => {
    const lastDate = new Date(c.lastVisit).toLocaleDateString();
    
    // Segment badge
    let segBadge = `<span class="badge-status" style="background: rgba(16, 185, 129, 0.15); color: #059669; font-size: 10px; font-weight: 700;">🟢 ACTIVE REGULAR</span>`;
    if (c.segment === 'LAPSED') {
      segBadge = `<span class="badge-status" style="background: rgba(245, 158, 11, 0.15); color: #d97706; font-size: 10px; font-weight: 700;">🟡 LAPSED (30–60D)</span>`;
    } else if (c.segment === 'DORMANT') {
      segBadge = `<span class="badge-status" style="background: rgba(239, 68, 68, 0.15); color: #dc2626; font-size: 10px; font-weight: 700;">🔴 DORMANT (>60D)</span>`;
    }

    // Status badge
    let statusBadge = `<span style="color: #64748b; font-size: 11px;">Eligible</span>`;
    if (c.winBackStatus === 'RECOVERED') {
      statusBadge = `<span style="color: #059669; font-weight: 700; font-size: 11px;">💰 RECOVERED!</span>`;
    } else if (c.winBackStatus === 'DISPATCHED_RECENTLY') {
      statusBadge = `<span style="color: #0284c7; font-size: 11px; font-weight: 600;">💬 DM Sent</span>`;
    }

    const actionBtn = `<button class="btn-sm" style="background: #0284c7; color: white; border: none; font-size: 11px; padding: 5px 10px; border-radius: 6px; cursor: pointer; font-weight: 600;" onclick="openWinBackDmModal('${c.phone}')">💬 Direct DM</button>`;

    return `
      <tr>
        <td><strong style="color: #0f172a;">${escapeHtml(c.name || 'Valued Customer')}</strong></td>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #334155;">${escapeHtml(c.formattedPhone || c.phone)}</td>
        <td><span style="font-weight: 700; color: #0284c7;">${c.totalVisits}</span></td>
        <td style="font-weight: 700; color: #0f172a;">₹${(c.totalSpend || 0).toFixed(2)}</td>
        <td style="color: #64748b; font-size: 11px;">${lastDate}</td>
        <td><strong style="color: ${c.daysSinceLastVisit > 30 ? '#d97706' : '#059669'};">${c.daysSinceLastVisit} days</strong></td>
        <td>${segBadge}</td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// Template Customizer Functions
// -------------------------------------------------------------
function toggleTemplateEditor() {
  const box = document.getElementById('templateEditorBox');
  if (!box) return;
  const isHidden = box.style.display === 'none';
  box.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    const input = document.getElementById('wbTemplateInput');
    if (input) {
      if (!input.value) input.value = currentWinBackTemplate;
      input.oninput = updateTemplateLivePreview;
      updateTemplateLivePreview();
    }
  }
}

function insertWbTag(tag) {
  const input = document.getElementById('wbTemplateInput');
  if (!input) return;
  input.value += tag;
  updateTemplateLivePreview();
}

function updateTemplateLivePreview() {
  const input = document.getElementById('wbTemplateInput');
  const preview = document.getElementById('wbTemplateLivePreview');
  if (!input || !preview) return;

  const raw = input.value || currentWinBackTemplate || '';
  const rendered = raw
    .replace(/{{name}}/gi, '<strong>Rahul</strong>')
    .replace(/{{customerName}}/gi, '<strong>Rahul</strong>')
    .replace(/{{storeName}}/gi, '<strong>Sunshine Cafe & Bistro</strong>')
    .replace(/{{googleMapUrl}}/gi, '<a href="#" style="color: #0284c7;">https://g.page/sunshine-cafe</a>');

  preview.innerHTML = rendered || '<em>Type your message template on the left to preview...</em>';
}

async function saveWinBackTemplate() {
  const input = document.getElementById('wbTemplateInput');
  if (!input) return;
  const tpl = input.value.trim();
  const storeCode = currentConfig.storeCode || 'STORE_DEMO_01';

  try {
    const res = await fetch('/api/winback/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeCode, template: tpl })
    });
    const data = await res.json();
    if (data.success) {
      currentWinBackTemplate = tpl;
      alert('🎉 Win-Back WhatsApp Message Template saved successfully!');
    }
  } catch (err) {
    alert('Error saving template: ' + err.message);
  }
}

function resetWinBackTemplateDefault() {
  const defaultTpl = `Hi {{name}}! ✨ We noticed it’s been a while since your last visit to {{storeName}}.\n\nWe’ve refreshed our seasonal specialties and ambiance, and our entire team would love to welcome you back! ☕🍰\n\nHope to see you again soon!\n📍 Directions & Location: {{googleMapUrl}}\n\n(Reply STOP to unsubscribe)`;
  const input = document.getElementById('wbTemplateInput');
  if (input) {
    input.value = defaultTpl;
    updateTemplateLivePreview();
  }
}

// -------------------------------------------------------------
// Direct 1-to-1 DM Modal & Inspection Functions
// -------------------------------------------------------------
function openWinBackDmModal(phone) {
  const customer = allWinBackCustomers.find(c => c.phone === phone);
  if (!customer) return;

  activeSelectedCustomer = customer;
  const modal = document.getElementById('winBackDmModal');
  const title = document.getElementById('modalCustomerTitle');
  const visits = document.getElementById('modalVisits');
  const spend = document.getElementById('modalSpend');
  const inactive = document.getElementById('modalInactive');
  const msgInput = document.getElementById('modalDmMessageInput');

  if (title) title.innerText = `💬 WhatsApp DM: ${customer.name} (+91 ${customer.phone})`;
  if (visits) visits.innerText = `${customer.totalVisits} Orders`;
  if (spend) spend.innerText = `₹${(customer.totalSpend || 0).toFixed(2)}`;
  if (inactive) inactive.innerText = `${customer.daysSinceLastVisit} days ago`;

  const storeName = currentConfig.storeName || 'Sunshine Cafe & Bistro';
  const mapUrl = currentConfig.googleReviewUrl || 'https://g.page/sunshine-cafe';
  const tpl = currentWinBackTemplate || `Hi {{name}}! ✨ We noticed it’s been a while since your last visit to {{storeName}}.\n\nWe’ve refreshed our seasonal specialties and ambiance, and our entire team would love to welcome you back! ☕🍰\n\nHope to see you again soon!\n📍 Directions & Location: {{googleMapUrl}}\n\n(Reply STOP to unsubscribe)`;

  const personalizedMessage = tpl
    .replace(/{{name}}/gi, customer.name)
    .replace(/{{customerName}}/gi, customer.name)
    .replace(/{{storeName}}/gi, storeName)
    .replace(/{{googleMapUrl}}/gi, mapUrl);

  if (msgInput) msgInput.value = personalizedMessage;
  if (modal) modal.style.display = 'flex';
}

function closeWinBackDmModal() {
  const modal = document.getElementById('winBackDmModal');
  if (modal) modal.style.display = 'none';
  activeSelectedCustomer = null;
}

async function sendModalCustomDm() {
  if (!activeSelectedCustomer) return;
  const msgInput = document.getElementById('modalDmMessageInput');
  const btn = document.getElementById('btnSendModalDm');
  const storeCode = currentConfig.storeCode || 'STORE_DEMO_01';
  const customMessage = msgInput ? msgInput.value.trim() : null;

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Dispatching WhatsApp...';
  }

  try {
    const res = await fetch('/api/winback/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeCode,
        customerPhone: activeSelectedCustomer.phone,
        customMessage
      })
    });
    const data = await res.json();
    if (data.success) {
      alert(`🚀 WhatsApp DM successfully dispatched to ${activeSelectedCustomer.name} (+91 ${activeSelectedCustomer.phone})!`);
      closeWinBackDmModal();
      fetchWinBackData();
    } else {
      alert('Could not dispatch DM: ' + (data.error || 'Check WhatsApp connection'));
    }
  } catch (err) {
    alert('Error sending DM: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🚀 Send WhatsApp DM Now';
    }
  }
}

async function runBatchWinBackScan() {
  const storeCode = currentConfig.storeCode || 'STORE_DEMO_01';
  try {
    const res = await fetch('/api/winback/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeCode, mode: 'BATCH_SCAN', maxBatch: 5 })
    });
    const data = await res.json();
    if (data.success) {
      if (data.dispatchedCount > 0) {
        alert(`🚀 Win-Back Scan & Dispatch Complete!\n\n• Customers Scanned: ${data.scannedCount}\n• Lapsed Inactive (30–60d): ${data.lapsedEligibleCount}\n• WhatsApp Re-Invites Dispatched: ${data.dispatchedCount}`);
      } else {
        alert(`ℹ️ Win-Back Scan Complete (${data.scannedCount || 0} customers scanned).\n\nNo lapsed customers in the 30–60 day inactive window right now! All your active customers have visited recently.`);
      }
      fetchWinBackData();
    } else {
      alert('Win-Back note: ' + (data.reason || data.error || 'Scan complete'));
    }
  } catch (err) {
    alert('Failed to run batch win-back: ' + err.message);
  }
}

async function fetchUpdaterStatus() {
  try {
    const res = await fetch('/api/updater/status');
    const data = await res.json();
    if (data.success) {
      renderUpdaterStatus(data.status);
    }
  } catch (err) {
    console.warn('Could not fetch updater status:', err.message);
  }
}

function renderUpdaterStatus(statusData) {
  if (!statusData) return;
  const chip = document.getElementById('updaterStatusChip');
  const btnApply = document.getElementById('btnApplyUpdate');
  if (!chip) return;

  const ver = statusData.installedVersion || '6.7.8';

  if (statusData.status === 'CHECKING') {
    chip.className = 'status-chip chip-amber';
    chip.innerText = `Checking NPM...`;
  } else if (statusData.status === 'UPDATE_AVAILABLE' || (statusData.latestVersion && statusData.latestVersion !== ver)) {
    chip.className = 'status-chip chip-amber';
    chip.innerText = `v${statusData.latestVersion} Available! 🚀`;
    if (btnApply) btnApply.style.display = 'block';
  } else if (statusData.status === 'UPDATING') {
    chip.className = 'status-chip chip-amber';
    chip.innerText = `Applying Update... ⚙️`;
    if (btnApply) btnApply.style.display = 'none';
  } else if (statusData.status === 'UPDATED') {
    chip.className = 'status-chip chip-green';
    chip.innerText = `v${ver} (Updated 🎉)`;
    if (btnApply) btnApply.style.display = 'none';
  } else {
    chip.className = 'status-chip chip-green';
    chip.innerText = `v${ver} (Up-to-Date)`;
    if (btnApply) btnApply.style.display = 'none';
  }
}

async function checkAutoUpdatesNow() {
  const chip = document.getElementById('updaterStatusChip');
  if (chip) {
    chip.className = 'status-chip chip-amber';
    chip.innerText = 'Checking NPM...';
  }

  try {
    const res = await fetch('/api/updater/check', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const r = data.result;
      if (r.hasUpdate) {
        alert(`🚀 New Protocol Update Found!\n\nLatest Version: v${r.latestVersion}\nInstalled: v${r.installedVersion}\n\nClick "Update Now" to apply silently in background.`);
      } else {
        alert(`✅ Engine is up-to-date!\n\nInstalled: @whiskeysockets/baileys@v${r.installedVersion}\nLatest NPM: v${r.latestVersion}`);
      }
      fetchUpdaterStatus();
    }
  } catch (err) {
    alert('Failed to check for updates: ' + err.message);
  }
}

async function applyAutoUpdateNow() {
  const btn = document.getElementById('btnApplyUpdate');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Updating...';
  }

  try {
    const res = await fetch('/api/updater/apply', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`🎉 Protocol Update Successfully Applied!\n\nUpdated to v${data.installedVersion}\nWhatsApp Companion Engine refreshed.`);
      fetchUpdaterStatus();
    } else {
      alert('Update failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Update execution error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '⚡ Update Now';
    }
  }
}

function checkClientAuth() {
  const userJson = localStorage.getItem('revieweasy_user');
  if (!userJson) {
    window.location.href = '/login.html';
    return null;
  }
  try {
    const user = JSON.parse(userJson);
    const userChip = document.getElementById('clientUserName');
    if (userChip) {
      userChip.innerText = user.name || user.email || 'Merchant';
    }
    if (user.store) {
      const badge = document.getElementById('storeBadgeText');
      const tagline = document.getElementById('storeTaglineText');
      if (badge) badge.innerText = user.store.storeCode || user.storeCode;
      if (tagline) tagline.innerText = `${user.store.storeName} (Local WhatsApp Edge Dispatcher)`;
    }
    return user;
  } catch (e) {
    localStorage.removeItem('revieweasy_user');
    window.location.href = '/login.html';
    return null;
  }
}

function clientLogout() {
  localStorage.removeItem('revieweasy_user');
  window.location.href = '/login.html';
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  checkClientAuth();
  fetchState();
  fetchFeedbacks();
  fetchWinBackData();
  fetchUpdaterStatus();

  // Connect WebSocket if on localhost
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    connectWebSocket();
  }

  // Periodic polling fallback (keeps cloud & local state 100% in sync)
  setInterval(() => {
    fetchState();
  }, 3000);
});
