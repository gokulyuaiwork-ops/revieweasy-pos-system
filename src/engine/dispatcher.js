import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { storage } from './storage.js';
import { generateInvoicePdfBuffer } from './invoice-generator.js';
import { PersonalizedImageGenerator } from './personalized-image-generator.js';
import { formatWhatsAppMessage, getCategoryTemplate } from './business-templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WhatsAppDispatcher {
  constructor(broadcastCallback, localBaileys = null, supabaseSync = null) {
    this.broadcast = broadcastCallback || (() => { });
    this.localBaileys = localBaileys;
    this.supabaseSync = supabaseSync;
    this.pacingQueue = [];
    this.isProcessingQueue = false;
    this.lastDispatchedTimestamp = 0;
    this.rateLimitTimer = null;
    this.startPeriodicQueueWorker();
    setTimeout(() => this.recoverPendingDispatches(), 3000);
  }

  /**
   * Automatically recover and process any dispatches that were left in SCHEDULED_DISPATCH
   */
  async recoverPendingDispatches() {
    const pending = storage.state.transactions.filter(t => t.status === 'SCHEDULED_DISPATCH');
    if (pending.length > 0) {
      console.log(`[WhatsApp Dispatcher] 🔄 Recovering ${pending.length} pending dispatch(es) from queue...`);
      for (const tx of pending) {
        this.enqueueForPacedDispatch(tx.id);
      }
    }
  }

  setEngines(localBaileys, supabaseSync) {
    this.localBaileys = localBaileys;
    this.supabaseSync = supabaseSync;
  }

  /**
   * Category E1: Check if current time is within Quiet Hours (e.g., 21:00 to 09:30 IST)
   */
  isQuietHours(date = new Date()) {
    const config = storage.getConfig();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const currentMins = hours * 60 + minutes;

    const [startH, startM] = config.quietHoursStart.split(':').map(Number);
    const [endH, endM] = config.quietHoursEnd.split(':').map(Number);

    const startMins = startH * 60 + startM; // 21:00 = 1260 mins
    const endMins = endH * 60 + endM;       // 09:30 = 570 mins

    if (startMins > endMins) {
      // Overnight range (e.g., 21:00 PM to 09:30 AM)
      return currentMins >= startMins || currentMins < endMins;
    }
    return currentMins >= startMins && currentMins < endMins;
  }

  /**
   * Main Pipeline: Process incoming bill from Spooler or TCP proxy
   */
  processIncomingBill(parsedJob) {
    const config = storage.getConfig();
    const now = new Date();

    // 1. Create base transaction record in Local SQLite/disk
    const tx = storage.addTransaction({
      storeCode: parsedJob.storeCode || config.storeCode || 'STORE_DEMO_01',
      timestamp: parsedJob.customTimestamp || now.toISOString(),
      invoiceNo: parsedJob.invoiceNo || 'N/A',
      customerName: parsedJob.customerName || 'Valued Customer',
      customerPhone: parsedJob.customerPhone || 'N/A',
      formattedPhone: parsedJob.formattedPhone || 'N/A',
      totalAmount: parsedJob.totalAmount || '0.00',
      source: parsedJob.source || 'PRINT_SPOOLER',
      isRaster: !!parsedJob.isRaster,
      status: parsedJob.status,
      reason: parsedJob.reason || null,
      rawText: parsedJob.rawText || '',
      synced: 0,
      syncStatus: 'QUEUED_LOCAL'
    });

    // Immediately push transaction to Supabase Cloud Database (Category C)
    if (this.supabaseSync) {
      this.supabaseSync.syncBillToCloud(tx).catch(e => console.warn('[Supabase Sync] Note:', e.message));
    }

    if (!parsedJob.success) {
      this.broadcast('TRANSACTION_UPDATED', tx);
      return tx;
    }

    // 2. 180-Day Customer Anti-Fatigue / Anti-Spam Check
    const cooldownDays = config.customerCooldownDays || 180;
    const cooldown = storage.checkCustomer180DayCooldown(tx.storeCode, tx.customerPhone, cooldownDays);
    if (cooldown.inCooldown) {
      storage.updateTransactionStatus(tx.id, 'SUPPRESSED_CUSTOMER_COOLDOWN', {
        reason: `Customer ${tx.formattedPhone} received WhatsApp invite ${cooldown.daysAgo === 0 ? 'today' : cooldown.daysAgo + 'd ago'} (${cooldown.lastSentDate}). ${cooldownDays}-day anti-fatigue rule active — suppressed.`
      });
      storage.incrementMetric('duplicatesSuppressed');
      console.log(`[WhatsApp Dispatcher] 🛡️ 180-Day Customer Cooldown active for ${tx.formattedPhone} (Last sent: ${cooldown.lastSentDate}). Bill #${tx.invoiceNo} intercepted without spamming customer.`);
      this.broadcast('TRANSACTION_UPDATED', tx);
      return tx;
    }

    // 3. Category E1: Quiet Hours Check (Overnight hold until 10:30 AM)
    if (this.isQuietHours(now)) {
      const tomorrow = new Date(now);
      if (now.getHours() >= 21) {
        tomorrow.setDate(tomorrow.getDate() + 1);
      }
      tomorrow.setHours(10, 30, 0, 0);

      storage.updateTransactionStatus(tx.id, 'QUEUED_QUIET_HOURS', {
        scheduledFor: tomorrow.toISOString(),
        reason: `Quiet Hours Active (${config.quietHoursStart} - ${config.quietHoursEnd} IST). Delivery queued for 10:30 AM.`
      });
      storage.incrementMetric('quietHoursRescheduled');

      console.log(`[WhatsApp Dispatcher] 🌙 Quiet hours active. Bill #${tx.invoiceNo} queued for 10:30 AM IST tomorrow.`);
      this.broadcast('TRANSACTION_UPDATED', tx);
      return tx;
    }

    // 3. Category E2: Daily Delivery Limit Check (e.g., 70 messages/day)
    const quota = storage.getTodayQuotaUsage(tx.storeCode);
    if (quota.isDailyCapped) {
      storage.updateTransactionStatus(tx.id, 'CANCELLED_DAILY_QUOTA', {
        reason: `Daily store quota of ${quota.dailyMax} messages reached (${quota.dailyUsed}/${quota.dailyMax} sent). Message cancelled to prevent spam risk.`
      });
      storage.incrementMetric('quotaLimitCancelled');

      console.log(`[WhatsApp Dispatcher] 🚫 Daily cap (${quota.dailyMax}) exceeded. Bill #${tx.invoiceNo} cancelled (Limit Exceeded).`);
      this.broadcast('TRANSACTION_UPDATED', tx);
      this.broadcast('QUOTA_UPDATED', quota);
      return tx;
    }

    // 4. Category E3: Dayparting Slot Quota Check (Morning 15, Afternoon 20, Evening 35)
    if (quota.isSlotCapped) {
      const slotName = quota.currentSlot;
      const slotInfo = quota.slots[slotName.toLowerCase()] || {};
      const slotMax = slotInfo.max || 20;
      const slotUsed = slotInfo.used || 0;

      storage.updateTransactionStatus(tx.id, 'CANCELLED_SLOT_QUOTA', {
        reason: `Limit exceeded: ${slotName} slot quota of ${slotMax} messages reached (${slotUsed}/${slotMax} sent). Message cancelled.`
      });
      storage.incrementMetric('quotaLimitCancelled');

      console.log(`[WhatsApp Dispatcher] 🚫 ${slotName} slot quota (${slotMax}) exceeded. Bill #${tx.invoiceNo} cancelled (Limit Exceeded).`);
      this.broadcast('TRANSACTION_UPDATED', tx);
      this.broadcast('QUOTA_UPDATED', quota);
      return tx;
    }

    // 5. Normal Delivery Flow: Scheduled with Strict FIFO Human Pacing Queue (15s minimum spacing)
    this.enqueueForPacedDispatch(tx.id);
    return tx;
  }

  /**
   * Enqueues a transaction into the strict FIFO pacing queue with exact 15s spacing
   */
  enqueueForPacedDispatch(txId) {
    const config = storage.getConfig();
    // Strict Anti-Ban: Spaced randomly between 10 and 15 seconds
    const randomDelay = Math.floor(10 + Math.random() * 6); // 10s - 15s random jitter
    
    const now = Date.now();
    const baseTime = Math.max(now, this.nextAvailableDispatchTime || now);
    this.nextAvailableDispatchTime = baseTime + (randomDelay * 1000);

    const estimatedWaitMs = this.nextAvailableDispatchTime - now;
    const estimatedWaitSeconds = Math.round(estimatedWaitMs / 1000);
    const queuePosition = Math.max(1, Math.round(estimatedWaitSeconds / randomDelay));
    const scheduledTime = new Date(this.nextAvailableDispatchTime).toISOString();

    storage.updateTransactionStatus(txId, 'SCHEDULED_DISPATCH', {
      queuePosition,
      delaySeconds: estimatedWaitSeconds,
      scheduledTime
    });

    const tx = storage.state.transactions.find(t => t.id === txId);
    if (tx) {
      console.log(`[Pacing Queue] 📥 Queued Bill #${tx.invoiceNo} (Position: #${queuePosition} in FIFO queue, dispatch in ~${estimatedWaitSeconds}s)`);
      this.broadcast('TRANSACTION_UPDATED', tx);
    }

    this.pacingQueue.push({ txId, dispatchAt: this.nextAvailableDispatchTime });
    this.triggerQueueWorker();
  }

  async triggerQueueWorker() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.pacingQueue.length > 0) {
      const job = this.pacingQueue[0];
      const now = Date.now();
      const waitMs = job.dispatchAt - now;

      if (waitMs > 0) {
        console.log(`[Pacing Queue] ⏳ Throttling: Waiting ${(waitMs / 1000).toFixed(1)}s before dispatching next message (Strict 15s rate limit)...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      this.pacingQueue.shift();
      await this.dispatchWhatsAppMessage(job.txId);
      this.lastDispatchedTimestamp = Date.now();
    }

    this.isProcessingQueue = false;
  }

  /**
   * Dispatch WhatsApp Message via Local Baileys WebSocket Engine directly from PC
   */
  async dispatchWhatsAppMessage(txId) {
    const config = storage.getConfig();
    const tx = storage.state.transactions.find(t => t.id === txId);
    if (!tx || tx.status === 'DELIVERED') return;

    const storeCode = tx.storeCode || config.storeCode || 'STORE_DEMO_01';
    const store = storage.getStoreByCode(storeCode);
    const storeName = store ? store.storeName : config.storeName;
    const baseUrl = config.appBaseUrl || 'http://localhost:3000';

    // Smart Review Shield URL vs direct Google review URL
    const reviewLink = config.smartShieldEnabled !== false
      ? `${baseUrl}/review.html?id=${tx.id}&store=${storeCode}`
      : (store ? store.googleReviewUrl : config.googleReviewUrl);

    const eBillUrl = `${baseUrl}/bill.html?id=${tx.id}&store=${storeCode}`;

    // Industry-Tailored Category or Custom Message Template
    const categoryInfo = getCategoryTemplate(store?.businessCategory || config.businessCategory || 'RESTAURANT_CAFE');
    const rawTemplate = store?.customWhatsAppTemplate || categoryInfo.defaultMessageTemplate;

    const messagePreviewText = formatWhatsAppMessage(rawTemplate, {
      customerName: tx.customerName || 'Valued Customer',
      storeName: storeName,
      invoiceNo: tx.invoiceNo || 'INV-1001',
      totalAmount: tx.totalAmount || '0.00',
      ebillUrl: eBillUrl,
      reviewLink: reviewLink
    });

    // Look for store promotional review flyer image or fallback placeholder
    let flyerImageBuffer = null;
    const flyerCandidates = [
      store?.flyerImagePath,
      store?.flyerImageUrl ? path.join(__dirname, '../../public', store.flyerImageUrl.replace(/^\//, '')) : null,
      path.join(__dirname, `../../public/uploads/flyers/${storeCode}.jpg`),
      path.join(__dirname, `../../public/uploads/flyers/${storeCode}.png`),
      path.join(__dirname, `../../data/flyers/${storeCode}.jpg`),
      path.join(__dirname, `../../data/flyers/${storeCode}.png`),
      path.join(__dirname, '../../public/assets/default-review-flyer.jpg'),
      path.join(__dirname, '../../data/flyers/default-review-flyer.jpg')
    ].filter(Boolean);

    for (const candidate of flyerCandidates) {
      if (fs.existsSync(candidate)) {
        try {
          flyerImageBuffer = fs.readFileSync(candidate);
          break;
        } catch (e) {}
      }
    }

    let hasImageAttachment = false;
    let messagePayload = { text: messagePreviewText };

    if (flyerImageBuffer && Buffer.isBuffer(flyerImageBuffer)) {
      hasImageAttachment = true;
      const overlayConfig = store?.flyerOverlayConfig || config.flyerOverlayConfig;
      let finalFlyerBuffer = flyerImageBuffer;

      try {
        finalFlyerBuffer = await PersonalizedImageGenerator.generatePersonalizedFlyer(
          flyerImageBuffer,
          tx.customerName,
          overlayConfig
        );
      } catch (err) {
        console.error('[WhatsApp Dispatcher] Error generating personalized flyer:', err.message);
        finalFlyerBuffer = flyerImageBuffer;
      }

      messagePayload = {
        text: messagePreviewText,
        caption: messagePreviewText,
        image: finalFlyerBuffer,
        mimetype: 'image/jpeg'
      };
    }

    // 1. Send locally from PC via Baileys Multi-Device Engine
    let sendResult = { success: false, mode: 'DISCONNECTED' };
    if (this.localBaileys && this.localBaileys.status === 'CONNECTED') {
      sendResult = await this.localBaileys.sendMessage(tx.customerPhone, messagePayload);
    }

    if (sendResult.success && sendResult.mode === 'LIVE_BAILEYS_SOCKET') {
      // 2. Real physical message delivered over Meta WhatsApp socket
      storage.updateTransactionStatus(txId, 'DELIVERED', {
        dispatchedAt: new Date().toISOString(),
        recipient: tx.customerPhone,
        messagePreview: messagePreviewText,
        hasImageAttachment: hasImageAttachment,
        transport: 'LIVE_BAILEYS_SOCKET'
      });
      storage.incrementMetric('whatsAppDelivered');

      if (this.supabaseSync) {
        this.supabaseSync.syncDispatchToCloud(txId, 'DELIVERED', { messagePreview: messagePreviewText });
      }

      console.log(`[WhatsApp Dispatcher] 🚀 REAL WHATSAPP DELIVERED (${hasImageAttachment ? 'PROMOTIONAL REVIEW IMAGE + CAPTION' : 'Text'}) to +91 ${tx.customerPhone} (Bill #${tx.invoiceNo})!`);
      this.broadcast('TRANSACTION_UPDATED', tx);
      this.broadcast('QUOTA_UPDATED', storage.getTodayQuotaUsage(tx.storeCode));
      this.broadcast('WHATSAPP_SENT', { tx, messageBody: messagePreviewText, hasImage: hasImageAttachment, live: true });
    } else if (sendResult.reason === 'NOT_ON_WHATSAPP') {
      // 3. Customer number has no WhatsApp account -> Do NOT consume daily quota
      storage.updateTransactionStatus(txId, 'NOT_ON_WHATSAPP', {
        reason: 'Customer mobile number is not registered on WhatsApp. (Quota preserved)',
        recipient: tx.customerPhone
      });
      storage.incrementMetric('notOnWhatsApp');

      if (this.supabaseSync) {
        this.supabaseSync.syncDispatchToCloud(txId, 'NOT_ON_WHATSAPP', { error: 'Not registered on WhatsApp' });
      }

      console.log(`[WhatsApp Dispatcher] 📱❌ +91 ${tx.customerPhone} is NOT on WhatsApp. (Quota preserved)`);
      this.broadcast('TRANSACTION_UPDATED', tx);
    } else {
      // 4. Phone not scanned/linked yet -> Queue and notify merchant to scan QR
      storage.updateTransactionStatus(txId, 'PENDING_WHATSAPP_LINK', {
        reason: 'WhatsApp phone not paired yet. Scan QR in dashboard to deliver real message.',
        recipient: tx.customerPhone,
        messagePreview: messagePreviewText
      });

      console.log(`[WhatsApp Dispatcher] 📱 Bill #${tx.invoiceNo} ready for +91 ${tx.customerPhone}. Waiting for WhatsApp QR link on dashboard.`);
      this.broadcast('TRANSACTION_UPDATED', tx);
    }
  }

  startPeriodicQueueWorker() {
    setInterval(() => {
      const now = new Date();
      if (this.isQuietHours(now)) return;

      const quota = storage.getTodayQuotaUsage();
      if (quota.isDailyCapped || quota.isSlotCapped) return;

      const queue = storage.getQueue();
      if (queue.length === 0) return;

      console.log(`[Queue Worker] Slot capacity open (${quota.dailyRemaining} daily remaining). Processing queued rollover job...`);
      const nextJob = queue[0];
      storage.removeQueueJob(nextJob.id);
      this.dispatchWhatsAppMessage(nextJob.txId);
    }, 15000); // Check every 15s
  }

  /**
   * Automatically re-process pending bills when WhatsApp connects or re-establishes socket
   */
  retryPendingMessages() {
    const config = storage.getConfig();
    const storeCode = (config.storeCode || 'STORE_DEMO_01').toUpperCase();
    const pendingTxs = storage.getTransactions(100).filter(t => 
      (t.storeCode || 'STORE_DEMO_01').toUpperCase() === storeCode &&
      t.status === 'PENDING_WHATSAPP_LINK' &&
      t.customerPhone &&
      t.customerPhone !== 'N/A' &&
      t.customerPhone.length >= 10
    );

    if (pendingTxs.length > 0) {
      console.log(`[WhatsApp Dispatcher] 🔄 Re-enqueuing ${pendingTxs.length} pending bill(s) captured during connection transition...`);
      for (const tx of pendingTxs) {
        this.enqueueForPacedDispatch(tx.id);
      }
    }
  }
}
