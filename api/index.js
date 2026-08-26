import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { storage } from '../src/engine/storage.js';
import { SupabaseSyncEngine } from '../src/engine/supabase-sync.js';
import { parseReceiptItems, generateInvoicePdfBuffer } from '../src/engine/invoice-generator.js';
import { PersonalizedImageGenerator } from '../src/engine/personalized-image-generator.js';
import { BUSINESS_CATEGORIES, getCategoryTemplate, formatWhatsAppMessage } from '../src/engine/business-templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// CORS Middleware
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

app.post('/api/feedback', (req, res) => {
  try {
    const fb = storage.addFeedback(req.body);
    supabaseSync.syncFeedbackToCloud(fb);
    res.json({ success: true, feedback: fb });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/feedback', (req, res) => {
  const storeCode = req.query.store || null;
  res.json({ success: true, feedback: storage.getFeedback(storeCode) });
});

app.put('/api/feedback/:id/status', (req, res) => {
  const { status, notes } = req.body;
  const fb = storage.updateFeedbackStatus(req.params.id, status, notes);
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
// System State & Client Telemetry Endpoints
// -------------------------------------------------------------
app.get('/api/state', (req, res) => {
  const storeCode = req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01';
  res.json({
    config: storage.getConfig(),
    metrics: storage.getMetrics(),
    analytics: storage.getClientDetailedAnalytics(storeCode),
    quota: storage.getTodayQuotaUsage(storeCode),
    transactions: storage.getTransactions(50),
    health: { status: 'OPTIMAL', platform: 'Vercel Serverless' },
    whatsapp: { status: 'DISCONNECTED', mode: 'CLOUD_HOSTED' },
    supabase: {
      isOnline: supabaseSync.isOnline,
      isSimulatedOffline: false,
      pendingCount: 0,
      lastSync: new Date().toISOString()
    }
  });
});

app.get('/api/client/analytics/:storeCode?', (req, res) => {
  const storeCode = req.params.storeCode || req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01';
  const analytics = storage.getClientDetailedAnalytics(storeCode);
  res.json({ success: true, storeCode, analytics });
});

// Win-Back Radar Endpoints
app.get('/api/winback/directory', (req, res) => {
  const storeCode = req.query.store || null;
  res.json({ success: true, directory: storage.getCustomerDirectory(storeCode) });
});

app.get('/api/winback/analytics', (req, res) => {
  const storeCode = req.query.store || null;
  res.json({ success: true, analytics: storage.getWinBackAnalytics(storeCode) });
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
