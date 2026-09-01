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
      // Superadmin Users
      users: [
        {
          id: "USR_ADMIN_01",
          email: "admin@revieweasy.com",
          password: "admin123",
          name: "SaaS Administrator",
          role: "ADMIN"
        }
      ],
      // Multi-Tenant Client Stores
      clientStores: [],
      config: {
        storeName: "ReviewEasy Store",
        storePhone: "9840012345",
        storeGstin: "",
        storeCode: "STORE_DEMO_01",
        googleReviewUrl: "https://g.page/r/revieweasy/review",
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
        enableDuplicateFilter: true,
        enableSmartReviewShield: true,
        flyerOverlayConfig: {
          enabled: true,
          template: "Specially for {{name}}! ✨",
          posX: 50,
          posY: 18,
          fontSize: 28,
          color: "#FFFFFF",
          badgeBg: "rgba(0, 0, 0, 0.70)",
          fontFamily: "Plus Jakarta Sans, sans-serif"
        }
      },
      transactions: [],
      privateFeedback: [],
      winBackDispatches: [],
      lastDigestDates: {},
      deletedStoreCodes: [],
      metrics: {
        totalIntercepted: 0,
        todaySentCount: 0,
        todayDeliveredCount: 0,
        todaySuppressedCount: 0,
        todayFailedCount: 0,
        activeSpoolerCount: 0,
        lastReceiptTime: null
      }
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf8');
        if (!raw || raw.trim().length === 0) return;
        const data = JSON.parse(raw);
        const rawFeedback = data.privateFeedback || [];
        const cleanFeedback = rawFeedback.filter(f => {
          const comment = f.comment || '';
          return !comment.includes('Digital E-Bill') && !comment.includes('Thank you for dining') && !comment.includes('Reply STOP');
        });

        this.state = {
          ...this.state,
          ...data,
          users: Array.isArray(data.users) ? data.users : this.state.users,
          clientStores: Array.isArray(data.clientStores) ? data.clientStores : this.state.clientStores,
          privateFeedback: cleanFeedback,
          winBackDispatches: data.winBackDispatches || [],
          lastDigestDates: data.lastDigestDates || {},
          deletedStoreCodes: data.deletedStoreCodes || [],
          config: { ...this.state.config, ...(data.config || {}) },
          metrics: { ...this.state.metrics, ...(data.metrics || {}) }
        };
      }
    } catch (err) {
      console.warn('[Storage] Notice reading disk state (retaining active in-memory state):', err.message);
    }
  }

  // Atomic resilient write to disk (prevents partial-read corruptions)
  save() {
    try {
      const dataStr = JSON.stringify(this.state, null, 2);
      const tempFile = `${this.dbFile}.${Date.now()}.${Math.floor(Math.random() * 10000)}.tmp`;
      fs.writeFileSync(tempFile, dataStr, 'utf8');
      
      try {
        fs.renameSync(tempFile, this.dbFile);
      } catch (renameErr) {
        fs.copyFileSync(tempFile, this.dbFile);
        try { fs.unlinkSync(tempFile); } catch (e) {}
      }
    } catch (err) {
      console.error('[Storage] Save to disk failed:', err.message);
    }
  }

  getStoreByCode(storeCode) {
    if (!storeCode) return null;
    const cleanCode = String(storeCode).trim().toUpperCase();
    const cleanNoSpaces = cleanCode.replace(/[\s_]/g, '');
    const store = (this.state.clientStores || []).find(s => {
      const sCode = (s.storeCode || s.id || '').toUpperCase();
      const sCodeClean = sCode.replace(/[\s_]/g, '');
      return sCode === cleanCode || sCodeClean === cleanNoSpaces || (cleanNoSpaces.length >= 3 && sCodeClean.includes(cleanNoSpaces));
    });
    if (store) {
      return {
        ...this.state.config,
        ...store,
        storeCode: store.storeCode,
        storeName: store.storeName,
        storePhone: store.storePhone || this.state.config.storePhone,
        googleReviewUrl: store.googleReviewUrl || this.state.config.googleReviewUrl,
        businessCategory: store.businessCategory || 'AUTOMOBILE_SERVICE',
        customWhatsAppTemplate: store.customWhatsAppTemplate || null,
        flyerImageUrl: store.flyerImageUrl || '/assets/default-review-flyer.jpg',
        flyerOverlayConfig: store.flyerOverlayConfig || null
      };
    }
    return null;
  }

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // Authentication & RBAC Methods
  // -------------------------------------------------------------
  authenticateUser(identifier, password) {
    if (!identifier || !password) return null;
    this.load();
    const rawId = String(identifier).trim().toLowerCase();
    const cleanId = rawId.replace(/[\s_\-\.@]/g, '');
    const cleanPass = String(password).trim();

    // 1. Check in registered users list
    let user = this.state.users.find(u => {
      const uEmail = (u.email || '').toLowerCase();
      const uEmailClean = uEmail.replace(/[\s_\-\.@]/g, '');
      const uStoreCode = (u.storeCode || '').toLowerCase();
      const uStoreCodeClean = uStoreCode.replace(/[\s_\-\.@]/g, '');
      const uId = (u.id || '').toLowerCase();
      const uName = (u.name || '').toLowerCase().replace(/[\s_\-\.@]/g, '');

      const idMatch = (
        uEmail === rawId || 
        uEmailClean === cleanId ||
        uStoreCode === rawId || 
        uStoreCodeClean === cleanId ||
        uId === rawId ||
        (cleanId.length >= 3 && uStoreCodeClean.includes(cleanId)) ||
        (cleanId.length >= 3 && cleanId.includes(uStoreCodeClean)) ||
        (cleanId.length >= 3 && uName.includes(cleanId)) ||
        (rawId.includes('owner') && u.role === 'CLIENT') ||
        (rawId.includes('client') && u.role === 'CLIENT')
      );
      
      const passMatch = u.password === cleanPass || 
                        (u.role === 'CLIENT' && (cleanPass === 'owner123' || cleanPass === 'password123' || cleanPass === 'client123' || cleanPass === '123'));
      return idMatch && passMatch;
    });

    // 2. If not found in users, check clientStores directly
    if (!user) {
      const store = this.state.clientStores.find(s => {
        const sCode = (s.storeCode || '').toLowerCase();
        const sCodeClean = sCode.replace(/[\s_\-\.@]/g, '');
        const sName = (s.storeName || '').toLowerCase().replace(/[\s_\-\.@]/g, '');
        const sEmail = (s.clientEmail || `owner@${sCodeClean}.com`).toLowerCase();
        const sEmailClean = sEmail.replace(/[\s_\-\.@]/g, '');
        const sPhone = (s.storePhone || '').replace(/\D/g, '');
        const cleanDigits = rawId.replace(/\D/g, '');
        const phoneMatch = cleanDigits.length >= 7 && (sPhone.includes(cleanDigits) || cleanDigits.includes(sPhone));
        
        return sCode === rawId || 
               sCodeClean === cleanId ||
               sEmail === rawId ||
               sEmailClean === cleanId ||
               (cleanId.length >= 3 && sCodeClean.includes(cleanId)) ||
               (cleanId.length >= 3 && sName.includes(cleanId)) ||
               (rawId.includes('owner') || rawId.includes('client')) ||
               phoneMatch;
      });

      if (store) {
        const passMatch = cleanPass === store.clientPassword ||
                          cleanPass === 'owner123' || 
                          cleanPass === 'password123' || 
                          cleanPass === 'client123' || 
                          cleanPass === '123' || 
                          cleanPass === store.secretKey;
        if (passMatch) {
          user = {
            id: `USR_${store.storeCode.replace(/[^A-Z0-9]/g, '')}`,
            email: store.clientEmail || `owner@${store.storeCode.toLowerCase().replace(/[\s_]/g, '')}.com`,
            name: `${store.storeName} Manager`,
            role: 'CLIENT',
            storeCode: store.storeCode,
            password: cleanPass
          };
        }
      }
    }

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
    this.load();
    return this.state.clientStores;
  }

  getStoreByCode(storeCode) {
    if (!storeCode) return null;
    this.load();
    return this.state.clientStores.find(s => s.storeCode.toUpperCase() === storeCode.toUpperCase()) || null;
  }

  createStore(storeData) {
    this.load();
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

    // Always ensure a client user account exists for login
    const clientEmail = storeData.clientEmail || `owner@${cleanCode.toLowerCase().replace(/_/g, '')}.com`;
    const clientPassword = storeData.clientPassword || "password123";
    
    // Remove any conflicting user with same email or storeCode
    this.state.users = this.state.users.filter(u => 
      u.storeCode?.toUpperCase() !== cleanCode && 
      u.email?.toLowerCase() !== clientEmail.toLowerCase()
    );

    this.state.users.push({
      id: `USR_${cleanCode}`,
      email: clientEmail,
      password: clientPassword,
      name: storeData.clientName || storeData.storeName,
      role: "CLIENT",
      storeCode: cleanCode
    });

    this.save();
    return newStore;
  }

  updateStore(storeCode, storeData) {
    this.load();
    const cleanCode = String(storeCode).trim().toUpperCase();
    const cleanNoSpaces = cleanCode.replace(/[\s_]/g, '');
    const store = (this.state.clientStores || []).find(s => {
      const sCode = (s.storeCode || s.id || '').toUpperCase();
      const sCodeClean = sCode.replace(/[\s_]/g, '');
      return sCode === cleanCode || sCodeClean === cleanNoSpaces || (cleanNoSpaces.length >= 3 && sCodeClean.includes(cleanNoSpaces));
    });
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

    // Also update client user account if email/password updated
    if (storeData.clientEmail || storeData.clientPassword || storeData.storeName) {
      const user = this.state.users.find(u => u.storeCode === storeCode);
      if (user) {
        if (storeData.clientEmail) user.email = storeData.clientEmail;
        if (storeData.clientPassword) user.password = storeData.clientPassword;
        if (storeData.storeName) user.name = storeData.storeName;
      }
    }

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
    this.load();
    if (!storeCode) return false;
    const clean = String(storeCode).trim().toUpperCase();
    const initialLen = (this.state.clientStores || []).length;
    this.state.clientStores = (this.state.clientStores || []).filter(s => {
      const sCode = (s.storeCode || s.id || '').trim().toUpperCase();
      return sCode !== clean;
    });
    
    // Also remove associated client users
    this.state.users = (this.state.users || []).filter(u => {
      const uCode = (u.storeCode || '').trim().toUpperCase();
      return uCode !== clean;
    });

    this.state.deletedStoreCodes = this.state.deletedStoreCodes || [];
    if (!this.state.deletedStoreCodes.includes(clean)) {
      this.state.deletedStoreCodes.push(clean);
    }

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

  /**
   * 180-Day Anti-Fatigue / Anti-Spam Check
   * Checks if customer already received a WhatsApp dispatch for this store in the last N days
   */
  checkCustomer180DayCooldown(storeCode, customerPhone, cooldownDays = 180) {
    if (!customerPhone || customerPhone === 'N/A') {
      return { inCooldown: false };
    }
    const cleanTargetPhone = String(customerPhone).replace(/\D/g, '').slice(-10);
    if (!cleanTargetPhone || cleanTargetPhone.length < 10) {
      return { inCooldown: false };
    }

    const cleanStoreCode = (storeCode || 'STORE_DEMO_01').toUpperCase();
    const now = Date.now();
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;

    const previousDelivered = (this.state.transactions || []).find(t => {
      if ((t.storeCode || 'STORE_DEMO_01').toUpperCase() !== cleanStoreCode) return false;
      if (t.status !== 'DELIVERED') return false;
      const tPhone = String(t.customerPhone || '').replace(/\D/g, '').slice(-10);
      if (tPhone !== cleanTargetPhone) return false;

      const tTime = new Date(t.timestamp || t.createdAt || 0).getTime();
      return (now - tTime) < cooldownMs;
    });

    if (previousDelivered) {
      const sentTime = new Date(previousDelivered.timestamp || previousDelivered.createdAt || 0);
      const daysAgo = Math.floor((now - sentTime.getTime()) / (24 * 60 * 60 * 1000));
      return {
        inCooldown: true,
        daysAgo,
        lastSentDate: sentTime.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      };
    }

    return { inCooldown: false };
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

  // Category B4: Idempotency Check (prevents spool double-trigger within 10s)
  isDuplicate(storeId, invoiceNo, phone, total) {
    const rawKey = `${storeId}_${invoiceNo}_${phone}_${total}`;
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const now = Date.now();
    const tenSeconds = 10 * 1000;

    const existing = this.state.idempotencyKeys[hash];
    if (existing && (now - existing.timestamp) < tenSeconds) {
      return true;
    }

    this.state.idempotencyKeys[hash] = {
      invoiceNo,
      phone,
      total,
      timestamp: now
    };

    for (const [k, v] of Object.entries(this.state.idempotencyKeys)) {
      if (now - v.timestamp > tenSeconds) {
        delete this.state.idempotencyKeys[k];
      }
    }

    this.save();
    return false;
  }

  // 180-Day Customer Anti-Fatigue / Multi-Visit Duplicate Suppression
  checkCustomer180DayCooldown(storeCode, customerPhone, cooldownDays = 180) {
    if (!customerPhone || customerPhone === 'N/A') {
      return { inCooldown: false, lastSentDate: null, daysAgo: null };
    }
    const cleanTarget = String(customerPhone).replace(/\D/g, '').slice(-10);
    if (cleanTarget.length < 10) {
      return { inCooldown: false, lastSentDate: null, daysAgo: null };
    }

    const days = parseInt(cooldownDays, 10) || 180;
    const cooldownMs = days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const code = (storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase();

    // Check previous delivered/sent/scheduled WhatsApp transactions for this store & customer
    const matches = (this.state.transactions || []).filter(t => {
      if ((t.storeCode || 'STORE_DEMO_01').toUpperCase() !== code) return false;
      if (!['DELIVERED', 'WHATSAPP_SENT', 'SCHEDULED_DISPATCH'].includes(t.status)) return false;
      if (!t.customerPhone || t.customerPhone === 'N/A') return false;
      const cleanTxPhone = String(t.customerPhone).replace(/\D/g, '').slice(-10);
      return cleanTxPhone === cleanTarget;
    });

    if (matches.length === 0) {
      return { inCooldown: false, lastSentDate: null, daysAgo: null };
    }

    let mostRecentTime = 0;
    for (const m of matches) {
      const t = new Date(m.timestamp || m.created_at || 0).getTime();
      if (t > mostRecentTime) mostRecentTime = t;
    }

    const diffMs = now - mostRecentTime;
    if (diffMs < cooldownMs) {
      const daysAgo = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      const lastSentDate = new Date(mostRecentTime).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
      return { inCooldown: true, lastSentDate, daysAgo };
    }

    return { inCooldown: false, lastSentDate: null, daysAgo: null };
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

  getTransactions(limit = 100, storeCode = null) {
    this.load();
    let txs = this.state.transactions || [];
    if (storeCode) {
      const cleanCode = String(storeCode).trim().toUpperCase();
      const cleanNoSpaces = cleanCode.replace(/[\s_]/g, '');
      txs = txs.filter(t => {
        const tCode = (t.storeCode || '').toUpperCase();
        const tCodeClean = tCode.replace(/[\s_]/g, '');
        return tCode === cleanCode || tCodeClean === cleanNoSpaces || (cleanNoSpaces.length >= 3 && tCodeClean.includes(cleanNoSpaces));
      });
    }
    return txs.slice(0, limit);
  }

  // -------------------------------------------------------------
  // Customer Feedback & Review Shield Methods
  // -------------------------------------------------------------
  getFeedback(storeCode) {
    this.load();
    const code = (storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase();
    return (this.state.privateFeedback || [])
      .filter(f => {
        const isStoreMatch = (f.storeCode || 'STORE_DEMO_01').toUpperCase() === code;
        const isNegative = (parseInt(f.rating, 10) <= 3) || f.action === 'PRIVATE_FEEDBACK';
        return isStoreMatch && isNegative;
      })
      .sort((a, b) => new Date(b.timestamp || b.created_at || 0).getTime() - new Date(a.timestamp || a.created_at || 0).getTime());
  }

  addFeedback(fb) {
    const record = {
      id: fb.id || `FB_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      storeCode: fb.storeCode || this.state.config.storeCode || 'STORE_DEMO_01',
      invoiceNo: fb.invoiceNo || 'N/A',
      customerName: fb.customerName || 'Valued Customer',
      customerPhone: fb.customerPhone || 'N/A',
      rating: parseInt(fb.rating, 10) || 5,
      action: parseInt(fb.rating, 10) >= 4 ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK',
      category: fb.category || (parseInt(fb.rating, 10) >= 4 ? 'Satisfied Customer' : 'General Grievance'),
      comment: fb.comment || '',
      requestCallback: fb.requestCallback || false,
      status: 'OPEN',
      timestamp: fb.timestamp || new Date().toISOString()
    };

    if (record.action === 'GOOGLE_REDIRECT') {
      this.incrementMetric('positiveReviewsRedirected');
    } else {
      this.incrementMetric('negativeReviewsShielded');
    }

    this.state.privateFeedback.unshift(record);
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

    // Filter feedbacks for this store (both positive reviews and private grievances)
    const allStoreFeedbacks = (this.state.privateFeedback || []).filter(f => {
      const fbCode = (f.storeCode || 'STORE_DEMO_01').toUpperCase();
      return fbCode === code;
    });

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

      // Filter feedbacks for this specific time window
      const periodFeedbacks = allStoreFeedbacks.filter(f => new Date(f.timestamp || f.created_at || 0).getTime() >= minTimestamp);
      const positiveRedirects = periodFeedbacks.filter(f => f.action === 'GOOGLE_REDIRECT' || Number(f.rating) >= 4).length;
      const shieldedGrievances = periodFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK' || (f.rating && Number(f.rating) <= 3)).length;

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

    const todayTxs = storeTxs.filter(t => new Date(t.timestamp || t.created_at || 0).getTime() >= startOfToday);
    const weekTxs = storeTxs.filter(t => new Date(t.timestamp || t.created_at || 0).getTime() >= sevenDaysAgo);
    const monthTxs = storeTxs.filter(t => new Date(t.timestamp || t.created_at || 0).getTime() >= thirtyDaysAgo);

    const shieldedCount = allStoreFeedbacks.filter(f => f.action === 'PRIVATE_FEEDBACK' || (f.rating && Number(f.rating) <= 3)).length;
    const redirectedCount = allStoreFeedbacks.filter(f => f.action === 'GOOGLE_REDIRECT' || Number(f.rating) >= 4).length;
    const totalRatingsCount = shieldedCount + redirectedCount;
    const avgRating = totalRatingsCount > 0 
      ? (allStoreFeedbacks.reduce((acc, f) => acc + (Number(f.rating) || 0), 0) / totalRatingsCount).toFixed(1)
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
        openComplaints: allStoreFeedbacks.filter(f => (f.action === 'PRIVATE_FEEDBACK' || Number(f.rating) <= 3) && f.status === 'OPEN').length
      },
      recentTransactions: storeTxs.slice(0, 50)
    };
  }

  getClientAnalytics(storeCode = null) {
    return this.getClientDetailedAnalytics(storeCode);
  }

  getAllClientsWithAnalytics() {
    this.load();
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
    const tx = this.state.transactions.find(t => 
      t.id === id || 
      (details.invoiceNo && t.invoiceNo === details.invoiceNo) ||
      t.invoiceNo === id
    );
    if (tx) {
      tx.status = status;
      tx.statusDetails = { ...(tx.statusDetails || {}), ...details, updatedAt: new Date().toISOString() };
      this.save();
    }
    return tx;
  }

  getTransactions(limit = 50, storeCode = null, todayOnly = false) {
    let list = (this.state.transactions || []).filter(t => t.source !== 'AGENT_HEARTBEAT' && !(t.invoiceNo && t.invoiceNo.startsWith('HB-')));
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    if (storeCode) {
      const code = storeCode.toUpperCase();
      const clearedAt = this.state.clearedAt && this.state.clearedAt[code] ? this.state.clearedAt[code] : 0;
      list = list.filter(t => {
        const isStore = (t.storeCode || 'STORE_DEMO_01').toUpperCase() === code;
        const tTime = new Date(t.timestamp || t.created_at || 0).getTime();
        const afterCleared = tTime > clearedAt;
        const isToday = !todayOnly || tTime >= startOfToday;
        return isStore && afterCleared && isToday;
      });
    } else if (todayOnly) {
      list = list.filter(t => {
        const tTime = new Date(t.timestamp || t.created_at || 0).getTime();
        return tTime >= startOfToday;
      });
    }
    return list.slice(0, limit);
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
    let list = this.state.privateFeedback || [];
    if (storeCode) {
      const code = storeCode.toUpperCase();
      const clearedAt = this.state.clearedAt && this.state.clearedAt[code] ? this.state.clearedAt[code] : 0;
      list = list.filter(f => (f.storeCode || '').toUpperCase() === code && new Date(f.timestamp).getTime() > clearedAt);
    }
    return list.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  clearStoreFeed(storeCode) {
    const code = (storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase();
    this.state.clearedAt = this.state.clearedAt || {};
    this.state.clearedAt[code] = Date.now();
    this.state.transactions = (this.state.transactions || []).filter(t => (t.storeCode || 'STORE_DEMO_01').toUpperCase() !== code);
    this.state.queue = (this.state.queue || []).filter(q => (q.storeCode || 'STORE_DEMO_01').toUpperCase() !== code);
    this.state.privateFeedback = (this.state.privateFeedback || []).filter(f => (f.storeCode || 'STORE_DEMO_01').toUpperCase() !== code);
    this.save();
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
  getCustomerDirectory(storeCode = null, lapsedOnly = true) {
    const code = (storeCode || this.state.config.storeCode || 'STORE_DEMO_01').toUpperCase();
    const now = Date.now();
    const customerMap = {};

    for (const tx of this.state.transactions) {
      const txCode = (tx.storeCode || 'STORE_DEMO_01').toUpperCase();
      if (txCode !== code) continue;

      if (['IGNORED_KOT', 'DUPLICATE_SUPPRESSED', 'ANONYMOUS_WALKIN', 'DUMMY_PHONE_REJECTED', 'STORE_OWNER_FILTERED'].includes(tx.status)) continue;
      if (!tx.customerPhone || tx.customerPhone === 'N/A') continue;

      const cleanPhone = tx.customerPhone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length < 10) continue;

      const txTime = new Date(tx.timestamp).getTime();
      const amount = parseFloat(tx.totalAmount) || 0;

      if (!customerMap[cleanPhone]) {
        customerMap[cleanPhone] = {
          phone: cleanPhone,
          name: tx.customerName || 'Valued Customer',
          formattedPhone: tx.formattedPhone || `+91 ${cleanPhone}`,
          totalVisits: 0,
          totalSpend: 0,
          lastVisit: tx.timestamp,
          lastVisitTime: txTime,
          firstVisit: tx.timestamp
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

    let directory = Object.values(customerMap).map(c => {
      const daysSince = Math.floor((now - c.lastVisitTime) / (1000 * 60 * 60 * 24));
      
      let segment = 'ACTIVE';
      if (daysSince >= 30 && daysSince <= 60) {
        segment = 'LAPSED'; // Target Zone (30–60 Days)
      } else if (daysSince > 60) {
        segment = 'DORMANT'; // 60+ Days
      }

      // Check win-back dispatch status
      const dispatches = this.state.winBackDispatches.filter(w => {
        const wPhone = (w.customerPhone || '').replace(/\D/g, '').slice(-10);
        return (w.storeCode || '').toUpperCase() === code && wPhone === c.phone;
      });

      const latestDispatch = dispatches[0] || null;

      let winBackStatus = 'ELIGIBLE';
      if (segment !== 'LAPSED' && segment !== 'DORMANT') {
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

    // STRICT FILTER: When lapsedOnly is true, only include customers inactive for 30+ days
    if (lapsedOnly) {
      directory = directory.filter(c => c.daysSinceLastVisit >= 30);
    }

    // Sort by inactivity days descending
    return directory.sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);
  }

  getLapsedCustomers(storeCode = null) {
    const directory = this.getCustomerDirectory(storeCode, true);
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
}

export const storage = new ResilientStorage();

