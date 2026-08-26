import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';

import { storage } from './engine/storage.js';
import { WhatsAppDispatcher } from './engine/dispatcher.js';
import { SpoolerWatcher } from './engine/spooler-watcher.js';
import { Tcp9100ProxyServer } from './engine/tcp-proxy.js';
import { SystemResilienceEngine } from './engine/system-resilience.js';
import { LocalBaileysEngine } from './engine/local-baileys.js';
import { SupabaseSyncEngine } from './engine/supabase-sync.js';
import { DailyDigestEngine } from './engine/digest-engine.js';
import { WinBackEngine } from './engine/winback-engine.js';
import { AutoUpdaterEngine } from './engine/auto-updater.js';
import { parseReceiptItems, generateInvoicePdfBuffer } from './engine/invoice-generator.js';
import { PersonalizedImageGenerator } from './engine/personalized-image-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// CORS Middleware to allow requests from Virtual POS Lab (:3001) & external clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// Broadcast helper to all connected dashboard WebSockets
function broadcast(type, data) {
  const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Initialize Subsystems
const localBaileys = new LocalBaileysEngine(broadcast);
const supabaseSync = new SupabaseSyncEngine(broadcast);
const dispatcher = new WhatsAppDispatcher(broadcast, localBaileys, supabaseSync);
dispatcher.setEngines(localBaileys, supabaseSync);

const digestEngine = new DailyDigestEngine(broadcast, localBaileys);
const winBackEngine = new WinBackEngine(broadcast, localBaileys);
const autoUpdater = new AutoUpdaterEngine(broadcast, localBaileys);

const spoolerWatcher = new SpoolerWatcher(dispatcher, broadcast);
const tcpProxy = new Tcp9100ProxyServer(dispatcher, broadcast);
const resilience = new SystemResilienceEngine(broadcast);

// Start background listeners
spoolerWatcher.start();
tcpProxy.start(9100);
resilience.syncSystemClockOffset();
localBaileys.initialize();
digestEngine.startScheduler();
winBackEngine.startScheduler();
autoUpdater.startScheduler(12);

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected to live telemetry feed');
  ws.send(JSON.stringify({
    type: 'INITIAL_STATE',
    data: {
      config: storage.getConfig(),
      metrics: storage.getMetrics(),
      analytics: storage.getClientDetailedAnalytics(storage.getConfig().storeCode),
      quota: storage.getTodayQuotaUsage(),
      transactions: storage.getTransactions(50),
      health: resilience.getHealthSummary(),
      whatsapp: localBaileys.getStatus(),
      supabase: {
        isOnline: supabaseSync.isOnline,
        isSimulatedOffline: supabaseSync.isSimulatedOffline,
        pendingCount: supabaseSync.pendingSyncCount,
        lastSync: supabaseSync.lastSyncTimestamp
      }
    }
  }));
});

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

  // Determine redirect URL based on role
  const redirectUrl = user.role === 'ADMIN' ? '/admin.html' : '/index.html';

  res.json({
    success: true,
    user,
    redirectUrl
  });
});

// -------------------------------------------------------------
// Admin Portal CRUD & Per-Client Analytics Endpoints
// -------------------------------------------------------------
app.get('/api/admin/clients', (req, res) => {
  const stores = storage.getAllClientsWithAnalytics();
  res.json({ success: true, stores, metrics: storage.getMetrics() });
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

// Dynamic Personalized Flyer Preview Endpoint
app.post('/api/admin/flyer/preview', (req, res) => {
  try {
    const { storeCode, imageBase64, flyerUrl, customerName, overlayConfig } = req.body;
    let baseImageBuffer = null;

    if (imageBase64) {
      const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      baseImageBuffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(imageBase64, 'base64');
    } else if (flyerUrl) {
      const cleanPath = path.join(__dirname, '../public', flyerUrl.replace(/^\//, ''));
      if (fs.existsSync(cleanPath)) {
        baseImageBuffer = fs.readFileSync(cleanPath);
      }
    } else if (storeCode) {
      const candidates = [
        path.join(__dirname, `../public/uploads/flyers/${storeCode}.jpg`),
        path.join(__dirname, `../public/uploads/flyers/${storeCode}.png`),
        path.join(__dirname, '../public/assets/default-review-flyer.jpg')
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          baseImageBuffer = fs.readFileSync(c);
          break;
        }
      }
    }

    if (!baseImageBuffer) {
      const defaultPath = path.join(__dirname, '../public/assets/default-review-flyer.jpg');
      if (fs.existsSync(defaultPath)) {
        baseImageBuffer = fs.readFileSync(defaultPath);
      } else {
        return res.status(400).json({ error: 'No base image found for preview' });
      }
    }

    const testName = customerName || 'Rahul Sharma';
    const svgBuffer = PersonalizedImageGenerator.generatePersonalizedFlyer(baseImageBuffer, testName, overlayConfig);

    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svgBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate preview: ' + err.message });
  }
});

// Global Multi-Period SaaS Performance Summary
app.get('/api/admin/analytics/summary', (req, res) => {
  try {
    const allStores = storage.getAllStores();
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

    allStores.forEach(s => {
      const a = storage.getClientDetailedAnalytics(s.storeCode);
      totalTodaySent += a.today.sent;
      totalTodayBills += a.today.bills;
      totalTodaySales += a.today.sales;

      totalMonthSent += a.lastMonth.sent;
      totalMonthBills += a.lastMonth.bills;
      totalMonthSales += a.lastMonth.sales;

      totalAllTimeSent += a.allTime.sent;
      totalAllTimeBills += a.allTime.bills;
      totalAllTimeSales += a.allTime.sales;
    });

    res.json({
      success: true,
      totalStores: allStores.length,
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

app.post('/api/admin/clients', (req, res) => {
  try {
    const newStore = storage.createStore(req.body);
    supabaseSync.syncStoreToCloud(newStore);
    broadcast('STORES_UPDATED', { action: 'CREATED', store: newStore });
    res.json({ success: true, store: newStore });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/clients/:storeCode', (req, res) => {
  try {
    const updated = storage.updateStore(req.params.storeCode, req.body);
    supabaseSync.syncStoreToCloud(updated);
    broadcast('STORES_UPDATED', { action: 'UPDATED', store: updated });
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
    broadcast('STORES_UPDATED', { action: 'DELETED', storeCode: req.params.storeCode });
    res.json({ success: true, storeCode: req.params.storeCode });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Client Secret Key Binding Endpoint
// -------------------------------------------------------------
app.post('/api/client/bind-secret', (req, res) => {
  const { secretKey } = req.body;
  if (!secretKey) {
    return res.status(400).json({ error: 'Secret key is required' });
  }

  const result = storage.validateSecretKey(secretKey);
  if (!result.valid) {
    return res.status(400).json({ error: 'Invalid or revoked Secret Key!' });
  }

  broadcast('CONFIG_UPDATED', storage.getConfig());
  res.json({ success: true, store: result.store });
});

// -------------------------------------------------------------
// Core System State & Simulator Endpoints
// -------------------------------------------------------------
app.get('/api/state', (req, res) => {
  const storeCode = req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01';
  res.json({
    config: storage.getConfig(),
    metrics: storage.getMetrics(),
    analytics: storage.getClientDetailedAnalytics(storeCode),
    quota: storage.getTodayQuotaUsage(storeCode),
    transactions: storage.getTransactions(50),
    health: resilience.getHealthSummary(),
    whatsapp: localBaileys.getStatus(),
    supabase: {
      isOnline: supabaseSync.isOnline,
      isSimulatedOffline: supabaseSync.isSimulatedOffline,
      pendingCount: supabaseSync.pendingSyncCount,
      lastSync: supabaseSync.lastSyncTimestamp
    }
  });
});

app.get('/api/client/analytics/:storeCode?', (req, res) => {
  const storeCode = req.params.storeCode || req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01';
  const analytics = storage.getClientDetailedAnalytics(storeCode);
  res.json({ success: true, storeCode, analytics });
});

app.post('/api/config', (req, res) => {
  const updated = storage.updateConfig(req.body);
  supabaseSync.initClient();
  broadcast('CONFIG_UPDATED', updated);
  res.json({ success: true, config: updated });
});

app.get('/api/transactions', (req, res) => {
  res.json(storage.getTransactions(100));
});

app.post('/api/simulate-print', (req, res) => {
  const { rawText, customTimestamp, source, storeCode } = req.body;
  if (!rawText) {
    return res.status(400).json({ error: 'rawText is required' });
  }

  const tx = spoolerWatcher.injectPrintJob(rawText, { customTimestamp, source, storeCode });
  broadcast('METRICS_UPDATED', storage.getMetrics());
  res.json({ success: true, transaction: tx });
});

app.post('/api/simulate-usb-hop', (req, res) => {
  const device = resilience.simulateUsbPortHop();
  res.json({ success: true, device });
});

app.post('/api/sync-clock', async (req, res) => {
  const result = await resilience.syncSystemClockOffset();
  res.json(result);
});

// WhatsApp Multi-Device Endpoints
app.get('/api/whatsapp/status', (req, res) => {
  res.json(localBaileys.getStatus());
});

app.post('/api/whatsapp/pair-simulated', (req, res) => {
  localBaileys.simulateSuccessfulPairing();
  res.json({ success: true, status: 'CONNECTED' });
});

app.post('/api/whatsapp/request-pairing-code', async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber is required' });
  const result = await localBaileys.requestPairingCode(phoneNumber);
  res.json(result);
});

app.post('/api/whatsapp/reset-session', async (req, res) => {
  const result = await localBaileys.resetSession();
  res.json(result);
});

app.post('/api/whatsapp/reconnect', (req, res) => {
  localBaileys.initialize();
  res.json({ success: true });
});

// Internet Outage & Offline Resilience Toggle
app.post('/api/connectivity/toggle', (req, res) => {
  const { isOffline } = req.body;
  supabaseSync.setSimulatedOffline(!!isOffline);
  res.json({ success: true, isOnline: !isOffline, isSimulatedOffline: !!isOffline });
});

// -------------------------------------------------------------
// Smart Review Shield & Customer Feedback Endpoints
// -------------------------------------------------------------
app.get('/api/review-info/:billId', (req, res) => {
  const { billId } = req.params;
  const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  
  const store = storage.getStoreByCode(storeCode) || {
    storeCode: storeCode,
    storeName: storage.getConfig().storeName || "Sunshine Cafe & Bistro",
    googleReviewUrl: storage.getConfig().googleReviewUrl || "https://g.page/review"
  };

  const bill = storage.state.transactions.find(t => t.id === billId) || {
    id: billId,
    invoiceNo: 'INV-4920',
    totalAmount: '714.00',
    customerName: 'Valued Customer',
    customerPhone: '9876543210'
  };

  res.json({
    success: true,
    store: {
      storeCode: store.storeCode,
      storeName: store.storeName,
      googleReviewUrl: store.googleReviewUrl
    },
    bill: {
      id: bill.id,
      invoiceNo: bill.invoiceNo,
      totalAmount: bill.totalAmount,
      customerName: bill.customerName,
      customerPhone: bill.customerPhone
    }
  });
});

app.post('/api/feedback', async (req, res) => {
  try {
    const feedback = storage.addFeedback(req.body);
    broadcast('FEEDBACK_RECEIVED', feedback);
    broadcast('METRICS_UPDATED', storage.getMetrics());

    // If rating < 4, trigger IMMEDIATE Urgent WhatsApp Escalation to Store Owner
    if (feedback.action === 'PRIVATE_FEEDBACK') {
      const storeCode = (feedback.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
      const store = storage.getStoreByCode(storeCode) || {
        storeName: storage.getConfig().storeName,
        storePhone: storage.getConfig().storePhone
      };

      const alertMessage = `⚠️ *[URGENT PRIVATE FEEDBACK ALERT]* ⚠️
🏪 *Store:* ${store.storeName}
👤 *Customer:* ${feedback.customerName} (+91 ${feedback.customerPhone})
🧾 *Bill #:* ${feedback.invoiceNo}
⭐ *Rating:* ${feedback.rating}/5 Stars (Shielded from Google 🛡️)
🏷️ *Issue Category:* ${feedback.category}
📝 *Customer Note:* "${feedback.comment || 'No specific comment left'}"
📞 *Callback Requested:* ${feedback.requestCallback ? 'YES (Call ASAP)' : 'NO'}

👉 _ReviewEasy Shield: Customer has NOT posted to Google. Please reach out to make things right!_`;

      if (localBaileys && localBaileys.status === 'CONNECTED') {
        localBaileys.sendMessage(store.storePhone, alertMessage);
      }

      console.log(`[Review Shield] 🛡️ Shielded negative feedback (${feedback.rating}★) for ${store.storeName}. Dispatched manager alert to +91 ${store.storePhone}`);
    }

    res.json({ success: true, feedback });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/feedback', (req, res) => {
  const storeCode = req.query.storeCode || null;
  const feedbacks = storage.getFeedback(storeCode);
  res.json({ success: true, feedbacks });
});

app.put('/api/feedback/:id/status', (req, res) => {
  const { status, notes } = req.body;
  const updated = storage.updateFeedbackStatus(req.params.id, status || 'RESOLVED', notes);
  if (!updated) {
    return res.status(404).json({ error: 'Feedback record not found' });
  }
  broadcast('FEEDBACK_UPDATED', updated);
  res.json({ success: true, feedback: updated });
});

// -------------------------------------------------------------
// Digital E-Bill & PDF Receipt Public Endpoints
// -------------------------------------------------------------
app.get('/api/bill-info/:billId', (req, res) => {
  try {
    const billId = req.params.billId;
    const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const store = storage.getStoreByCode(storeCode) || {
      storeName: storage.getConfig().storeName || 'Sunshine Cafe & Bistro',
      storePhone: storage.getConfig().storePhone || '9840012345',
      storeGstin: storage.getConfig().storeGstin || '33AABCS1429B1ZB',
      googleReviewUrl: storage.getConfig().googleReviewUrl
    };

    let tx = storage.state.transactions.find(t => t.id === billId || t.invoiceNo === billId);
    if (!tx) {
      tx = {
        id: billId,
        invoiceNo: 'INV-DEMO-101',
        customerName: 'Valued Customer',
        customerPhone: '9840012345',
        totalAmount: '450.00',
        timestamp: new Date().toISOString(),
        rawText: `1x Truffle Mushroom Pasta ₹450.00\nTOTAL: ₹450.00`
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

app.get('/api/bill-pdf/:billId', (req, res) => {
  try {
    const billId = req.params.billId;
    const storeCode = (req.query.store || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const store = storage.getStoreByCode(storeCode) || {
      storeName: storage.getConfig().storeName || 'Sunshine Cafe & Bistro',
      storePhone: storage.getConfig().storePhone || '9840012345',
      storeGstin: storage.getConfig().storeGstin || '33AABCS1429B1ZB',
      googleReviewUrl: storage.getConfig().googleReviewUrl
    };

    let tx = storage.state.transactions.find(t => t.id === billId || t.invoiceNo === billId);
    if (!tx) {
      tx = {
        id: billId,
        invoiceNo: 'INV-DEMO-101',
        customerName: 'Valued Customer',
        customerPhone: '9840012345',
        totalAmount: '450.00',
        timestamp: new Date().toISOString(),
        rawText: `1x Truffle Mushroom Pasta ₹450.00\nTOTAL: ₹450.00`
      };
    }

    const pdfBuffer = generateInvoicePdfBuffer(store, tx);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice_${tx.invoiceNo || 'Receipt'}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Daily Closing Owner Digest Endpoints
// -------------------------------------------------------------
app.post('/api/digest/send', async (req, res) => {
  try {
    const storeCode = (req.body.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const result = await digestEngine.sendStoreDigest(storeCode, true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/digest/preview/:storeCode', (req, res) => {
  try {
    const preview = digestEngine.generateDigestText(req.params.storeCode);
    const data = storage.getDailyDigestData(req.params.storeCode);
    res.json({ success: true, preview, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Lapsed Customer Win-Back & Retention CRM Endpoints
// -------------------------------------------------------------
app.get('/api/winback/analytics', (req, res) => {
  const storeCode = req.query.storeCode || storage.getConfig().storeCode;
  const analytics = storage.getWinBackAnalytics(storeCode);
  res.json({ success: true, analytics });
});

app.get('/api/winback/customers', (req, res) => {
  const storeCode = req.query.storeCode || storage.getConfig().storeCode;
  const directory = storage.getCustomerDirectory(storeCode);
  res.json({ success: true, customers: directory });
});

app.get('/api/winback/template', (req, res) => {
  const storeCode = (req.query.storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
  const store = storage.getStoreByCode(storeCode) || storage.getConfig();
  const defaultTpl = `Hi {{name}}! ✨ We noticed it’s been a while since your last visit to {{storeName}}.\n\nWe’ve refreshed our seasonal specialties and ambiance, and our entire team would love to welcome you back! ☕🍰\n\nHope to see you again soon!\n📍 Directions & Location: {{googleMapUrl}}\n\n(Reply STOP to unsubscribe)`;
  
  res.json({
    success: true,
    template: store.customWinBackTemplate || defaultTpl,
    isCustom: !!store.customWinBackTemplate
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
    const code = storeCode || storage.getConfig().storeCode;

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
// Silent Auto-Updater & Self-Healing Protocol Endpoints
// -------------------------------------------------------------
app.get('/api/updater/status', (req, res) => {
  res.json({ success: true, status: autoUpdater.getStatus() });
});

app.post('/api/updater/check', async (req, res) => {
  try {
    const result = await autoUpdater.checkForUpdates();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/updater/apply', async (req, res) => {
  try {
    const result = await autoUpdater.applyUpdateSilently();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clear-history', (req, res) => {
  storage.state.transactions = [];
  storage.state.queue = [];
  storage.state.privateFeedback = [];
  storage.state.winBackDispatches = [];
  storage.save();
  broadcast('STATE_CLEARED', {});
  res.json({ success: true });
});

// Start Server
server.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🚀 REVIEWEASY HYBRID EDGE-CLOUD & AUTH SYSTEM READY`);
  console.log(`🔐 Unified Login Portal: http://localhost:${PORT}/login.html`);
  console.log(`👑 SaaS Admin Portal   : http://localhost:${PORT}/admin.html`);
  console.log(`🏪 Client Dashboard    : http://localhost:${PORT}/index.html`);
  console.log(`🖨️  Raw TCP Interceptor : 0.0.0.0:9100`);
  console.log(`========================================================\n`);
});
