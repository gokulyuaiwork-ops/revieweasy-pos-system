import { storage } from './storage.js';

export class WinBackEngine {
  constructor(broadcastCallback, localBaileys = null) {
    this.broadcast = broadcastCallback || (() => { });
    this.localBaileys = localBaileys;
    this.schedulerTimer = null;
  }

  setBaileys(localBaileys) {
    this.localBaileys = localBaileys;
  }

  /**
   * Warm, relationship-first Win-Back message with custom template support
   */
  generateWinBackMessage(customerName, storeName, googleMapUrl = '', customTemplate = null) {
    const cleanName = customerName && customerName !== 'Valued Customer' ? customerName : 'there';

    if (customTemplate && customTemplate.trim()) {
      return customTemplate
        .replace(/{{name}}/gi, cleanName)
        .replace(/{{customerName}}/gi, cleanName)
        .replace(/{{storeName}}/gi, storeName)
        .replace(/{{googleMapUrl}}/gi, googleMapUrl || 'Visit us in-store');
    }

    return `Hi ${cleanName}! ✨ We noticed it’s been a while since your last visit to ${storeName}.

We’ve refreshed our seasonal specialties and ambiance, and our entire team would love to welcome you back! ☕🍰

Hope to see you again soon!
📍 Directions & Location: ${googleMapUrl || 'Visit us in-store'}

(Reply STOP to unsubscribe)`;
  }

  /**
   * Dispatch Win-Back to a specific customer with optional custom message
   */
  async dispatchToCustomer(storeCode, customerPhone, customMessage = null) {
    const code = (storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const store = storage.getStoreByCode(code) || {
      storeName: storage.getConfig().storeName || 'Sunshine Cafe & Bistro',
      googleReviewUrl: storage.getConfig().googleReviewUrl,
      customWinBackTemplate: storage.getConfig().customWinBackTemplate
    };

    const cleanPhone = (customerPhone || '').replace(/\D/g, '').slice(-10);
    const directory = storage.getCustomerDirectory(code);
    let customer = directory.find(c => c.phone === cleanPhone);

    if (!customer) {
      customer = {
        name: 'Valued Customer',
        phone: cleanPhone,
        daysSinceLastVisit: 0,
        lastVisit: new Date().toISOString()
      };
    }

    const message = customMessage || this.generateWinBackMessage(
      customer.name,
      store.storeName,
      store.googleReviewUrl,
      store.customWinBackTemplate
    );

    let sendResult = { success: false, mode: 'DISCONNECTED' };
    if (this.localBaileys && this.localBaileys.status === 'CONNECTED') {
      sendResult = await this.localBaileys.sendMessage(cleanPhone, message);
    } else {
      sendResult = { success: true, mode: 'SIMULATED_SOCKET' };
    }

    const record = storage.recordWinBackDispatch({
      storeCode: code,
      customerPhone: cleanPhone,
      customerName: customer.name,
      lastVisitDate: customer.lastVisit,
      daysInactive: customer.daysSinceLastVisit,
      messagePreview: message
    });

    console.log(`[Win-Back Engine] 🎯 Dispatched warm re-invitation to lapsed customer ${customer.name} (+91 ${cleanPhone}, ${customer.daysSinceLastVisit} days inactive)!`);
    this.broadcast('WINBACK_DISPATCHED', { record, customer });
    this.broadcast('METRICS_UPDATED', storage.getMetrics());

    return {
      success: true,
      record,
      customer,
      messagePreview: message
    };
  }

  /**
   * Run Scan and Batch Dispatch for all eligible lapsed customers (30–60 Days)
   */
  async runDailyScanAndDispatch(storeCode = null, maxBatch = 5) {
    const config = storage.getConfig();
    if (config.winBackEnabled === false) return { success: false, reason: 'DISABLED' };

    const code = (storeCode || config.storeCode || 'STORE_DEMO_01').toUpperCase();
    const directory = storage.getCustomerDirectory(code);
    const eligibleLapsed = directory.filter(c => c.segment === 'LAPSED' && c.winBackStatus === 'ELIGIBLE');

    console.log(`[Win-Back Engine] 🔍 Scanned store ${code}: Found ${eligibleLapsed.length} eligible lapsed customers (30–60 days inactive).`);

    const dispatched = [];
    const batch = eligibleLapsed.slice(0, maxBatch);

    for (let i = 0; i < batch.length; i++) {
      const customer = batch[i];
      try {
        const res = await this.dispatchToCustomer(code, customer.phone);
        if (res.success) {
          dispatched.push(res.record);
        }

        // Apply 10 to 15 seconds randomized humanized spacing between batch dispatches
        if (i < batch.length - 1) {
          const jitterDelayMs = Math.floor(10000 + Math.random() * 5000); // 10,000ms - 15,000ms
          console.log(`[Win-Back Engine] ⏳ Humanized spacing: waiting ${(jitterDelayMs / 1000).toFixed(1)}s before next WhatsApp dispatch...`);
          await new Promise(r => setTimeout(r, jitterDelayMs));
        }
      } catch (err) {
        console.error(`[Win-Back Engine] Error dispatching to +91 ${customer.phone}:`, err.message);
      }
    }

    return {
      success: true,
      scannedCount: directory.length,
      lapsedEligibleCount: eligibleLapsed.length,
      dispatchedCount: dispatched.length,
      dispatched
    };
  }

  startScheduler() {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    // Check every 2 hours
    this.schedulerTimer = setInterval(() => {
      const now = new Date();
      const hours = now.getHours();
      // Run during daytime business hours (11:00 AM or 16:00 PM)
      if (hours === 11 || hours === 16) {
        const stores = storage.getAllStores();
        for (const store of stores) {
          this.runDailyScanAndDispatch(store.storeCode, 5);
        }
      }
    }, 2 * 60 * 60 * 1000);
    console.log('[Win-Back Engine] 🎯 Lapsed customer retention scheduler active');
  }
}
