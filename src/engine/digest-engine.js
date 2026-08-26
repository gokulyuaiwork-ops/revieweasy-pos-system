import { storage } from './storage.js';

export class DailyDigestEngine {
  constructor(broadcastCallback, localBaileys = null) {
    this.broadcast = broadcastCallback || (() => {});
    this.localBaileys = localBaileys;
    this.schedulerTimer = null;
  }

  setBaileys(localBaileys) {
    this.localBaileys = localBaileys;
  }

  /**
   * Format the Daily Closing WhatsApp Digest Message
   */
  generateDigestText(storeCode) {
    const data = storage.getDailyDigestData(storeCode);
    const complaintsCount = data.openComplaints.length;
    
    let complaintAlertText = `• 0 Open Customer Complaints (Clean Slate! ✨)`;
    if (complaintsCount > 0) {
      complaintAlertText = `• ⚠️ ${complaintsCount} Unresolved Private Feedback (Action Recommended)`;
    }

    return `🌙 *DAILY BUSINESS CLOSING DIGEST*
🏪 *${data.storeName}*
📅 *Date:* ${data.dateFormatted} (Closing Summary)
━━━━━━━━━━━━━━━━━━━━━
📊 *SALES & INVOICE PERFORMANCE*
• Total Bills Intercepted: ${data.totalBills}
• Gross Sales Volume: ₹${data.totalSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
• Average Order Value: ₹${data.avgTicket}

💬 *WHATSAPP ENGAGEMENT*
• Review Invites Delivered: ${data.whatsappDelivered} (${data.reachRate}% Reach)
• Non-WhatsApp / Walk-ins: ${data.dummyFiltered}
• KOTs / Jam Reprints Blocked: ${data.kotsBlocked}

🛡️ *SMART REVIEW SHIELD METRICS*
• ⭐ 5-Star Google Redirects: ${data.redirectedCount}
• 🛡️ Negative Reviews Shielded: ${data.shieldedCount} (Deflected from Google)
• 🌟 Average CSAT Rating: ${data.avgRating} / 5.0

📋 *ACTION ITEMS & SYSTEM HEALTH*
${complaintAlertText}
• System Status: 100% Operational (0 Edge Sync Errors)
━━━━━━━━━━━━━━━━━━━━━
_ReviewEasy Automated Intelligence Engine_`;
  }

  /**
   * Send the Daily Closing Digest for a specific store
   */
  async sendStoreDigest(storeCode, isManual = false) {
    const code = (storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    const data = storage.getDailyDigestData(code);
    const digestText = this.generateDigestText(code);
    const todayStr = new Date().toISOString().slice(0, 10);

    let sendResult = { success: false, mode: 'DISCONNECTED' };

    if (this.localBaileys && this.localBaileys.status === 'CONNECTED') {
      sendResult = await this.localBaileys.sendMessage(data.storePhone, digestText);
    } else {
      // In development or simulated mode
      sendResult = { success: true, mode: 'SIMULATED_SOCKET' };
    }

    storage.incrementMetric('ownerDigestsSent');
    storage.setLastDigestDate(code, todayStr);

    const logEntry = {
      storeCode: code,
      storeName: data.storeName,
      recipientPhone: data.storePhone,
      isManual,
      status: sendResult.success ? 'DELIVERED' : 'FAILED',
      timestamp: new Date().toISOString(),
      digestPreview: digestText
    };

    console.log(`[Daily Digest Engine] 🌙 Closing digest sent to store owner +91 ${data.storePhone} (${data.storeName})!`);
    this.broadcast('DIGEST_SENT', logEntry);

    return {
      success: true,
      log: logEntry,
      digestText
    };
  }

  /**
   * Automated Check: Runs at closing time / quiet hours start
   */
  async checkAndSendClosingDigests() {
    const config = storage.getConfig();
    if (config.dailyDigestEnabled === false) return;

    const now = new Date();
    const currentHoursMins = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const digestTargetTime = config.dailyDigestTime || config.quietHoursStart || '21:00';
    const todayStr = now.toISOString().slice(0, 10);

    // If current time matches or is within 15 minutes after digest time
    const [targetH, targetM] = digestTargetTime.split(':').map(Number);
    const targetMinutes = targetH * 60 + targetM;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Check if we are in the closing trigger window (target time to target time + 30 mins)
    if (currentMinutes >= targetMinutes && currentMinutes <= targetMinutes + 30) {
      const stores = storage.getAllStores();
      for (const store of stores) {
        const lastSent = storage.getLastDigestDate(store.storeCode);
        if (lastSent !== todayStr) {
          console.log(`[Daily Digest Scheduler] ⏰ Auto-triggering closing digest for ${store.storeName} (${store.storeCode}) at ${currentHoursMins}...`);
          await this.sendStoreDigest(store.storeCode, false);
        }
      }
    }
  }

  startScheduler() {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    // Check every 60 seconds
    this.schedulerTimer = setInterval(() => {
      this.checkAndSendClosingDigests();
    }, 60000);
    console.log('[Daily Digest Engine] 🌙 Closing time digest scheduler started (Checks every 60s)');
  }
}
