import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'revieweasy_store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {}
}

class ResilientStorage {
  constructor() {
    this.dbFile = DB_FILE;
    this.state = {
      // Default Multi-Tenant Store & Superadmin Users
      users: [
        {
          id: "USR_ADMIN_01",
          email: "admin@revieweasy.com",
          password: "admin123", // In production: bcrypt hash
          name: "SaaS Administrator",
          role: "ADMIN"
        },
        {
          id: "USR_CLIENT_01",
          email: "client@sunshine.com",
          password: "client123",
          name: "Rahul Sharma (Sunshine Cafe)",
          role: "CLIENT",
          storeCode: "STORE_DEMO_01"
        },
        {
          id: "USR_CLIENT_02",
          email: "client@bluetokai.com",
          password: "client123",
          name: "Amit Patel (Blue Tokai)",
          role: "CLIENT",
          storeCode: "STORE_BLR_002"
        }
      ],
      // Multi-Tenant Client Stores
      clientStores: [
        {
          id: "STORE_DEMO_01",
          storeCode: "STORE_DEMO_01",
          storeName: "Sunshine Cafe & Bistro",
          storePhone: "9840012345",
          storeGstin: "33AABCS1429B1ZB",
          googleReviewUrl: "https://g.page/r/sunshine-cafe/review",
          secretKey: "SEC_SUNSHINE_4920",
          status: "ACTIVE",
          plan: "PRO_UNLIMITED",
          enableDigitalReceipts: true,
          createdAt: new Date().toISOString()
        },
        {
          id: "STORE_BLR_002",
          storeCode: "STORE_BLR_002",
          storeName: "Blue Tokai Coffee Roasters",
          storePhone: "9812345678",
          storeGstin: "29AABCB8819L1Z2",
          googleReviewUrl: "https://g.page/r/bluetokai/review",
          secretKey: "SEC_BLUETOKAI_8819",
          status: "ACTIVE",
          plan: "ENTERPRISE",
          enableDigitalReceipts: true,
          createdAt: new Date().toISOString()
        }
      ],
      config: {
        storeName: "Sunshine Cafe & Bistro",
        storePhone: "9840012345",
        storeGstin: "33AABCS1429B1ZB",
        storeCode: "STORE_DEMO_01",
        googleReviewUrl: "https://g.page/r/sunshine-cafe/review",
        pacingDelaySeconds: 15,
        dailyDeliveryLimit: 70,
        enableDaypartingQuota: true,
        morningSlotLimit: 15,
        afternoonSlotLimit: 20,
        eveningSlotLimit: 35,
        morningSlotStart: "09:30",
        morningSlotEnd: "12:30",
        afternoonSlotStart: "12:30",
        afternoonSlotEnd: "17:00",
        eveningSlotStart: "17:00",
        eveningSlotEnd: "21:00",
        quietHoursStart: "22:00",
        quietHoursEnd: "10:00",
        targetPrinterIp: "127.0.0.1",
        targetPrinterPort: 9100,
        monitoredPrinterName: "POS-80 Thermal Printer",
        isLiveWhatsAppEnabled: true,
        smartShieldEnabled: true,
        dailyDigestEnabled: true,
        dailyDigestTime: "21:00",
        appBaseUrl: "http://localhost:3000",
        winBackEnabled: true,
        winBackMinDays: 30,
        winBackMaxDays: 60,
        enableDigitalReceipts: true,
        enableImageMessage: true,
        flyerImageUrl: "/assets/default-review-flyer.jpg",
        supabaseUrl: "https://fzjjztbobwtuywohwmfe.supabase.co",
        supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6amp6dGJvYnd0dXl3b2h3bWZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3ODUxNDcsImV4cCI6MjEwMjM2MTE0N30.XVIo0uTuFd7p66DaufjLXu1PqGJuLVkEEfY5a32kQ28"
      },
      idempotencyKeys: {}, // Hash -> { invoiceNo, timestamp, phone }
      transactions: [],
      queue: [],           // Delayed or quiet-hours queued items
      privateFeedback: [], // Shielded 1-3 star feedback and 4-5 star redirect logs
      winBackDispatches: [], // Lapsed customer win-back campaign logs
      lastDigestDates: {}, // storeCode -> 'YYYY-MM-DD'
      metrics: {
        totalPrintsIntercepted: 0,
        validInvoicesProcessed: 0,
        kotsBlocked: 0,
        dummyNumbersRejected: 0,
        duplicatesSuppressed: 0,
        storeOwnerNumbersFiltered: 0,
        anonymousWalkins: 0,
        quietHoursRescheduled: 0,
        whatsAppDelivered: 0,
        tcp9100Intercepted: 0,
        rasterBitmapsParsed: 0,
        offlineQueuedBills: 0,
        negativeReviewsShielded: 0,
        positiveReviewsRedirected: 0,
        ownerDigestsSent: 0,
        winBacksSent: 0,
        customersRecovered: 0,
        revenueRecovered: 0
      }
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf8');
        const data = JSON.parse(raw);
        this.state = {
          ...this.state,
          ...data,
          users: data.users && data.users.length > 0 ? data.users : this.state.users,
          clientStores: data.clientStores && data.clientStores.length > 0 ? data.clientStores : this.state.clientStores,
          privateFeedback: data.privateFeedback || [],
          winBackDispatches: data.winBackDispatches || [],
          lastDigestDates: data.lastDigestDates || {},
          config: { ...this.state.config, ...(data.config || {}) },
          metrics: { ...this.state.metrics, ...(data.metrics || {}) }
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[Storage] Error loading state, recreating clean store:', err.message);
      this.save();
    }
  }

  // Atomic write to emulate SQLite WAL durability (Category C5)
  save() {
    try {
      const tempFile = `${this.dbFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tempFile, this.dbFile);
    } catch (err) {
      console.error('[Storage] Atomic write failed:', err.message);
    }
  }

  // -------------------------------------------------------------
  // Authentication & RBAC Methods
  // -------------------------------------------------------------
  authenticateUser(email, password) {
    const user = this.state.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (!user) return null;

    let store = null;
    if (user.role === 'CLIENT' && user.storeCode) {
      store = this.getStoreByCode(user.storeCode);
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      storeCode: user.storeCode || null,
      store: store
    };
  }

  // -------------------------------------------------------------
  // Client Stores Management (Admin CRUD)
  // -------------------------------------------------------------
  getAllStores() {
    return this.state.clientStores;
  }

  getStoreByCode(storeCode) {
    return this.state.clientStores.find(s => s.storeCode.toUpperCase() === storeCode.toUpperCase()) || null;
  }

  createStore(storeData) {
    const cleanCode = (storeData.storeCode || `STORE_${Date.now().toString().slice(-4)}`).toUpperCase();
    
    // Check if storeCode already exists
    if (this.getStoreByCode(cleanCode)) {
      throw new Error(`Store code ${cleanCode} already exists!`);
    }

    const secretKey = storeData.secretKey || `SEC_${cleanCode.replace(/\W/g, '')}_${Math.floor(1000 + Math.random() * 9000)}`;

    const newStore = {
      id: cleanCode,
      storeCode: cleanCode,
      storeName: storeData.storeName || "New Merchant Store",
      storePhone: storeData.storePhone || "9840012345",
      storeGstin: storeData.storeGstin || "",
      googleReviewUrl: storeData.googleReviewUrl || "https://g.page/review",
      secretKey: secretKey,
      status: storeData.status || "ACTIVE",
      plan: storeData.plan || "PRO_UNLIMITED",
      businessCategory: storeData.businessCategory || "RESTAURANT_CAFE",
      customWhatsAppTemplate: storeData.customWhatsAppTemplate || null,
      enableDigitalReceipts: storeData.enableDigitalReceipts !== undefined ? Boolean(storeData.enableDigitalReceipts) : true,
      enableImageMessage: storeData.enableImageMessage !== undefined ? Boolean(storeData.enableImageMessage) : true,
      flyerImageUrl: storeData.flyerImageUrl || "/assets/default-review-flyer.jpg",
      flyerOverlayConfig: storeData.flyerOverlayConfig || {
        enabled: true,
        template: "Specially for {{name}}! ✨",
        posX: 50,
        posY: 18,
        fontSize: 28,
        color: "#FFFFFF",
        badgeBg: "rgba(0, 0, 0, 0.70)",
        fontFamily: "Plus Jakarta Sans, sans-serif"
      },
      createdAt: new Date().toISOString()
    };

    this.state.clientStores.push(newStore);

    // Create client user account if email provided
    if (storeData.clientEmail) {
      this.state.users.push({
        id: `USR_${cleanCode}`,
        email: storeData.clientEmail,
        password: storeData.clientPassword || "client123",
        name: storeData.clientName || storeData.storeName,
        role: "CLIENT",
        storeCode: cleanCode
      });
    }

    this.save();
    return newStore;
  }

  updateStore(storeCode, storeData) {
    const store = this.getStoreByCode(storeCode);
    if (!store) {
      throw new Error(`Store with code ${storeCode} not found`);
    }

    Object.assign(store, {
      storeName: storeData.storeName !== undefined ? storeData.storeName : store.storeName,
      storePhone: storeData.storePhone !== undefined ? storeData.storePhone : store.storePhone,
      storeGstin: storeData.storeGstin !== undefined ? storeData.storeGstin : store.storeGstin,
      googleReviewUrl: storeData.googleReviewUrl !== undefined ? storeData.googleReviewUrl : store.googleReviewUrl,
      status: storeData.status !== undefined ? storeData.status : store.status,
      plan: storeData.plan !== undefined ? storeData.plan : store.plan,
      businessCategory: storeData.businessCategory !== undefined ? storeData.businessCategory : (store.businessCategory || "RESTAURANT_CAFE"),
      customWhatsAppTemplate: storeData.customWhatsAppTemplate !== undefined ? storeData.customWhatsAppTemplate : store.customWhatsAppTemplate,
      enableDigitalReceipts: storeData.enableDigitalReceipts !== undefined ? Boolean(storeData.enableDigitalReceipts) : store.enableDigitalReceipts,
      enableImageMessage: storeData.enableImageMessage !== undefined ? Boolean(storeData.enableImageMessage) : (store.enableImageMessage !== undefined ? store.enableImageMessage : true),
      flyerImageUrl: storeData.flyerImageUrl !== undefined ? storeData.flyerImageUrl : (store.flyerImageUrl || "/assets/default-review-flyer.jpg"),
      flyerOverlayConfig: storeData.flyerOverlayConfig !== undefined ? storeData.flyerOverlayConfig : (store.flyerOverlayConfig || {
        enabled: true,
        template: "Specially for {{name}}! ✨",
        posX: 50,
        posY: 18,
        fontSize: 28,
        color: "#FFFFFF",
        badgeBg: "rgba(0, 0, 0, 0.70)"
      }),
      updatedAt: new Date().toISOString()
    });

    // If currently active store config in agent matches, update live config too
    if (this.state.config.storeCode === storeCode) {
      Object.assign(this.state.config, {
        storeName: store.storeName,
        storePhone: store.storePhone,
        storeGstin: store.storeGstin,
        googleReviewUrl: store.googleReviewUrl,
        enableDigitalReceipts: store.enableDigitalReceipts,
        enableImageMessage: store.enableImageMessage,
        flyerImageUrl: store.flyerImageUrl,
        flyerOverlayConfig: store.flyerOverlayConfig
      });
    }

    this.save();
    return store;
  }

  deleteStore(storeCode) {
    const initialLen = this.state.clientStores.length;
    this.state.clientStores = this.state.clientStores.filter(s => s.storeCode.toUpperCase() !== storeCode.toUpperCase());
    
    // Also remove associated client users
    this.state.users = this.state.users.filter(u => u.storeCode !== storeCode);

    this.save();
    return this.state.clientStores.length < initialLen;
  }

  validateSecretKey(secretKey) {
    const store = this.state.clientStores.find(s => s.secretKey === secretKey.trim());
    if (store) {
      // Bind this store as the active store on this PC agent
      this.state.config.storeCode = store.storeCode;
      this.state.config.storeName = store.storeName;
      this.state.config.storePhone = store.storePhone;
      this.state.config.storeGstin = store.storeGstin;
      this.state.config.googleReviewUrl = store.googleReviewUrl;
      this.state.config.secretKey = store.secretKey;
      if (store.flyerImageUrl) this.state.config.flyerImageUrl = store.flyerImageUrl;
      if (store.flyerOverlayConfig) this.state.config.flyerOverlayConfig = store.flyerOverlayConfig;
      this.save();
      return { valid: true, store };
    }
    return { valid: false, reason: "INVALID_SECRET_KEY" };
  }

  // -------------------------------------------------------------
  // Config & Core Metrics Methods
  // -------------------------------------------------------------
  getConfig() {
    return this.state.config;
  }

  updateConfig(newConfig) {
    this.state.config = { ...this.state.config, ...newConfig };
    this.save();
    return this.state.config;
  }

  getMetrics() {
    return this.state.metrics;
  }

  incrementMetric(key, amount = 1) {
    if (this.state.metrics[key] !== undefined) {
      this.state.metrics[key] += amount;
      this.save();
    }
  }

  // Category B4: 24-hour SHA-256 Idempotency Check
  isDuplicate(storeId, invoiceNo, phone, total) {
    const rawKey = `${storeId}_${invoiceNo}_${phone}_${total}`;
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    const existing = this.state.idempotencyKeys[hash];
    if (existing && (now - existing.timestamp) < twentyFourHours) {
      return true;
    }

    this.state.idempotencyKeys[hash] = {
      invoiceNo,
      phone,
      total,
      timestamp: now
    };

    for (const [k, v] of Object.entries(this.state.idempotencyKeys)) {
      if (now - v.timestamp > twentyFourHours) {
        delete this.state.idempotencyKeys[k];
      }
    }

    this.save();
    return false;
  }

  addTransaction(tx) {
    const record = {
      id: tx.id || `TX_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      storeCode: tx.storeCode || this.state.config.storeCode || 'STORE_DEMO_01',
      timestamp: tx.timestamp || new Date().toISOString(),
      ...tx
    };

    // Closed-Loop Win-Back Revenue Attribution Check
    if (['VALID_INVOICE', 'SCHEDULED_DISPATCH', 'DELIVERED'].includes(record.status) && record.customerPhone && record.customerPhone !== 'N/A') {
      const cleanPhone = record.customerPhone.replace(/\D/g, '').slice(-10);
      const now = Date.now();
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

      const activeDispatch = this.state.winBackDispatches.find(w => {
        const wPhone = (w.customerPhone || '').replace(/\D/g, '').slice(-10);
        const isStoreMatch = (w.storeCode || '').toUpperCase() === (record.storeCode || '').toUpperCase();
        const dispatchTime = new Date(w.dispatchedAt).getTime();
        return isStoreMatch && wPhone === cleanPhone && w.status === 'SENT' && (now - dispatchTime) <= fourteenDaysMs;
      });

      if (activeDispatch) {
        activeDispatch.status = 'RECOVERED';
        activeDispatch.recoveredBillId = record.id;
        activeDispatch.recoveredInvoiceNo = record.invoiceNo;
        activeDispatch.recoveredAmount = parseFloat(record.totalAmount) || 0;
        activeDispatch.recoveredAt = new Date().toISOString();

        record.isWinBackRecovered = true;
        this.incrementMetric('customersRecovered');
        this.incrementMetric('revenueRecovered', parseFloat(record.totalAmount) || 0);

        console.log(`[Win-Back Engine] 💰 RECOVERED SALE ATTRIBUTED! Customer ${activeDispatch.customerName} (+91 ${cleanPhone}) returned and spent ₹${record.totalAmount} (Bill #${record.invoiceNo})!`);
      }
    }

    this.state.transactions.unshift(record);
    if (this.state.transactions.length > 500) {
      this.state.transactions.pop();
    }
    this.save();
    return record;
  }

  // -------------------------------------------------------------
  // Per-Client Time-Windowed Analytics Engine
  // (Today, Last 7 Days, Last 30 Days, All-Time)
  // -------------------------------------------------------------
  getClientDetailedAnalytics(storeCode) {
    const code = (storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase();
    const now = new Date();
    
    // Start of Today (00:00:00.000 Local Time)
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = now.getTime() - (30 * 24 * 60 * 60 * 1000);

    // Filter transactions for this store
    const storeTxs = this.state.transactions.filter(t => {
      const txCode = (t.storeCode || 'STORE_DEMO_01').toUpperCase();
      return txCode === code;
    });

    const storeFeedbacks = this.getFeedback(code);

    const aggregate = (txList, minTimestamp = 0) => {
      let sentCount = 0;
      let totalBills = 0;
      let totalSales = 0;
      let kotsBlocked = 0;
      let dummyFiltered = 0;

      for (const t of txList) {
        if (!['IGNORED_KOT', 'DUPLICATE_SUPPRESSED', 'ANONYMOUS_WALKIN'].includes(t.status)) {
          totalBills++;
          totalSales += parseFloat(t.totalAmount) || 0;
        }
        if (t.status === 'DELIVERED') {
          sentCount++;
        }
        if (t.status === 'IGNORED_KOT') {
          kotsBlocked++;
        }
        if (t.status === 'ANONYMOUS_WALKIN' || t.reason?.includes('DUMMY')) {
          dummyFiltered++;
        }
      }

      // Filter feedbacks for this specific time window
      const periodFeedbacks = storeFeedbacks.filter(f => new Date(f.timestamp).getTime() >= minTimestamp);
      const positiveRedirects = periodFeedbacks.filter(f => f.action === 'GOOGLE_REDIRECT').length;
      const shieldedGrievances = periodFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK').length;

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

    const todayTxs = storeTxs.filter(t => new Date(t.timestamp).getTime() >= startOfToday);
    const weekTxs = storeTxs.filter(t => new Date(t.timestamp).getTime() >= sevenDaysAgo);
    const monthTxs = storeTxs.filter(t => new Date(t.timestamp).getTime() >= thirtyDaysAgo);

    const shieldedCount = storeFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK').length;
    const redirectedCount = storeFeedbacks.filter(f => f.action === 'GOOGLE_REDIRECT').length;
    const totalRatingsCount = storeFeedbacks.length;
    const avgRating = totalRatingsCount > 0 
      ? (storeFeedbacks.reduce((acc, f) => acc + (Number(f.rating) || 0), 0) / totalRatingsCount).toFixed(1)
      : '5.0';

    return {
      storeCode: code,
      today: aggregate(todayTxs, startOfToday),
      lastWeek: aggregate(weekTxs, sevenDaysAgo),
      lastMonth: aggregate(monthTxs, thirtyDaysAgo),
      allTime: aggregate(storeTxs, 0),
      shield: {
        totalFeedback: totalRatingsCount,
        shieldedNegative: shieldedCount,
        redirectedPositive: redirectedCount,
        averageRating: Number(avgRating),
        openComplaints: storeFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK' && f.status === 'OPEN').length
      },
      recentTransactions: storeTxs.slice(0, 50)
    };
  }

  getAllClientsWithAnalytics() {
    return this.state.clientStores.map(store => {
      const analytics = this.getClientDetailedAnalytics(store.storeCode);
      return {
        ...store,
        analytics: {
          todaySent: analytics.today.sent,
          todayBills: analytics.today.bills,
          lastWeekSent: analytics.lastWeek.sent,
          lastWeekBills: analytics.lastWeek.bills,
          lastMonthSent: analytics.lastMonth.sent,
          lastMonthBills: analytics.lastMonth.bills,
          allTimeSent: analytics.allTime.sent,
          allTimeBills: analytics.allTime.bills,
          allTimeSales: analytics.allTime.sales,
          reachRate: analytics.allTime.reachRate
        }
      };
    });
  }

  // -------------------------------------------------------------
  // Quota Limiter & Dayparting Slot Engine
  // -------------------------------------------------------------
  getTodayQuotaUsage(storeCode = null) {
    const config = this.state.config;
    const code = (storeCode || config.storeCode || 'STORE_DEMO_01').toUpperCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const [mStartH, mStartM] = (config.morningSlotStart || "09:30").split(':').map(Number);
    const [mEndH, mEndM] = (config.morningSlotEnd || "12:30").split(':').map(Number);
    const [aStartH, aStartM] = (config.afternoonSlotStart || "12:30").split(':').map(Number);
    const [aEndH, aEndM] = (config.afternoonSlotEnd || "17:00").split(':').map(Number);
    const [eStartH, eStartM] = (config.eveningSlotStart || "17:00").split(':').map(Number);
    const [eEndH, eEndM] = (config.eveningSlotEnd || "21:00").split(':').map(Number);

    const mStartMin = mStartH * 60 + mStartM; // 570
    const mEndMin = mEndH * 60 + mEndM;       // 750
    const aStartMin = aStartH * 60 + aStartM; // 750
    const aEndMin = aEndH * 60 + aEndM;       // 1020
    const eStartMin = eStartH * 60 + eStartM; // 1020
    const eEndMin = eEndH * 60 + eEndM;       // 1260

    const currentMin = now.getHours() * 60 + now.getMinutes();

    let currentSlot = 'QUIET_HOURS';
    if (currentMin >= mStartMin && currentMin < mEndMin) {
      currentSlot = 'MORNING';
    } else if (currentMin >= aStartMin && currentMin < aEndMin) {
      currentSlot = 'AFTERNOON';
    } else if (currentMin >= eStartMin && currentMin < eEndMin) {
      currentSlot = 'EVENING';
    }

    // Filter delivered today
    let dailyUsed = 0;
    let morningUsed = 0;
    let afternoonUsed = 0;
    let eveningUsed = 0;

    for (const t of this.state.transactions) {
      const txCode = (t.storeCode || 'STORE_DEMO_01').toUpperCase();
      if (txCode !== code) continue;
      
      const tTime = new Date(t.timestamp);
      if (tTime.getTime() >= startOfToday && t.status === 'DELIVERED') {
        dailyUsed++;
        const txMins = tTime.getHours() * 60 + tTime.getMinutes();
        if (txMins >= mStartMin && txMins < mEndMin) {
          morningUsed++;
        } else if (txMins >= aStartMin && txMins < aEndMin) {
          afternoonUsed++;
        } else if (txMins >= eStartMin && txMins < eEndMin) {
          eveningUsed++;
        }
      }
    }

    const dailyMax = Number(config.dailyLimitMax) || 70;
    const morningMax = Number(config.morningQuotaMax) || 15;
    const afternoonMax = Number(config.afternoonQuotaMax) || 20;
    const eveningMax = Number(config.eveningQuotaMax) || 35;

    const isDailyCapped = dailyUsed >= dailyMax;
    let isSlotCapped = false;
    if (currentSlot === 'MORNING') isSlotCapped = morningUsed >= morningMax;
    if (currentSlot === 'AFTERNOON') isSlotCapped = afternoonUsed >= afternoonMax;
    if (currentSlot === 'EVENING') isSlotCapped = eveningUsed >= eveningMax;

    return {
      storeCode: code,
      dailyUsed,
      dailyMax,
      dailyRemaining: Math.max(0, dailyMax - dailyUsed),
      isDailyCapped,
      currentSlot,
      isSlotCapped,
      slots: {
        morning: {
          name: 'Morning (09:30 - 12:30)',
          used: morningUsed,
          max: morningMax,
          remaining: Math.max(0, morningMax - morningUsed)
        },
        afternoon: {
          name: 'Afternoon (12:30 - 17:00)',
          used: afternoonUsed,
          max: afternoonMax,
          remaining: Math.max(0, afternoonMax - afternoonUsed)
        },
        evening: {
          name: 'Evening (17:00 - 21:00)',
          used: eveningUsed,
          max: eveningMax,
          remaining: Math.max(0, eveningMax - eveningUsed)
        }
      }
    };
  }

  updateTransactionStatus(id, status, details = {}) {
    const tx = this.state.transactions.find(t => t.id === id);
    if (tx) {
      tx.status = status;
      tx.statusDetails = { ...(tx.statusDetails || {}), ...details, updatedAt: new Date().toISOString() };
      this.save();
    }
    return tx;
  }

  getTransactions(limit = 50) {
    return this.state.transactions.slice(0, limit);
  }

  enqueueJob(job) {
    this.state.queue.push(job);
    this.save();
  }

  getQueue() {
    return this.state.queue;
  }

  removeQueueJob(jobId) {
    this.state.queue = this.state.queue.filter(j => j.id !== jobId);
    this.save();
  }

  // -------------------------------------------------------------
  // Smart Review Shield & Private Feedback Methods
  // -------------------------------------------------------------
  sanitize(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  addFeedback(feedback) {
    const record = {
      id: feedback.id || `FB_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
      storeCode: (feedback.storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase(),
      billId: feedback.billId || 'N/A',
      invoiceNo: this.sanitize(feedback.invoiceNo || 'N/A'),
      customerName: this.sanitize(feedback.customerName || 'Valued Customer'),
      customerPhone: feedback.customerPhone || 'N/A',
      rating: Number(feedback.rating) || 5,
      action: Number(feedback.rating) >= 4 ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK',
      category: this.sanitize(feedback.category || 'General Experience'),
      comment: this.sanitize(feedback.comment || ''),
      requestCallback: !!feedback.requestCallback,
      status: Number(feedback.rating) < 4 ? 'OPEN' : 'RESOLVED',
      resolutionNotes: '',
      timestamp: feedback.timestamp || new Date().toISOString()
    };

    this.state.privateFeedback.unshift(record);
    if (this.state.privateFeedback.length > 500) {
      this.state.privateFeedback.pop();
    }

    if (record.action === 'PRIVATE_FEEDBACK') {
      this.incrementMetric('negativeReviewsShielded');
    } else {
      this.incrementMetric('positiveReviewsRedirected');
    }

    this.save();
    return record;
  }

  getFeedback(storeCode = null) {
    if (!storeCode) return this.state.privateFeedback;
    const code = storeCode.toUpperCase();
    return this.state.privateFeedback.filter(f => (f.storeCode || '').toUpperCase() === code);
  }

  updateFeedbackStatus(feedbackId, status, notes = '') {
    const fb = this.state.privateFeedback.find(f => f.id === feedbackId);
    if (fb) {
      fb.status = status;
      if (notes) fb.resolutionNotes = notes;
      fb.updatedAt = new Date().toISOString();
      this.save();
    }
    return fb;
  }

  // -------------------------------------------------------------
  // Daily Closing Digest Data Aggregator
  // -------------------------------------------------------------
  getDailyDigestData(storeCode = null) {
    const code = (storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase();
    const store = this.getStoreByCode(code) || {
      storeCode: code,
      storeName: this.state.config.storeName || "Sunshine Cafe & Bistro",
      storePhone: this.state.config.storePhone || "9840012345"
    };

    const analytics = this.getClientDetailedAnalytics(code);
    const storeFeedbacks = this.getFeedback(code);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const todayFeedbacks = storeFeedbacks.filter(f => new Date(f.timestamp).getTime() >= startOfToday);
    const todayShielded = todayFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK');
    const todayRedirected = todayFeedbacks.filter(f => f.action === 'GOOGLE_REDIRECT');
    const avgTodayRating = todayFeedbacks.length > 0
      ? (todayFeedbacks.reduce((acc, f) => acc + (Number(f.rating) || 0), 0) / todayFeedbacks.length).toFixed(1)
      : '5.0';

    return {
      storeCode: code,
      storeName: store.storeName,
      storePhone: store.storePhone,
      dateFormatted: now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      totalBills: analytics.today.bills,
      totalSales: analytics.today.sales,
      avgTicket: analytics.today.bills > 0 ? (analytics.today.sales / analytics.today.bills).toFixed(2) : '0.00',
      whatsappDelivered: analytics.today.sent,
      reachRate: analytics.today.reachRate,
      kotsBlocked: analytics.today.kotsBlocked,
      dummyFiltered: analytics.today.dummyFiltered,
      shieldedCount: todayShielded.length,
      redirectedCount: todayRedirected.length,
      avgRating: avgTodayRating,
      openComplaints: todayShielded.filter(f => f.status === 'OPEN'),
      allFeedbacksToday: todayFeedbacks
    };
  }

  setLastDigestDate(storeCode, dateStr) {
    this.state.lastDigestDates[storeCode.toUpperCase()] = dateStr;
    this.save();
  }

  getLastDigestDate(storeCode) {
    return this.state.lastDigestDates[storeCode.toUpperCase()] || null;
  }

  // -------------------------------------------------------------
  // Lapsed Customer RFM Segmentation & Win-Back CRM Methods
  // -------------------------------------------------------------
  getCustomerDirectory(storeCode = null) {
    const code = (storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase();
    const now = Date.now();
    const customerMap = {};

    for (const tx of this.state.transactions) {
      const txCode = (tx.storeCode || 'STORE_DEMO_01').toUpperCase();
      if (txCode !== code) continue;

      if (['IGNORED_KOT', 'DUPLICATE_SUPPRESSED', 'ANONYMOUS_WALKIN', 'DUMMY_PHONE_REJECTED', 'STORE_OWNER_FILTERED'].includes(tx.status)) continue;
      if (!tx.customerPhone || tx.customerPhone === 'N/A') continue;

      const cleanPhone = tx.customerPhone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length !== 10) continue;

      const txTime = new Date(tx.timestamp).getTime();
      const amount = parseFloat(tx.totalAmount) || 0;

      if (!customerMap[cleanPhone]) {
        customerMap[cleanPhone] = {
          phone: cleanPhone,
          formattedPhone: `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}`,
          name: tx.customerName && tx.customerName !== 'Valued Customer' ? tx.customerName : 'Valued Customer',
          totalVisits: 0,
          totalSpend: 0,
          firstVisit: tx.timestamp,
          lastVisit: tx.timestamp,
          lastVisitTime: txTime
        };
      }

      customerMap[cleanPhone].totalVisits++;
      customerMap[cleanPhone].totalSpend += amount;

      if (tx.customerName && tx.customerName !== 'Valued Customer' && customerMap[cleanPhone].name === 'Valued Customer') {
        customerMap[cleanPhone].name = tx.customerName;
      }

      if (txTime > customerMap[cleanPhone].lastVisitTime) {
        customerMap[cleanPhone].lastVisit = tx.timestamp;
        customerMap[cleanPhone].lastVisitTime = txTime;
      }
      if (new Date(tx.timestamp).getTime() < new Date(customerMap[cleanPhone].firstVisit).getTime()) {
        customerMap[cleanPhone].firstVisit = tx.timestamp;
      }
    }

    const directory = Object.values(customerMap).map(c => {
      const daysSince = Math.floor((now - c.lastVisitTime) / (1000 * 60 * 60 * 24));
      
      let segment = 'ACTIVE';
      if (daysSince >= 30 && daysSince <= 60) {
        segment = 'LAPSED'; // Target Zone (30–60 Days)
      } else if (daysSince > 60) {
        segment = 'CHURNED'; // 60+ Days
      }

      // Check win-back dispatch status
      const dispatches = this.state.winBackDispatches.filter(w => {
        const wPhone = (w.customerPhone || '').replace(/\D/g, '').slice(-10);
        return (w.storeCode || '').toUpperCase() === code && wPhone === c.phone;
      });

      const latestDispatch = dispatches[0] || null;

      let winBackStatus = 'ELIGIBLE';
      if (segment !== 'LAPSED') {
        winBackStatus = 'NOT_ELIGIBLE';
      } else if (latestDispatch) {
        if (latestDispatch.status === 'RECOVERED') {
          winBackStatus = 'RECOVERED';
        } else {
          const daysSinceDispatch = Math.floor((now - new Date(latestDispatch.dispatchedAt).getTime()) / (1000 * 60 * 60 * 24));
          winBackStatus = daysSinceDispatch < 60 ? 'DISPATCHED_RECENTLY' : 'ELIGIBLE';
        }
      }

      return {
        ...c,
        totalSpend: Math.round(c.totalSpend * 100) / 100,
        daysSinceLastVisit: daysSince,
        segment,
        winBackStatus,
        lastDispatch: latestDispatch
      };
    });

    // Sort by inactivity days descending
    return directory.sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);
  }

  getLapsedCustomers(storeCode = null) {
    const directory = this.getCustomerDirectory(storeCode);
    return directory.filter(c => c.segment === 'LAPSED');
  }

  recordWinBackDispatch(dispatchData) {
    const record = {
      id: dispatchData.id || `WB_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
      storeCode: (dispatchData.storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase(),
      customerPhone: dispatchData.customerPhone,
      customerName: dispatchData.customerName || 'Valued Customer',
      lastVisitDate: dispatchData.lastVisitDate || new Date().toISOString(),
      daysInactive: dispatchData.daysInactive || 30,
      dispatchedAt: new Date().toISOString(),
      status: 'SENT',
      recoveredBillId: null,
      recoveredInvoiceNo: null,
      recoveredAmount: 0,
      recoveredAt: null,
      messagePreview: dispatchData.messagePreview || ''
    };

    this.state.winBackDispatches.unshift(record);
    if (this.state.winBackDispatches.length > 500) {
      this.state.winBackDispatches.pop();
    }

    this.incrementMetric('winBacksSent');
    this.save();
    return record;
  }

  getWinBackAnalytics(storeCode = null) {
    const code = (storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase();
    const directory = this.getCustomerDirectory(code);
    
    const lapsedList = directory.filter(c => c.segment === 'LAPSED');
    const churnedList = directory.filter(c => c.segment === 'CHURNED');
    const activeList = directory.filter(c => c.segment === 'ACTIVE');

    const storeDispatches = this.state.winBackDispatches.filter(w => (w.storeCode || '').toUpperCase() === code);
    const recoveredList = storeDispatches.filter(w => w.status === 'RECOVERED');
    const totalRecoveredRevenue = recoveredList.reduce((acc, r) => acc + (Number(r.recoveredAmount) || 0), 0);

    const sentCount = storeDispatches.length;
    const recoveryRate = sentCount > 0 ? Math.round((recoveredList.length / sentCount) * 100) : 0;

    return {
      storeCode: code,
      totalCustomers: directory.length,
      activeCount: activeList.length,
      lapsedCount: lapsedList.length,
      churnedCount: churnedList.length,
      winBacksSent: sentCount,
      customersRecovered: recoveredList.length,
      recoveryRate,
      totalRecoveredRevenue: Math.round(totalRecoveredRevenue * 100) / 100,
      lapsedCustomers: lapsedList,
      recentRecoveries: recoveredList.slice(0, 20),
      recentDispatches: storeDispatches.slice(0, 50)
    };
  }

  // -------------------------------------------------------------
  // Smart Review Shield & Private Feedback Methods
  // -------------------------------------------------------------
  addFeedback(feedbackData) {
    this.state.privateFeedback = this.state.privateFeedback || [];
    const record = {
      id: feedbackData.id || `FB_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
      billId: feedbackData.billId || null,
      storeCode: (feedbackData.storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase(),
      invoiceNo: feedbackData.invoiceNo || 'INV-4920',
      customerName: feedbackData.customerName || 'Valued Customer',
      customerPhone: feedbackData.customerPhone || '9876543210',
      rating: parseInt(feedbackData.rating, 10) || 5,
      action: feedbackData.action || (feedbackData.rating >= 4 ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK'),
      category: feedbackData.category || (feedbackData.rating >= 4 ? 'Satisfied Customer' : 'General Service'),
      comment: feedbackData.comment || '',
      requestCallback: !!feedbackData.requestCallback,
      status: feedbackData.status || 'OPEN',
      notes: feedbackData.notes || '',
      timestamp: feedbackData.timestamp || new Date().toISOString()
    };

    this.state.privateFeedback.unshift(record);
    if (this.state.privateFeedback.length > 500) {
      this.state.privateFeedback.pop();
    }

    if (record.rating >= 4) {
      this.incrementMetric('positiveReviewsRedirected');
    } else {
      this.incrementMetric('negativeReviewsShielded');
    }

    this.save();
    return record;
  }

  getFeedback(storeCode = null) {
    this.state.privateFeedback = this.state.privateFeedback || [];
    if (!storeCode) return this.state.privateFeedback;
    const code = storeCode.toUpperCase();
    return this.state.privateFeedback.filter(f => (f.storeCode || '').toUpperCase() === code);
  }

  updateFeedbackStatus(id, status = 'RESOLVED', notes = '') {
    this.state.privateFeedback = this.state.privateFeedback || [];
    const item = this.state.privateFeedback.find(f => f.id === id);
    if (!item) return null;
    item.status = status;
    if (notes) item.notes = notes;
    item.updatedAt = new Date().toISOString();
    this.save();
    return item;
  }
}

export const storage = new ResilientStorage();

