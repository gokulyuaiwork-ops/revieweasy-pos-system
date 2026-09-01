import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { storage } from '../src/engine/storage.js';
import { SupabaseSyncEngine } from '../src/engine/supabase-sync.js';
import { PersonalizedImageGenerator } from '../src/engine/personalized-image-generator.js';
import { generateInvoicePdfBuffer } from '../src/engine/invoice-generator.js';
import { WinBackEngine } from '../src/engine/winback-engine.js';

function getStoreHeartbeatUuid(storeCode) {
  const hash = crypto.createHash('md5').update('ReviewEasy_Heartbeat_' + (storeCode || 'STORE_DEMO_01')).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function parseReceiptItems(rawText) {
  if (!rawText) return [
    { name: 'Cold Brew Coffee', qty: '1', price: '180.00' },
    { name: 'Margherita Pizza', qty: '1', price: '350.00' }
  ];
  const items = [];
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(\d+)x?\s+([A-Za-z0-9\s\-]+?)\s+[₹Rs\.]*\s*([\d\.]+)/i);
    if (match) {
      items.push({
        qty: match[1],
        name: match[2].trim(),
        price: parseFloat(match[3]).toFixed(2)
      });
    }
  }
  return items.length > 0 ? items : [
    { name: 'Cold Brew Coffee', qty: '1', price: '180.00' },
    { name: 'Margherita Pizza', qty: '1', price: '350.00' }
  ];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS setup for cloud API access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Static assets
app.use(express.static(path.join(__dirname, '../public')));

const supabaseSync = new SupabaseSyncEngine();
const winBackEngine = new WinBackEngine();

// Helper to fetch bills for a store from Supabase or fallback to storage
async function getStoreBills(storeCode) {
  const code = (storeCode || 'STORE_DEMO_01').toUpperCase();
  let bills = [];

  if (supabaseSync.client) {
    try {
      const { data, error } = await supabaseSync.client
        .from('bills')
        .select('*')
        .eq('store_code', code)
        .order('created_at', { ascending: false })
        .order('invoice_no', { ascending: false });

      if (!error && data && data.length > 0) {
        bills = data.map(b => ({
          id: b.id || b.invoice_no,
          storeCode: b.store_code,
          invoiceNo: b.invoice_no,
          customerName: b.customer_name || 'Valued Customer',
          customerPhone: b.customer_phone || 'N/A',
          formattedPhone: b.customer_phone ? (b.customer_phone.startsWith('+') ? b.customer_phone : `+91 ${b.customer_phone}`) : 'N/A',
          totalAmount: (b.total_amount || 0).toFixed(2),
          status: b.status || 'DELIVERED',
          source: b.source || 'PRINT_SPOOLER',
          rawText: b.raw_text || '',
          timestamp: b.local_created_at || b.created_at || new Date().toISOString()
        }));
      }
    } catch (err) {
      console.warn('[Cloud Bills] Supabase query note:', err.message);
    }
  }

  if (bills.length === 0) {
    bills = storage.getTransactions(100).filter(t => (t.storeCode || 'STORE_DEMO_01').toUpperCase() === code);
  }

  return bills;
}

// Helper to build customer RFM directory from bills
function buildCustomerDirectoryFromBills(bills) {
  const customerMap = {};
  const now = Date.now();

  for (const b of bills) {
    const phone = (b.customerPhone || '').replace(/\D/g, '').slice(-10);
    if (!phone || phone.length < 10) continue;

    const billDate = new Date(b.timestamp).getTime();
    const amount = parseFloat(b.totalAmount) || 0;

    if (!customerMap[phone]) {
      customerMap[phone] = {
        name: b.customerName || 'Valued Customer',
        phone: phone,
        formattedPhone: `+91 ${phone}`,
        totalVisits: 0,
        totalSpend: 0,
        lastVisit: new Date(billDate).toISOString(),
        firstVisit: new Date(billDate).toISOString(),
        lastVisitTimestamp: billDate
      };
    }

    customerMap[phone].totalVisits++;
    customerMap[phone].totalSpend += amount;

    if (billDate > customerMap[phone].lastVisitTimestamp) {
      customerMap[phone].lastVisitTimestamp = billDate;
      customerMap[phone].lastVisit = new Date(billDate).toISOString();
      if (b.customerName && b.customerName !== 'Valued Customer') {
        customerMap[phone].name = b.customerName;
      }
    }
  }

  let directory = Object.values(customerMap).map(c => {
    const daysSinceLastVisit = Math.floor((now - c.lastVisitTimestamp) / (24 * 60 * 60 * 1000));
    let segment = 'ACTIVE';
    if (daysSinceLastVisit > 60) segment = 'DORMANT';
    else if (daysSinceLastVisit >= 30) segment = 'LAPSED';

    return {
      ...c,
      daysSinceLastVisit,
      segment,
      winBackStatus: 'ELIGIBLE'
    };
  });

  // STRICT FILTER: Only return customers inactive for 30+ days in the Win-Back list
  return directory
    .filter(c => c.daysSinceLastVisit >= 30)
    .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);
}

function getStartOfTodayIst() {
  const now = new Date();
  const istTime = new Date(now.getTime() + (330 * 60 * 1000));
  const startOfTodayIst = new Date(Date.UTC(istTime.getUTCFullYear(), istTime.getUTCMonth(), istTime.getUTCDate(), 0, 0, 0));
  return startOfTodayIst.getTime() - (330 * 60 * 1000);
}

function buildCloudClientAnalytics(storeCode, validBills, dispatches = []) {
  const code = (storeCode || 'STORE_DEMO_01').toUpperCase();
  const startOfTodayUtc = getStartOfTodayIst();
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

  const aggregate = (txList, minTimestamp = 0) => {
    let sentCount = 0;
    let totalBills = 0;
    let totalSales = 0;
    let kotsBlocked = 0;
    let dummyFiltered = 0;

    for (const t of txList) {
      if (!['IGNORED_KOT', 'DUPLICATE_SUPPRESSED', 'ANONYMOUS_WALKIN', 'DUMMY_PHONE_REJECTED', 'STORE_OWNER_FILTERED'].includes(t.status)) {
        totalBills++;
        totalSales += parseFloat(t.totalAmount) || 0;
      }
      if (t.status === 'DELIVERED' || t.status === 'WHATSAPP_SENT') {
        sentCount++;
      }
      if (t.status === 'IGNORED_KOT') {
        kotsBlocked++;
      }
      if (t.status === 'ANONYMOUS_WALKIN' || t.reason?.includes('DUMMY')) {
        dummyFiltered++;
      }
    }

    const periodDispatches = dispatches.filter(d => new Date(d.dispatched_at || d.created_at || 0).getTime() >= minTimestamp);
    const positiveRedirects = periodDispatches.filter(d => d.dispatch_status === 'GOOGLE_REDIRECT' || Number(d.rating_given) >= 4).length;
    const shieldedGrievances = periodDispatches.filter(d => d.dispatch_status === 'PRIVATE_FEEDBACK' || (d.rating_given && Number(d.rating_given) <= 3)).length;
    const reachRate = totalBills > 0 ? Math.round((sentCount / totalBills) * 100) : 0;

    return {
      sent: sentCount,
      bills: totalBills,
      sales: Math.round(totalSales * 100) / 100,
      positiveRedirects,
      shieldedGrievances,
      reachRate,
      kotsBlocked,
      dummyFiltered
    };
  };

  const todayTxs = validBills.filter(t => new Date(t.timestamp || t.created_at || 0).getTime() >= startOfTodayUtc);
  const weekTxs = validBills.filter(t => new Date(t.timestamp || t.created_at || 0).getTime() >= sevenDaysAgo);
  const monthTxs = validBills.filter(t => new Date(t.timestamp || t.created_at || 0).getTime() >= thirtyDaysAgo);

  const shieldedCount = dispatches.filter(d => d.dispatch_status === 'PRIVATE_FEEDBACK' || (d.rating_given && Number(d.rating_given) <= 3)).length;
  const redirectedCount = dispatches.filter(d => d.dispatch_status === 'GOOGLE_REDIRECT' || Number(d.rating_given) >= 4).length;

  return {
    storeCode: code,
    today: aggregate(todayTxs, startOfTodayUtc),
    lastWeek: aggregate(weekTxs, sevenDaysAgo),
    lastMonth: aggregate(monthTxs, thirtyDaysAgo),
    allTime: aggregate(validBills, 0),
    shield: {
      totalFeedback: shieldedCount + redirectedCount,
      shieldedNegative: shieldedCount,
      redirectedPositive: redirectedCount,
      averageRating: 5.0,
      openComplaints: shieldedCount
    }
  };
}

// -------------------------------------------------------------
// Cloud State & Store Telemetry Endpoint
// -------------------------------------------------------------
app.get('/api/state', async (req, res) => {
  try {
    const storeCode = (req.query.store || req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const rawBills = await getStoreBills(storeCode);
    const store = storage.getStoreByCode(storeCode) || storage.getConfig();

    let whatsappStatus = 'NOT_LINKED';
    let whatsappPhone = null;
    let spoolerStatus = 'Spooler Idle';
    let printerName = (store && store.printerName) || 'Microsoft Print to PDF (Healthy)';

    // 1. Check if Supabase has an active edge agent heartbeat for this store
    if (supabaseSync && supabaseSync.client) {
      try {
        const hbId = getStoreHeartbeatUuid(storeCode);
        const { data: hbRow } = await supabaseSync.client
          .from('bills')
          .select('*')
          .eq('id', hbId)
          .maybeSingle();

        if (hbRow) {
          whatsappStatus = hbRow.status || 'NOT_LINKED';
          whatsappPhone = hbRow.customer_phone || (store && store.storePhone) || '919342350747';
          if (hbRow.raw_text) {
            try {
              const hbData = JSON.parse(hbRow.raw_text);
              if (hbData.spoolerStatus) spoolerStatus = hbData.spoolerStatus;
              if (hbData.printerName) printerName = hbData.printerName;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    // 2. Fallback: If edge agent has recently delivered bills to WhatsApp for this store
    if (whatsappStatus === 'NOT_LINKED' && rawBills && rawBills.length > 0) {
      const delivered = rawBills.find(b => b.status === 'DELIVERED' || b.status === 'WHATSAPP_SENT');
      if (delivered) {
        whatsappStatus = 'CONNECTED';
        whatsappPhone = (store && store.storePhone) || '919342350747';
      }
    }

    // Filter out internal agent heartbeats and show only today's bills in the live transaction feed
    const validBills = (rawBills || []).filter(b => b.source !== 'AGENT_HEARTBEAT' && !(b.invoiceNo && b.invoiceNo.startsWith('HB-')));
    const startOfTodayUtc = getStartOfTodayIst();

    const displayBills = validBills
      .filter(b => {
        const bTime = new Date(b.timestamp || b.created_at || 0).getTime();
        return bTime >= startOfTodayUtc;
      })
      .sort((a, b) => {
        const timeA = new Date(a.timestamp || a.created_at || 0).getTime();
        const timeB = new Date(b.timestamp || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return String(b.invoiceNo || '').localeCompare(String(a.invoiceNo || ''));
      });

    let cloudDispatches = [];
    if (supabaseSync && supabaseSync.client) {
      try {
        const { data: dispatches } = await supabaseSync.client
          .from('review_dispatches')
          .select('*')
          .eq('store_code', storeCode);
        if (dispatches) cloudDispatches = dispatches;
      } catch (e) {}
    }

    const cloudAnalytics = buildCloudClientAnalytics(storeCode, validBills, cloudDispatches);

    res.json({
      success: true,
      config: store || storage.getConfig(),
      metrics: {
        todayInvoices: cloudAnalytics.today.bills,
        todaySent: cloudAnalytics.today.sent,
        totalInvoices: cloudAnalytics.allTime.bills,
        totalSent: cloudAnalytics.allTime.sent,
        deliveryRateToday: cloudAnalytics.today.reachRate,
        offlineQueuedBills: 0
      },
      analytics: cloudAnalytics,
      quota: storage.getTodayQuotaUsage(storeCode),
      transactions: displayBills.slice(0, 50),
      health: {
        spoolerStatus: spoolerStatus,
        printerName: printerName,
        printerStatus: whatsappStatus === 'CONNECTED' ? 'Healthy' : 'Edge Offline',
        printerPort: 'Windows Spooler'
      },
      whatsapp: {
        status: whatsappStatus,
        phoneNumber: whatsappPhone,
        mode: 'EDGE_DISPATCHER'
      },
      supabase: {
        isOnline: true,
        pendingCount: 0,
        lastSync: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Customer Feedback & Review Shield Endpoints
// -------------------------------------------------------------
app.get('/api/feedback', async (req, res) => {
  try {
    const storeCode = (req.query.store || req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    if (supabaseSync && typeof supabaseSync.pullCloudFeedbacks === 'function') {
      try { await supabaseSync.pullCloudFeedbacks(storeCode); } catch (e) {}
    }
    const feedback = storage.getFeedback(storeCode);
    res.json({ success: true, feedbacks: feedback, feedback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const feedback = storage.addFeedback(req.body);
    if (supabaseSync) supabaseSync.syncFeedbackToCloud(feedback);
    res.json({ success: true, feedback });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Authentication Endpoints (Supports Admin & All Client Stores)
// -------------------------------------------------------------
async function authenticateCloudUser(identifier, password) {
  if (!identifier || !password) return null;

  // 1. First attempt with local in-memory state
  let user = storage.authenticateUser(identifier, password);
  if (user) return user;

  // 2. Hydrate from Supabase STORE_CONFIG rows (Serverless Resilience)
  if (supabaseSync.client) {
    try {
      const { data, error } = await supabaseSync.client
        .from('bills')
        .select('*')
        .eq('source', 'STORE_CONFIG')
        .neq('status', 'DELETED');

      if (!error && data && data.length > 0) {
        for (const row of data) {
          try {
            const configData = typeof row.raw_text === 'string' ? JSON.parse(row.raw_text) : row.raw_text;
            if (configData) {
              const sCode = (configData.storeCode || row.store_code || '').toUpperCase();
              const sName = configData.storeName || sCode;
              const sEmail = (configData.clientEmail || configData.email || `owner@${sCode.toLowerCase().replace(/\s+/g, '')}.com`).toLowerCase();
              const sPass = configData.clientPassword || configData.password || 'client123';
              const sPhone = configData.storePhone || '';

              // Ingest or update into storage clientStores
              const existingIdx = storage.state.clientStores.findIndex(s => s.storeCode === sCode);
              const storeObj = {
                id: configData.id || sCode,
                storeCode: sCode,
                storeName: sName,
                storePhone: sPhone,
                clientEmail: sEmail,
                clientPassword: sPass,
                businessCategory: configData.businessCategory || 'GENERAL',
                googleReviewUrl: configData.googleReviewUrl || '',
                customWhatsAppTemplate: configData.customWhatsAppTemplate || '',
                flyerImageUrl: configData.flyerImageUrl || '',
                status: 'ACTIVE'
              };

              if (existingIdx >= 0) {
                storage.state.clientStores[existingIdx] = { ...storage.state.clientStores[existingIdx], ...storeObj };
              } else {
                storage.state.clientStores.push(storeObj);
              }

              // Ingest into storage users
              const userIdx = storage.state.users.findIndex(u => u.storeCode === sCode || u.email === sEmail);
              const userObj = {
                id: `USR_${sCode}`,
                email: sEmail,
                password: sPass,
                name: `${sName} Owner`,
                role: 'CLIENT',
                storeCode: sCode
              };

              if (userIdx >= 0) {
                storage.state.users[userIdx] = { ...storage.state.users[userIdx], ...userObj };
              } else {
                storage.state.users.push(userObj);
              }
            }
          } catch (pe) {}
        }
      }
    } catch (err) {
      console.warn('[Cloud Auth] Supabase STORE_CONFIG hydration warning:', err.message);
    }
  }

  // 3. Retry authentication with hydrated store/user list
  return storage.authenticateUser(identifier, password);
}

app.post('/api/login', async (req, res) => {
  const email = (req.body.email || req.body.identifier || req.body.username || '').trim();
  const password = (req.body.password || '').trim();
  if (!email || !password) {
    return res.status(400).json({ error: 'Email / Store Code and password are required' });
  }

  const user = await authenticateCloudUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email/store code or password' });
  }

  const redirectUrl = user.role === 'ADMIN' ? '/admin.html' : '/index.html';
  res.json({
    success: true,
    user,
    redirectUrl
  });
});

app.post('/api/auth/login', async (req, res) => {
  const email = (req.body.email || req.body.identifier || req.body.username || '').trim();
  const password = (req.body.password || '').trim();
  if (!email || !password) {
    return res.status(400).json({ error: 'Email / Store Code and password are required' });
  }

  const user = await authenticateCloudUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email/store code or password' });
  }

  const redirectUrl = user.role === 'ADMIN' ? '/admin.html' : '/index.html';
  res.json({
    success: true,
    user,
    redirectUrl
  });
});

app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// -------------------------------------------------------------
// -------------------------------------------------------------
// Helper to aggregate store analytics directly from Supabase bills
// -------------------------------------------------------------
async function getCloudStoreAnalyticsMap() {
  const storeAnalyticsMap = {};
  const startOfTodayUtc = getStartOfTodayIst();
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

  if (supabaseSync && supabaseSync.client) {
    try {
      const { data: bills, error } = await supabaseSync.client
        .from('bills')
        .select('*')
        .neq('status', 'DELETED');

      if (!error && bills) {
        for (const b of bills) {
          if (b.source === 'AGENT_HEARTBEAT' || b.source === 'STORE_CONFIG') continue;
          if (b.invoice_no && (b.invoice_no.startsWith('HB-') || b.invoice_no.startsWith('CFG-'))) continue;

          const code = (b.store_code || 'STORE_DEMO_01').toUpperCase();
          if (!storeAnalyticsMap[code]) {
            storeAnalyticsMap[code] = {
              todaySent: 0,
              todayBills: 0,
              todaySales: 0,
              lastWeekSent: 0,
              lastWeekBills: 0,
              lastMonthSent: 0,
              lastMonthBills: 0,
              lastMonthSales: 0,
              allTimeSent: 0,
              allTimeBills: 0,
              allTimeSales: 0
            };
          }

          const bTime = new Date(b.local_created_at || b.created_at || 0).getTime();
          const amount = parseFloat(b.total_amount) || 0;
          const isDelivered = b.status === 'DELIVERED' || b.status === 'WHATSAPP_SENT';
          const isBlocked = ['IGNORED_KOT', 'DUPLICATE_SUPPRESSED', 'ANONYMOUS_WALKIN', 'DUMMY_PHONE_REJECTED', 'STORE_OWNER_FILTERED'].includes(b.status);

          // All time
          if (!isBlocked) {
            storeAnalyticsMap[code].allTimeBills++;
            storeAnalyticsMap[code].allTimeSales += amount;
          }
          if (isDelivered) {
            storeAnalyticsMap[code].allTimeSent++;
          }

          // Last 30 Days
          if (bTime >= thirtyDaysAgo) {
            if (!isBlocked) {
              storeAnalyticsMap[code].lastMonthBills++;
              storeAnalyticsMap[code].lastMonthSales += amount;
            }
            if (isDelivered) {
              storeAnalyticsMap[code].lastMonthSent++;
            }
          }

          // Last 7 Days
          if (bTime >= sevenDaysAgo) {
            if (!isBlocked) {
              storeAnalyticsMap[code].lastWeekBills++;
            }
            if (isDelivered) {
              storeAnalyticsMap[code].lastWeekSent++;
            }
          }

          // Today
          if (bTime >= startOfTodayUtc) {
            if (!isBlocked) {
              storeAnalyticsMap[code].todayBills++;
              storeAnalyticsMap[code].todaySales += amount;
            }
            if (isDelivered) {
              storeAnalyticsMap[code].todaySent++;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Admin Cloud Analytics] Supabase query error:', err.message);
    }
  }

  return storeAnalyticsMap;
}

// -------------------------------------------------------------
// SaaS Multi-Tenant Store Management (Admin API)
// -------------------------------------------------------------
app.get('/api/admin/clients', async (req, res) => {
  try {
    if (supabaseSync && typeof supabaseSync.pullCloudStores === 'function') {
      try { await supabaseSync.pullCloudStores(); } catch (e) {}
    }
    const clientsWithMetrics = storage.getAllClientsWithAnalytics();
    const cloudAnalyticsMap = await getCloudStoreAnalyticsMap();

    // Query live agent heartbeats from Supabase
    let heartbeats = [];
    if (supabaseSync && supabaseSync.client) {
      try {
        const { data: hbData } = await supabaseSync.client
          .from('bills')
          .select('*')
          .eq('source', 'AGENT_HEARTBEAT');
        if (hbData) heartbeats = hbData;
      } catch (e) {}
    }

    for (const c of clientsWithMetrics) {
      const code = (c.storeCode || '').toUpperCase();
      if (cloudAnalyticsMap[code]) {
        const ca = cloudAnalyticsMap[code];
        c.analytics = {
          ...c.analytics,
          todaySent: ca.todaySent,
          todayBills: ca.todayBills,
          todaySales: Math.round(ca.todaySales),
          lastWeekSent: ca.lastWeekSent,
          lastWeekBills: ca.lastWeekBills,
          lastMonthSent: ca.lastMonthSent,
          lastMonthBills: ca.lastMonthBills,
          lastMonthSales: Math.round(ca.lastMonthSales),
          allTimeSent: ca.allTimeSent,
          allTimeBills: ca.allTimeBills,
          allTimeSales: Math.round(ca.allTimeSales),
          reachRate: ca.allTimeBills > 0 ? Math.round((ca.allTimeSent / ca.allTimeBills) * 100) : 0
        };
      }

      const hb = heartbeats.find(h => (h.store_code || '').toUpperCase() === code);
      if (hb) {
        c.whatsappStatus = hb.status || 'NOT_LINKED';
        c.whatsappPhone = hb.customer_phone;
        if (hb.raw_text) {
          try {
            const hbData = JSON.parse(hb.raw_text);
            c.spoolerStatus = hbData.spoolerStatus || 'Healthy';
            c.lastHeartbeat = hb.synced_at || hb.local_created_at;
          } catch (e) {}
        }
      }
    }

    res.json({ success: true, stores: clientsWithMetrics, metrics: storage.getMetrics() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/clients/:storeCode/details', async (req, res) => {
  try {
    if (supabaseSync && typeof supabaseSync.pullCloudStores === 'function') {
      try { await supabaseSync.pullCloudStores(); } catch (e) {}
    }
    const rawCode = decodeURIComponent(req.params.storeCode);
    const store = storage.getStoreByCode(rawCode);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    const analytics = storage.getClientDetailedAnalytics(rawCode);
    res.json({ success: true, store, analytics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/analytics/summary', async (req, res) => {
  try {
    if (supabaseSync && typeof supabaseSync.pullCloudStores === 'function') {
      try { await supabaseSync.pullCloudStores(); } catch (e) {}
    }
    const clients = storage.getAllClientsWithAnalytics();
    const cloudAnalyticsMap = await getCloudStoreAnalyticsMap();
    const metrics = storage.getMetrics();

    let totalTodaySent = 0;
    let totalTodayBills = 0;
    let totalTodaySales = 0;

    let totalMonthSent = 0;
    let totalMonthBills = 0;
    let totalMonthSales = 0;

    let totalAllTimeSent = 0;
    let totalAllTimeBills = 0;
    let totalAllTimeSales = 0;

    for (const c of clients) {
      const code = (c.storeCode || '').toUpperCase();
      const a = cloudAnalyticsMap[code] || c.analytics || {};
      totalTodaySent += a.todaySent || 0;
      totalTodayBills += a.todayBills || 0;
      totalTodaySales += (a.todaySales !== undefined ? a.todaySales : 0);

      totalMonthSent += a.lastMonthSent || 0;
      totalMonthBills += a.lastMonthBills || 0;
      totalMonthSales += (a.lastMonthSales !== undefined ? a.lastMonthSales : 0);

      totalAllTimeSent += a.allTimeSent || 0;
      totalAllTimeBills += a.allTimeBills || 0;
      totalAllTimeSales += (a.allTimeSales !== undefined ? a.allTimeSales : 0);
    }

    res.json({
      success: true,
      totalStores: clients.length,
      today: {
        sent: totalTodaySent,
        bills: totalTodayBills,
        sales: Math.round(totalTodaySales),
        reachRate: totalTodayBills > 0 ? Math.round((totalTodaySent / totalTodayBills) * 100) : 0
      },
      lastMonth: {
        sent: totalMonthSent,
        bills: totalMonthBills,
        sales: Math.round(totalMonthSales),
        reachRate: totalMonthBills > 0 ? Math.round((totalMonthSent / totalMonthBills) * 100) : 0
      },
      allTime: {
        sent: totalAllTimeSent,
        bills: totalAllTimeBills,
        sales: Math.round(totalAllTimeSales),
        reachRate: totalAllTimeBills > 0 ? Math.round((totalAllTimeSent / totalAllTimeBills) * 100) : 0
      },
      metrics
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/clients', async (req, res) => {
  try {
    const newStore = storage.createStore(req.body);
    if (supabaseSync && typeof supabaseSync.syncStoreToCloud === 'function') {
      await supabaseSync.syncStoreToCloud(newStore, {
        email: req.body.clientEmail,
        password: req.body.clientPassword
      });
    }
    res.json({ success: true, store: newStore });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/clients/:storeCode', async (req, res) => {
  try {
    const rawCode = decodeURIComponent(req.params.storeCode);
    if (supabaseSync && typeof supabaseSync.pullCloudStores === 'function') {
      try { await supabaseSync.pullCloudStores(); } catch (e) {}
    }
    let updated;
    try {
      updated = storage.updateStore(rawCode, req.body);
    } catch (e) {
      updated = storage.createStore({ ...req.body, storeCode: rawCode });
    }
    if (supabaseSync && typeof supabaseSync.syncStoreToCloud === 'function') {
      await supabaseSync.syncStoreToCloud(updated, {
        email: req.body.clientEmail,
        password: req.body.clientPassword
      });
    }
    res.json({ success: true, store: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/clients/:storeCode', async (req, res) => {
  try {
    const storeCode = req.params.storeCode;
    const deleted = storage.deleteStore(storeCode);
    if (!deleted) {
      return res.status(404).json({ error: 'Store not found' });
    }
    if (supabaseSync && typeof supabaseSync.deleteStoreFromCloud === 'function') {
      await supabaseSync.deleteStoreFromCloud(storeCode);
    }
    res.json({ success: true, storeCode: req.params.storeCode });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/upload-image', (req, res) => {
  try {
    const { storeCode, imageBase64, fileName } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(imageBase64, 'base64');
    const ext = fileName ? path.extname(fileName) || '.jpg' : '.jpg';
    const targetName = `${storeCode || 'flyer_' + Date.now()}${ext}`;

    const uploadsDir = path.join(__dirname, '../public/uploads/flyers');
    const dataDir = path.join(__dirname, '../data/flyers');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const localPath = path.join(uploadsDir, targetName);
    const dataPath = path.join(dataDir, targetName);

    fs.writeFileSync(localPath, buffer);
    fs.writeFileSync(dataPath, buffer);

    const imageUrl = `/uploads/flyers/${targetName}`;
    res.json({ success: true, imageUrl, filePath: localPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dynamic Personalized Flyer Preview Endpoint
app.post('/api/admin/flyer/preview', async (req, res) => {
  try {
    const { imageBase64, customerName, template, posX, posY, fontSize, color, badgeBg, fontFamily } = req.body;
    let baseBuffer = null;
    if (imageBase64) {
      const clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      baseBuffer = Buffer.from(clean, 'base64');
    }

    const previewBuffer = await PersonalizedImageGenerator.generateOverlay({
      baseImageBuffer: baseBuffer,
      customerName: customerName || 'Rahul Sharma',
      template: template || 'Specially for {{name}}! ✨',
      posX: Number(posX) || 50,
      posY: Number(posY) || 18,
      fontSize: Number(fontSize) || 28,
      color: color || '#FFFFFF',
      badgeBg: badgeBg || 'rgba(0, 0, 0, 0.70)',
      fontFamily: fontFamily || 'Plus Jakarta Sans, sans-serif'
    });

    res.set('Content-Type', 'image/png');
    res.send(previewBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Smart Review Shield & Customer Gatekeeper Endpoints
// -------------------------------------------------------------
app.get('/api/review-info/:billId', async (req, res) => {
  const { billId } = req.params;
  const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const store = storage.getStoreByCode(storeCode) || {
    storeCode,
    storeName: storage.getConfig().storeName || 'Sunshine Cafe & Bistro',
    googleReviewUrl: storage.getConfig().googleReviewUrl || 'https://g.page/review'
  };

  let bill = storage.state.transactions.find(t => t.id === billId || t.invoiceNo === billId);

  // If on Cloud, fetch from Supabase if not found locally
  if (!bill && supabaseSync && supabaseSync.client) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(billId);
      let query = supabaseSync.client.from('bills').select('*');
      if (isUuid) {
        query = query.or(`id.eq.${billId},invoice_no.eq.${billId}`);
      } else {
        query = query.eq('invoice_no', billId);
      }
      const { data } = await query.limit(1);
      if (data && data.length > 0) {
        const b = data[0];
        bill = {
          id: b.id,
          invoiceNo: b.invoice_no,
          totalAmount: (b.total_amount || 0).toFixed(2),
          customerName: b.customer_name || 'Valued Customer',
          customerPhone: b.customer_phone || '9876543210'
        };
      }
    } catch (e) {}
  }

  if (!bill) {
    bill = {
      id: billId,
      invoiceNo: billId.startsWith('INV-') ? billId : 'INV-4920',
      totalAmount: '450.00',
      customerName: 'Valued Customer',
      customerPhone: '9876543210'
    };
  }

  // Update Supabase link clicked status
  if (supabaseSync && supabaseSync.client && bill.customerPhone) {
    try {
      supabaseSync.client
        .from('review_dispatches')
        .update({ review_link_clicked: true })
        .eq('store_code', storeCode)
        .eq('customer_phone', bill.customerPhone)
        .then(() => {});
    } catch (e) {}
  }

  res.json({ success: true, store, bill });
});

app.post('/api/feedback', async (req, res) => {
  try {
    const fb = storage.addFeedback(req.body);
    if (supabaseSync && typeof supabaseSync.syncFeedbackToCloud === 'function') {
      await supabaseSync.syncFeedbackToCloud(fb);
    }
    res.json({ success: true, feedback: fb });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/feedback', async (req, res) => {
  const storeCode = (req.query.store || req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  let feedbacks = storage.getFeedback(storeCode);
  
  if (supabaseSync && supabaseSync.client) {
    try {
      const { data, error } = await supabaseSync.client
        .from('review_dispatches')
        .select('*')
        .eq('store_code', storeCode)
        .order('created_at', { ascending: false });
      
      if (!error && data && data.length > 0) {
        feedbacks = data.map(r => {
          const isPositive = (r.rating_given && r.rating_given >= 4) || r.dispatch_status === 'GOOGLE_REDIRECT';
          let category = isPositive ? 'Satisfied Customer' : 'Customer Grievance';
          let comment = r.message_text || '';
          if (comment.includes(' - ') && comment.includes(': ')) {
            const parts = comment.split(' - ');
            if (parts.length > 1) {
              const sub = parts[1].split(': ');
              category = sub[0] || category;
              comment = sub.slice(1).join(': ') || comment;
            }
          }
          return {
            id: r.id,
            storeCode: r.store_code,
            customerPhone: r.customer_phone || '9876543210',
            customerName: r.customer_name || 'Valued Customer',
            invoiceNo: 'INV-4920',
            rating: r.rating_given || (isPositive ? 5 : 2),
            action: r.dispatch_status || (isPositive ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK'),
            category: category,
            comment: comment,
            requestCallback: !isPositive,
            status: 'OPEN',
            timestamp: r.created_at || new Date().toISOString()
          };
        });
      }
    } catch (e) {
      console.warn('Supabase feedback get error:', e.message);
    }
  }
  
  feedbacks = feedbacks.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json({ success: true, feedbacks });
});

app.put('/api/feedback/:id/status', (req, res) => {
  const { status, notes } = req.body;
  const fb = storage.updateFeedbackStatus(req.params.id, status || 'RESOLVED', notes);
  if (!fb) return res.status(404).json({ error: 'Feedback not found' });
  res.json({ success: true, feedback: fb });
});

// -------------------------------------------------------------
// Digital E-Bill & PDF Receipt Renderer
// -------------------------------------------------------------
app.get('/api/bill/:billId', (req, res) => {
  const { billId } = req.params;
  const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const store = storage.getStoreByCode(storeCode) || {
    storeName: storage.getConfig().storeName || 'Sunshine Cafe & Bistro',
    storePhone: storage.getConfig().storePhone || '9840012345',
    storeGstin: storage.getConfig().storeGstin || '33AABCS1429B1ZB'
  };

  const tx = storage.state.transactions.find(t => t.id === billId);
  const items = tx?.rawText ? parseReceiptItems(tx.rawText) : [
    { name: 'Cold Brew Coffee', qty: '1', price: '180.00' },
    { name: 'Margherita Pizza', qty: '1', price: '350.00' }
  ];

  res.json({
    success: true,
    bill: {
      id: billId,
      invoiceNo: tx?.invoiceNo || 'INV-5501',
      totalAmount: tx?.totalAmount || '530.00',
      customerName: tx?.customerName || 'Valued Customer',
      customerPhone: tx?.customerPhone || '9840112233',
      timestamp: tx?.timestamp || new Date().toISOString(),
      items: items,
      storeName: store.storeName,
      storePhone: store.storePhone,
      storeGstin: store.storeGstin || '33AABCS1429B1ZB'
    }
  });
});

app.get('/api/bill/:billId/pdf', (req, res) => {
  const { billId } = req.params;
  const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const store = storage.getStoreByCode(storeCode) || {
    storeName: storage.getConfig().storeName || 'Sunshine Cafe & Bistro',
    storePhone: storage.getConfig().storePhone || '9840012345',
    storeGstin: storage.getConfig().storeGstin || '33AABCS1429B1ZB'
  };

  const tx = storage.state.transactions.find(t => t.id === billId);
  const pdfBuffer = generateInvoicePdfBuffer({
    id: billId,
    invoiceNo: tx?.invoiceNo || 'INV-5501',
    totalAmount: tx?.totalAmount || '530.00',
    customerName: tx?.customerName || 'Valued Customer',
    customerPhone: tx?.customerPhone || '9840112233',
    timestamp: tx?.timestamp || new Date().toISOString(),
    rawText: tx?.rawText || ''
  }, store);

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="Invoice-${tx?.invoiceNo || billId}.pdf"`,
    'Content-Length': pdfBuffer.length
  });
  res.send(pdfBuffer);
});

// -------------------------------------------------------------
// Live System State & Telemetry Endpoints (Live Cloud Sync)
// -------------------------------------------------------------
app.get('/api/state', async (req, res) => {
  try {
    const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const bills = await getStoreBills(storeCode);

    // Compute dynamic 3-Period analytics from bills
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    let todaySent = 0, todayBills = 0, todaySales = 0;
    let monthSent = 0, monthBills = 0, monthSales = 0;
    let allTimeSent = 0, allTimeBills = 0, allTimeSales = 0;

    for (const t of bills) {
      const tTime = new Date(t.timestamp).getTime();
      const amt = parseFloat(t.totalAmount) || 0;
      const isDelivered = t.status === 'DELIVERED';

      allTimeBills++;
      allTimeSales += amt;
      if (isDelivered) allTimeSent++;

      if (tTime >= thirtyDaysAgo) {
        monthBills++;
        monthSales += amt;
        if (isDelivered) monthSent++;
      }

      if (tTime >= startOfToday) {
        todayBills++;
        todaySales += amt;
        if (isDelivered) todaySent++;
      }
    }

    let storeFeedbacks = storage.getFeedback(storeCode);
    if (supabaseSync && supabaseSync.client) {
      try {
        const { data, error } = await supabaseSync.client
          .from('review_dispatches')
          .select('*')
          .eq('store_code', storeCode);
        if (!error && data && data.length > 0) {
          storeFeedbacks = data.map(r => {
            const isPositive = (r.rating_given && r.rating_given >= 4) || r.dispatch_status === 'GOOGLE_REDIRECT';
            return {
              id: r.id,
              storeCode: r.store_code,
              customerPhone: r.customer_phone,
              rating: r.rating_given || (isPositive ? 5 : 2),
              action: isPositive ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK',
              category: isPositive ? 'Satisfied Customer' : 'General Feedback',
              comment: r.message_text,
              timestamp: r.created_at || new Date().toISOString()
            };
          });
        }
      } catch (e) {
        console.warn('Supabase feedback fetch note:', e.message);
      }
    }

    const todayFeedbacks = storeFeedbacks.filter(f => new Date(f.timestamp).getTime() >= startOfToday);
    const monthFeedbacks = storeFeedbacks.filter(f => new Date(f.timestamp).getTime() >= thirtyDaysAgo);

    const analytics = {
      today: {
        sent: todaySent,
        bills: todayBills,
        sales: Math.round(todaySales),
        positiveRedirects: todayFeedbacks.filter(f => f.action === 'GOOGLE_REDIRECT').length,
        shieldedGrievances: todayFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK').length,
        reachRate: todayBills > 0 ? Math.round((todaySent / todayBills) * 100) : 0
      },
      lastMonth: {
        sent: monthSent,
        bills: monthBills,
        sales: Math.round(monthSales),
        positiveRedirects: monthFeedbacks.filter(f => f.action === 'GOOGLE_REDIRECT').length,
        shieldedGrievances: monthFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK').length,
        reachRate: monthBills > 0 ? Math.round((monthSent / monthBills) * 100) : 0
      },
      allTime: {
        sent: allTimeSent,
        bills: allTimeBills,
        sales: Math.round(allTimeSales),
        positiveRedirects: storeFeedbacks.filter(f => f.action === 'GOOGLE_REDIRECT').length,
        shieldedGrievances: storeFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK').length,
        reachRate: allTimeBills > 0 ? Math.round((allTimeSent / allTimeBills) * 100) : 0
      }
    };

    const metrics = {
      validInvoicesProcessed: allTimeBills,
      deliveredCount: allTimeSent,
      fiveStarGoogleReviews: allTimeSent,
      negativeReviewsShielded: 0,
      revenueRecovered: 0
    };

    res.json({
      success: true,
      config: storage.getConfig(),
      metrics: metrics,
      analytics: analytics,
      quota: storage.getTodayQuotaUsage(storeCode),
      transactions: bills,
      health: { isOnline: true, uptime: process.uptime(), lastSync: new Date().toISOString() },
      whatsapp: { status: 'CONNECTED', mode: 'CLOUD_EDGE_GATEWAY' },
      supabase: { isOnline: true, connected: true }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/client/analytics/:storeCode?', async (req, res) => {
  const storeCode = (req.params.storeCode || req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const bills = await getStoreBills(storeCode);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

  let todaySent = 0, todayBills = 0, todaySales = 0;
  let monthSent = 0, monthBills = 0, monthSales = 0;
  let allTimeSent = 0, allTimeBills = 0, allTimeSales = 0;

  for (const t of bills) {
    const tTime = new Date(t.timestamp).getTime();
    const amt = parseFloat(t.totalAmount) || 0;
    const isDelivered = t.status === 'DELIVERED';

    allTimeBills++;
    allTimeSales += amt;
    if (isDelivered) allTimeSent++;

    if (tTime >= thirtyDaysAgo) {
      monthBills++;
      monthSales += amt;
      if (isDelivered) monthSent++;
    }

    if (tTime >= startOfToday) {
      todayBills++;
      todaySales += amt;
      if (isDelivered) todaySent++;
    }
  }

  const analytics = {
    today: { sent: todaySent, bills: todayBills, sales: Math.round(todaySales), googleFiveStar: todaySent, reviewShield: 0 },
    lastMonth: { sent: monthSent, bills: monthBills, sales: Math.round(monthSales), googleFiveStar: monthSent, reviewShield: 0 },
    allTime: { sent: allTimeSent, bills: allTimeBills, sales: Math.round(allTimeSales), googleFiveStar: allTimeSent, reviewShield: 0 }
  };

  res.json({ success: true, storeCode, analytics });
});

// Win-Back Radar Endpoints (Unified Supabase Ingestion)
app.get('/api/winback/directory', async (req, res) => {
  const storeCode = (req.query.store || req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const bills = await getStoreBills(storeCode);
  const directory = buildCustomerDirectoryFromBills(bills);
  res.json({ success: true, directory });
});

app.get('/api/winback/customers', async (req, res) => {
  const storeCode = (req.query.store || req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const bills = await getStoreBills(storeCode);
  const customers = buildCustomerDirectoryFromBills(bills);
  res.json({ success: true, customers });
});

app.get('/api/winback/analytics', async (req, res) => {
  const storeCode = (req.query.store || req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const bills = await getStoreBills(storeCode);
  const customers = buildCustomerDirectoryFromBills(bills);

  const lapsed = customers.filter(c => c.segment === 'LAPSED').length;
  res.json({
    success: true,
    analytics: {
      lapsedCount: lapsed,
      winBacksSent: 0,
      customersRecovered: 0,
      recoveryRate: 0,
      totalRecoveredRevenue: 0
    }
  });
});

app.get('/api/winback/template', (req, res) => {
  const storeCode = (req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const store = storage.getStoreByCode(storeCode) || storage.getConfig();
  const cfg = storage.getConfig();
  const defaultTpl = `Hi {{name}}! ✨ We noticed it’s been a while since your last visit to {{storeName}}.\n\nWe’ve refreshed our seasonal specialties and ambiance, and our entire team would love to welcome you back! ☕🍰\n\nHope to see you again soon!\n📍 Directions & Location: {{googleMapUrl}}\n\n(Reply STOP to unsubscribe)`;
  
  const activeTemplate = store.customWinBackTemplate || cfg.customWinBackTemplate || defaultTpl;
  res.json({
    success: true,
    template: activeTemplate,
    isCustom: !!(store.customWinBackTemplate || cfg.customWinBackTemplate)
  });
});

app.post('/api/winback/template', (req, res) => {
  try {
    const { storeCode, template } = req.body;
    const code = (storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    
    storage.updateStore(code, { customWinBackTemplate: template });
    storage.updateConfig({ customWinBackTemplate: template });
    
    res.json({ success: true, message: 'Win-Back WhatsApp template updated successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/winback/dispatch', async (req, res) => {
  try {
    const { storeCode, customerPhone, mode, customMessage } = req.body;
    const code = storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01';

    if (mode === 'BATCH_SCAN') {
      const result = await winBackEngine.runDailyScanAndDispatch(code, req.body.maxBatch || 5);
      return res.json(result);
    }

    if (!customerPhone) {
      return res.status(400).json({ error: 'customerPhone is required for direct winback dispatch' });
    }

    const result = await winBackEngine.dispatchToCustomer(code, customerPhone, customMessage);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Smart Review Shield & Customer Feedback Endpoints
// -------------------------------------------------------------
app.get('/api/feedback', async (req, res) => {
  try {
    const storeCode = (req.query.store || req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    let feedbacks = storage.getFeedback(storeCode);

    if (supabaseSync && supabaseSync.client) {
      const { data, error } = await supabaseSync.client
        .from('review_dispatches')
        .select('*')
        .eq('store_code', storeCode)
        .eq('dispatch_status', 'PRIVATE_FEEDBACK')
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        feedbacks = data
          .filter(r => (r.rating_given && Number(r.rating_given) <= 3) || r.dispatch_status === 'PRIVATE_FEEDBACK')
          .map(r => {
            let category = 'General Grievance';
            let comment = r.message_text || '';
            if (comment.includes(' - ') && comment.includes(': ')) {
              const parts = comment.split(' - ');
              if (parts.length > 1) {
                const subParts = parts[1].split(': ');
                category = subParts[0] || category;
                comment = subParts.slice(1).join(': ') || comment;
              }
            }
            return {
              id: r.id,
              billId: r.bill_id,
              storeCode: r.store_code,
              invoiceNo: 'INV-4920',
              customerName: r.customer_name || 'Customer',
              customerPhone: r.customer_phone || '9876543210',
              rating: r.rating_given || 2,
              action: 'PRIVATE_FEEDBACK',
              category: category,
              comment: comment,
              requestCallback: true,
              status: r.resolution_status || 'OPEN',
              timestamp: r.created_at || new Date().toISOString()
            };
          });
      }
    }

    res.json({ success: true, feedbacks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/feedback/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const updated = storage.updateFeedbackStatus(req.params.id, status || 'RESOLVED', notes);
    if (supabaseSync && supabaseSync.client) {
      try {
        await supabaseSync.client
          .from('review_dispatches')
          .update({ resolution_status: status || 'RESOLVED' })
          .eq('id', req.params.id);
      } catch (e) {}
    }
    res.json({ success: true, feedback: updated || { id: req.params.id, status: status || 'RESOLVED' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Digital E-Bill & PDF Receipt Cloud Endpoints
// -------------------------------------------------------------
app.get('/api/bill-info/:billId', async (req, res) => {
  try {
    const billId = req.params.billId;
    const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const store = storage.getStoreByCode(storeCode) || {
      storeCode: storeCode,
      storeName: storage.getConfig().storeName || 'Sunshine Cafe & Bistro',
      storePhone: storage.getConfig().storePhone || '9840012345',
      storeGstin: storage.getConfig().storeGstin || '33AABCS1429B1ZB',
      googleReviewUrl: storage.getConfig().googleReviewUrl || 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4'
    };

    let tx = null;
    // 1. Try finding in Supabase bills table
    if (supabaseSync.client) {
      try {
        const { data, error } = await supabaseSync.client
          .from('bills')
          .select('*')
          .or(`id.eq.${billId},invoice_no.eq.${billId}`)
          .limit(1);

        if (!error && data && data.length > 0) {
          const b = data[0];
          tx = {
            id: b.id || b.invoice_no,
            storeCode: b.store_code,
            invoiceNo: b.invoice_no,
            customerName: b.customer_name || 'Valued Customer',
            customerPhone: b.customer_phone || 'N/A',
            totalAmount: (b.total_amount || 0).toFixed(2),
            timestamp: b.local_created_at || b.created_at,
            rawText: b.raw_text || ''
          };
        }
      } catch (err) {
        console.warn('[Bill Info] Supabase lookup note:', err.message);
      }
    }

    // 2. Fallback to storage
    if (!tx) {
      tx = storage.state.transactions.find(t => t.id === billId || t.invoiceNo === billId);
    }

    // 3. Fallback dummy demo bill
    if (!tx) {
      tx = {
        id: billId,
        invoiceNo: billId.startsWith('INV') ? billId : 'INV-8172',
        customerName: 'Rahul',
        customerPhone: '9342350747',
        totalAmount: '346.50',
        timestamp: new Date().toISOString(),
        rawText: `1x Cold Brew Coffee ₹180.00\n1x Chocolate Brownie ₹150.00\nTOTAL AMOUNT: ₹346.50`
      };
    }

    const parsed = parseReceiptItems(tx.rawText || '');

    res.json({
      success: true,
      store: {
        storeName: store.storeName,
        storePhone: store.storePhone,
        storeGstin: store.storeGstin,
        googleReviewUrl: store.googleReviewUrl
      },
      transaction: tx,
      parsed
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bill-pdf/:billId', async (req, res) => {
  try {
    const billId = req.params.billId;
    const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const store = storage.getStoreByCode(storeCode) || storage.getConfig();

    let tx = storage.state.transactions.find(t => t.id === billId || t.invoiceNo === billId);
    if (!tx && supabaseSync.client) {
      try {
        const { data } = await supabaseSync.client.from('bills').select('*').or(`id.eq.${billId},invoice_no.eq.${billId}`).limit(1);
        if (data && data.length > 0) {
          const b = data[0];
          tx = {
            id: b.id,
            storeCode: b.store_code,
            invoiceNo: b.invoice_no,
            customerName: b.customer_name,
            customerPhone: b.customer_phone,
            totalAmount: b.total_amount,
            timestamp: b.created_at,
            rawText: b.raw_text
          };
        }
      } catch (e) {}
    }

    if (!tx) {
      tx = {
        id: billId,
        invoiceNo: 'INV-8172',
        customerName: 'Rahul',
        customerPhone: '9342350747',
        totalAmount: '346.50',
        timestamp: new Date().toISOString(),
        rawText: `1x Cold Brew Coffee ₹180.00\n1x Chocolate Brownie ₹150.00\nTOTAL AMOUNT: ₹346.50`
      };
    }

    const pdfBuffer = await generateInvoicePdfBuffer(tx, store);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Tax_Invoice_${tx.invoiceNo || 'Receipt'}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Review Info & Feedback Endpoints
// -------------------------------------------------------------
app.get('/api/review-info/:billId', async (req, res) => {
  try {
    const billId = req.params.billId;
    const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const store = storage.getStoreByCode(storeCode) || storage.getConfig();

    let tx = storage.state.transactions.find(t => t.id === billId || t.invoiceNo === billId);
    if (!tx && supabaseSync.client) {
      try {
        const { data } = await supabaseSync.client.from('bills').select('*').or(`id.eq.${billId},invoice_no.eq.${billId}`).limit(1);
        if (data && data.length > 0) {
          tx = {
            id: data[0].id,
            invoiceNo: data[0].invoice_no,
            customerName: data[0].customer_name,
            customerPhone: data[0].customer_phone,
            totalAmount: data[0].total_amount
          };
        }
      } catch (e) {}
    }

    if (!tx) {
      tx = {
        id: billId,
        invoiceNo: 'INV-8172',
        customerName: 'Rahul',
        customerPhone: '9342350747',
        totalAmount: '346.50'
      };
    }

    res.json({
      success: true,
      store: {
        storeCode: store.storeCode || storeCode,
        storeName: store.storeName || 'Sunshine Cafe & Bistro',
        googleReviewUrl: store.googleReviewUrl || 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4'
      },
      bill: tx
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clear-history', async (req, res) => {
  const storeCode = (req.query.store || req.body?.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  storage.clearStoreFeed(storeCode);
  res.json({ success: true, storeCode });
});

// HTML Page Route Handlers
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/review.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/review.html'));
});

app.get('/bill.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/bill.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Enable running the cloud online POS server directly locally
const isDirectRun = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
  process.argv[1].endsWith('api\\index.js') ||
  process.argv[1].endsWith('api/index.js')
);

if (isDirectRun) {
  const PORT = process.env.CLOUD_PORT || process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`\n========================================================`);
    console.log(`🌐 REVIEWEASY ONLINE CLOUD POS (LOCAL EMULATION) READY`);
    console.log(`📍 Web URL              : http://localhost:${PORT}`);
    console.log(`🔐 Unified Login Portal : http://localhost:${PORT}/login.html`);
    console.log(`👑 SaaS Admin Portal    : http://localhost:${PORT}/admin.html`);
    console.log(`🏪 Client Dashboard     : http://localhost:${PORT}/index.html`);
    console.log(`========================================================\n`);
  });
}

export default app;
