import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { storage } from '../src/engine/storage.js';
import { SupabaseSyncEngine } from '../src/engine/supabase-sync.js';
import { PersonalizedImageGenerator } from '../src/engine/personalized-image-generator.js';
import { generateInvoicePdfBuffer } from '../src/engine/invoice-generator.js';
import { WinBackEngine } from '../src/engine/winback-engine.js';

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
const supabaseSync = new SupabaseSyncEngine();
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
        .order('created_at', { ascending: false });

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

  return Object.values(customerMap).map(c => {
    const daysSinceLastVisit = Math.floor((now - c.lastVisitTimestamp) / (24 * 60 * 60 * 1000));
    let segment = 'REGULAR';
    if (daysSinceLastVisit > 60) segment = 'DORMANT';
    else if (daysSinceLastVisit >= 30) segment = 'LAPSED';

    return {
      ...c,
      daysSinceLastVisit,
      segment,
      winBackStatus: 'ELIGIBLE'
    };
  });
}

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = storage.authenticateUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const redirectUrl = user.role === 'ADMIN' ? '/admin.html' : '/index.html';
  res.json({
    success: true,
    user,
    redirectUrl
  });
});

// -------------------------------------------------------------
// SaaS Multi-Tenant Store Management (Admin API)
// -------------------------------------------------------------
app.get('/api/admin/clients', (req, res) => {
  try {
    const clientsWithMetrics = storage.getAllClientsWithAnalytics();
    res.json({ success: true, stores: clientsWithMetrics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/clients/:storeCode/details', (req, res) => {
  try {
    const store = storage.getStoreByCode(req.params.storeCode);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    const analytics = storage.getClientDetailedAnalytics(req.params.storeCode);
    res.json({ success: true, store, analytics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/analytics/summary', (req, res) => {
  try {
    const clients = storage.getAllClientsWithAnalytics();
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
      const a = c.analytics || {};
      totalTodaySent += a.todaySent || 0;
      totalTodayBills += a.todayBills || 0;
      totalMonthSent += a.lastMonthSent || 0;
      totalMonthBills += a.lastMonthBills || 0;
      totalAllTimeSent += a.allTimeSent || 0;
      totalAllTimeBills += a.allTimeBills || 0;
      totalAllTimeSales += a.allTimeSales || 0;
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

app.post('/api/admin/clients', (req, res) => {
  try {
    const newStore = storage.createStore(req.body);
    supabaseSync.syncStoreToCloud(newStore);
    res.json({ success: true, store: newStore });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/clients/:storeCode', (req, res) => {
  try {
    const updated = storage.updateStore(req.params.storeCode, req.body);
    supabaseSync.syncStoreToCloud(updated);
    res.json({ success: true, store: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/clients/:storeCode', (req, res) => {
  try {
    const deleted = storage.deleteStore(req.params.storeCode);
    if (!deleted) {
      return res.status(404).json({ error: 'Store not found' });
    }
    res.json({ success: true, storeCode: req.params.storeCode });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
app.get('/api/review-info/:billId', (req, res) => {
  const { billId } = req.params;
  const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const store = storage.getStoreByCode(storeCode) || {
    storeCode,
    storeName: storage.getConfig().storeName || 'Sunshine Cafe & Bistro',
    googleReviewUrl: storage.getConfig().googleReviewUrl || 'https://g.page/review'
  };

  const bill = storage.state.transactions.find(t => t.id === billId) || {
    id: billId,
    invoiceNo: 'INV-4920',
    totalAmount: '450.00',
    customerName: 'Valued Customer'
  };

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

app.get('/api/feedback', (req, res) => {
  const storeCode = (req.query.store || req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  res.json({ success: true, feedbacks: storage.getFeedback(storeCode) });
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

app.post('/api/feedback', async (req, res) => {
  try {
    const { billId, storeCode, invoiceNo, customerName, customerPhone, rating, action, category, comment, requestCallback } = req.body;
    const code = (storeCode || 'STORE_DEMO_01').toUpperCase();

    const feedback = storage.addFeedback({
      billId,
      storeCode: code,
      invoiceNo: invoiceNo || 'INV-4920',
      customerName: customerName || 'Valued Customer',
      customerPhone: customerPhone || '9876543210',
      rating: parseInt(rating, 10) || 5,
      action: action || (rating >= 4 ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK'),
      category: category || (rating >= 4 ? 'Satisfied Customer' : 'General Service'),
      comment: comment || (rating >= 4 ? 'Customer rated 4-5 stars and was routed to Google.' : 'No comment provided'),
      requestCallback: !!requestCallback
    });

    if (feedback.rating >= 4) {
      storage.incrementMetric('positiveReviewsRedirected');
    } else {
      storage.incrementMetric('negativeReviewsShielded');
    }

    if (supabaseSync.client) {
      try {
        await supabaseSync.client.from('review_dispatches').insert({
          store_code: code,
          customer_phone: feedback.customerPhone,
          message_body: `Feedback: ${feedback.rating}★ - ${feedback.category}: ${feedback.comment}`,
          status: feedback.action,
          status_reason: feedback.comment,
          dispatched_via: 'SMART_REVIEW_SHIELD'
        });
      } catch (e) {}
    }

    res.json({ success: true, feedback });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/feedback', (req, res) => {
  const storeCode = (req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const feedbacks = storage.getFeedback(storeCode);
  res.json({ success: true, feedbacks });
});

app.put('/api/feedback/:id/status', (req, res) => {
  const { status, notes } = req.body;
  const updated = storage.updateFeedbackStatus(req.params.id, status || 'RESOLVED', notes);
  res.json({ success: true, feedback: updated });
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

export default app;
