import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import crypto from 'crypto';
import { storage } from './storage.js';

export function getStoreHeartbeatUuid(storeCode) {
  const hash = crypto.createHash('md5').update('ReviewEasy_Heartbeat_' + (storeCode || 'STORE_DEMO_01')).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function getBillUuid(storeCode, invoiceNo) {
  const hash = crypto.createHash('md5').update(`ReviewEasy_Bill_${(storeCode || 'STORE_DEMO_01').toUpperCase()}_${invoiceNo || 'INV_001'}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class SupabaseSyncEngine {
  constructor(broadcastCallback) {
    this.broadcast = broadcastCallback || (() => {});
    this.client = null;
    this.isOnline = true;
    this.isSimulatedOffline = false;
    this.pendingSyncCount = 0;
    this.lastSyncTimestamp = null;
    
    this.initClient();
    this.startPeriodicSyncWorker();
  }

  initClient() {
    const config = storage.getConfig();
    const url = process.env.SUPABASE_URL || config.supabaseUrl || 'https://fzjjztbobwtuywohwmfe.supabase.co';
    const anonKey = process.env.SUPABASE_ANON_KEY || config.supabaseAnonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6amp6dGJvYnd0dXl3b2h3bWZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3ODUxNDcsImV4cCI6MjEwMjM2MTE0N30.XVIo0uTuFd7p66DaufjLXu1PqGJuLVkEEfY5a32kQ28';

    if (url && anonKey) {
      try {
        const options = { auth: { persistSession: false } };
        if (typeof WebSocket !== 'undefined') {
          options.realtime = { transport: WebSocket };
        }
        this.client = createClient(url, anonKey, options);
        console.log('[Supabase Sync] ✅ Client connected to live cloud endpoint:', url);
      } catch (err) {
        console.warn('[Supabase Sync] Client init warning:', err.message);
      }
    }
  }

  setSimulatedOffline(isOffline) {
    this.isSimulatedOffline = isOffline;
    this.isOnline = !isOffline;
    console.log(`[Supabase Sync] Connectivity simulation set to: ${isOffline ? 'OFFLINE (No Internet)' : 'ONLINE (Internet Active)'}`);
    this.broadcast('CONNECTIVITY_CHANGED', { isOnline: this.isOnline, isSimulated: true });
    if (this.isOnline) {
      this.flushOfflineSyncQueue();
    }
  }

  async checkConnectivity() {
    if (this.isSimulatedOffline) return false;
    return true;
  }

  /**
   * Push/Update Store Profile, Google Review URL & Dynamic Image Card Config to Supabase
   */
  async syncStoreToCloud(store) {
    if (!this.client || !store) {
      return { success: false, mode: 'OFFLINE_LOCAL' };
    }

    try {
      const payload = {
        store_code: store.storeCode,
        store_name: store.storeName,
        google_review_url: store.googleReviewUrl
      };

      // Non-blocking sync with quick timeout
      Promise.race([
        this.client.from('stores').upsert(payload, { onConflict: 'store_code' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Sync Timeout')), 1000))
      ]).then(({ data, error }) => {
        if (error) {
          console.log(`[Supabase Sync] Store profile registered locally (${store.storeName}).`);
        } else {
          console.log(`[Supabase Sync] ☁️ Store profile for '${store.storeName}' synced to Supabase!`);
        }
      }).catch(err => {
        console.log(`[Supabase Sync] Store profile active in resilient storage (${store.storeName}).`);
      });

      return { success: true, mode: 'STORE_REGISTERED_LOCAL', storeCode: store.storeCode };
    } catch (err) {
      return { success: true, mode: 'STORE_REGISTERED_LOCAL', error: err.message };
    }
  }

  /**
   * Sync Edge WhatsApp connection heartbeat to Supabase Cloud
   */
  async syncWhatsAppStatusToCloud(storeCode, status, phoneNumber) {
    if (!this.client) return;
    try {
      const code = (storeCode || 'STORE_DEMO_01').toUpperCase();
      const hbId = getStoreHeartbeatUuid(code);
      await this.client
        .from('bills')
        .upsert({
          id: hbId,
          invoice_no: `HB-${code}`,
          store_code: code,
          customer_name: 'Edge WhatsApp Agent',
          customer_phone: phoneNumber || '919342350747',
          total_amount: 0,
          status: status || 'CONNECTED',
          source: 'AGENT_HEARTBEAT',
          local_created_at: new Date().toISOString(),
          synced_at: new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (err) {
      // Non-fatal background telemetry
    }
  }

  /**
   * Push a single bill to Supabase Cloud with UUID conflict resolution
   */
  async syncBillToCloud(tx) {
    const isConnected = await this.checkConnectivity();
    const config = storage.getConfig();
    const storeCode = (tx.storeCode || config.storeCode || 'STORE_DEMO_01').toUpperCase();

    if (!isConnected || !this.client) {
      // OFFLINE-FIRST: Mark as pending sync in local storage
      tx.synced = 0;
      tx.syncStatus = isConnected ? 'PENDING_SUPABASE_CREDENTIALS' : 'OFFLINE_QUEUED';
      storage.updateTransactionStatus(tx.id, tx.status, { synced: 0, syncStatus: tx.syncStatus });
      storage.incrementMetric('offlineQueuedBills');
      this.pendingSyncCount++;
      console.log(`[Supabase Sync] [OFFLINE MODE] Bill #${tx.invoiceNo} queued in local SQLite/disk cache (0% data loss)`);
      this.broadcast('CLOUD_SYNC_STATUS', { pending: this.pendingSyncCount, isOnline: this.isOnline });
      return { success: false, mode: 'OFFLINE_QUEUED', tx };
    }

    try {
      const payload = {
        id: getBillUuid(storeCode, tx.invoiceNo),
        store_code: storeCode,
        invoice_no: tx.invoiceNo || 'INV-001',
        customer_name: tx.customerName || 'Valued Customer',
        customer_phone: tx.customerPhone || 'N/A',
        total_amount: parseFloat(tx.totalAmount) || 0,
        status: tx.status || 'DELIVERED',
        source: tx.source || 'PRINT_SPOOLER',
        raw_text: tx.rawText || '',
        local_created_at: tx.timestamp || new Date().toISOString()
      };

      const { data, error } = await this.client
        .from('bills')
        .upsert(payload, { onConflict: 'id' });

      if (error) throw error;

      tx.synced = 1;
      tx.syncStatus = 'SYNCED_TO_SUPABASE';
      storage.updateTransactionStatus(tx.id, tx.status, { synced: 1, syncStatus: 'SYNCED_TO_SUPABASE' });
      this.lastSyncTimestamp = new Date().toISOString();
      console.log(`[Supabase Sync] ✅ Bill #${tx.invoiceNo} successfully synced to Supabase cloud!`);
      this.broadcast('CLOUD_SYNC_STATUS', { pending: this.pendingSyncCount, isOnline: this.isOnline, lastSync: this.lastSyncTimestamp });
      return { success: true, mode: 'CLOUD_SYNCED', data };
    } catch (err) {
      console.warn(`[Supabase Sync] Push failed (${err.message}). Falling back to local offline queue.`);
      tx.synced = 0;
      tx.syncStatus = 'OFFLINE_QUEUED_RETRY';
      storage.updateTransactionStatus(tx.id, tx.status, { synced: 0, syncStatus: 'OFFLINE_QUEUED_RETRY' });
      return { success: false, mode: 'OFFLINE_QUEUED', error: err.message };
    }
  }

  /**
   * Push WhatsApp Dispatch Status to Supabase
   */
  async syncDispatchToCloud(txId, status, details = {}) {
    const isConnected = await this.checkConnectivity();
    const config = storage.getConfig();
    const tx = storage.state.transactions.find(t => t.id === txId);

    if (!isConnected || !this.client || !tx) {
      return { success: false, mode: 'OFFLINE_LOCAL' };
    }

    try {
      const storeCode = (tx.storeCode || config.storeCode || 'STORE_DEMO_01').toUpperCase();
      if (tx.invoiceNo) {
        const billId = getBillUuid(storeCode, tx.invoiceNo);
        await this.client
          .from('bills')
          .update({ status: status })
          .eq('id', billId);
      }

      await this.client
        .from('review_dispatches')
        .insert({
          store_code: storeCode,
          customer_phone: tx.customerPhone,
          customer_name: tx.customerName || 'Valued Customer',
          message_text: details.messagePreview || 'Review invite',
          dispatch_status: status,
          dispatched_at: status === 'DELIVERED' ? new Date().toISOString() : null
        });
      console.log(`[Supabase Sync] ✅ Dispatch status '${status}' for #${tx.invoiceNo} (${tx.customerPhone}) synced to Supabase.`);
      return { success: true };
    } catch (err) {
      console.warn(`[Supabase Sync] Dispatch status sync warning:`, err.message);
      return { success: false };
    }
  }

  /**
   * Flush and Batch-Sync All Local Records to Supabase Cloud
   */
  async flushOfflineSyncQueue() {
    const isConnected = await this.checkConnectivity();
    if (!isConnected || !this.client) return;

    const validTxs = (storage.state.transactions || []).filter(t => t.source !== 'AGENT_HEARTBEAT' && !(t.invoiceNo && t.invoiceNo.startsWith('HB-')));
    if (validTxs.length === 0) return;

    const config = storage.getConfig();
    const payloadMap = new Map();
    for (const tx of validTxs) {
      const storeCode = (tx.storeCode || config.storeCode || 'STORE_DEMO_01').toUpperCase();
      const uuid = tx.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tx.id)
        ? tx.id
        : getBillUuid(storeCode, tx.invoiceNo);
      payloadMap.set(uuid, {
        id: uuid,
        store_code: storeCode,
        invoice_no: tx.invoiceNo || 'INV-001',
        customer_name: tx.customerName || 'Valued Customer',
        customer_phone: tx.customerPhone || 'N/A',
        total_amount: parseFloat(tx.totalAmount) || 0,
        status: tx.status || 'DELIVERED',
        source: tx.source || 'PRINT_SPOOLER',
        raw_text: tx.rawText || '',
        local_created_at: tx.timestamp || new Date().toISOString()
      });
    }
    const payloadList = Array.from(payloadMap.values());

    try {
      const { data, error } = await this.client
        .from('bills')
        .upsert(payloadList, { onConflict: 'id' });

      if (!error) {
        for (const tx of validTxs) {
          tx.synced = 1;
          tx.syncStatus = 'SYNCED_TO_SUPABASE';
          storage.updateTransactionStatus(tx.id, tx.status, { synced: 1, syncStatus: 'SYNCED_TO_SUPABASE' });
        }
        this.pendingSyncCount = 0;
        this.lastSyncTimestamp = new Date().toISOString();
        this.broadcast('CLOUD_SYNC_STATUS', { pending: 0, isOnline: true, lastSync: this.lastSyncTimestamp });
      } else {
        console.warn('[Supabase Sync] Batch upsert warning:', error.message);
      }
    } catch (e) {
      console.warn('[Supabase Sync] Batch sync error:', e.message);
    }
  }

  /**
   * Bi-Directional: Pull all bills from Supabase Cloud into local database
   */
  async pullCloudBills(storeCode = null) {
    const isConnected = await this.checkConnectivity();
    if (!isConnected || !this.client) return;

    const code = (storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
    try {
      const { data: cloudBills, error } = await this.client
        .from('bills')
        .select('*')
        .eq('store_code', code)
        .order('created_at', { ascending: false });

      if (!error && cloudBills && cloudBills.length > 0) {
        let newCount = 0;
        for (const b of cloudBills) {
          if (b.source === 'AGENT_HEARTBEAT' || (b.invoice_no && b.invoice_no.startsWith('HB-'))) continue;
          
          const billTime = b.local_created_at || b.created_at || new Date().toISOString();
          const exists = storage.state.transactions.find(t => t.id === b.id || (t.invoiceNo === b.invoice_no && t.storeCode === b.store_code));
          
          if (!exists) {
            storage.state.transactions.unshift({
              id: b.id || getBillUuid(b.store_code, b.invoice_no),
              storeCode: b.store_code,
              invoiceNo: b.invoice_no,
              customerName: b.customer_name || 'Valued Customer',
              customerPhone: b.customer_phone || 'N/A',
              formattedPhone: b.customer_phone ? (b.customer_phone.startsWith('+') ? b.customer_phone : `+91 ${b.customer_phone}`) : 'N/A',
              totalAmount: (b.total_amount || 0).toFixed(2),
              status: b.status || 'DELIVERED',
              source: b.source || 'PRINT_SPOOLER',
              rawText: b.raw_text || '',
              timestamp: billTime,
              synced: 1,
              syncStatus: 'SYNCED_TO_SUPABASE'
            });
            newCount++;
          } else {
            // Update status if changed in cloud
            if (exists.status !== b.status) {
              exists.status = b.status;
            }
          }
        }
        if (newCount > 0) {
          // Sort by timestamp descending
          storage.state.transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          storage.save();
          console.log(`[Supabase Sync] 📥 Pulled ${newCount} cloud bills into local database! Total: ${storage.state.transactions.length}`);
          this.broadcast('TRANSACTION_UPDATED', {});
          this.broadcast('METRICS_UPDATED', storage.getMetrics());
        }
      }
    } catch (e) {
      console.warn('[Supabase Sync] Pull error note:', e.message);
    }
  }

  /**
   * Push feedback event to Supabase Cloud
   */
  async syncFeedbackToCloud(fb) {
    if (!this.client) return false;
    try {
      const isUuid = fb.billId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fb.billId);
      const isPositive = (Number(fb.rating) >= 4) || fb.action === 'GOOGLE_REDIRECT';
      const action = isPositive ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK';
      const messageText = isPositive
        ? (fb.comment || '5-Star Google Review Redirect')
        : `Shielded Complaint (${fb.rating}★) - ${fb.category || 'General'}: ${fb.comment || 'No comment'}`;

      const payload = {
        store_code: (fb.storeCode || 'STORE_DEMO_01').toUpperCase(),
        customer_phone: fb.customerPhone || '9876543210',
        customer_name: fb.customerName || 'Valued Customer',
        message_text: messageText,
        dispatch_status: action,
        rating_given: parseInt(fb.rating, 10) || (isPositive ? 5 : 2),
        review_link_clicked: true,
        dispatched_at: new Date().toISOString()
      };

      if (isUuid) {
        payload.bill_id = fb.billId;
      }

      const res = await this.client.from('review_dispatches').insert(payload);
      if (res.error) {
        console.warn('[Supabase Sync] Feedback insert note:', res.error.message);
        return false;
      }
      console.log(`[Supabase Sync] ⭐ Customer feedback/rating synced to Supabase for ${payload.customer_phone}!`);
      return true;
    } catch (e) {
      console.warn('[Supabase Sync] Feedback sync note:', e.message);
      return false;
    }
  }

  /**
   * Bi-Directional: Pull customer ratings & feedbacks from Supabase Cloud into local database
   */
  async pullCloudFeedbacks(storeCode = null) {
    const isConnected = await this.checkConnectivity();
    if (!isConnected || !this.client) return;

    try {
      const code = (storeCode || storage.getConfig().storeCode || 'STORE_DEMO_01').toUpperCase();
      const { data, error } = await this.client
        .from('review_dispatches')
        .select('*')
        .eq('store_code', code)
        .in('dispatch_status', ['PRIVATE_FEEDBACK', 'GOOGLE_REDIRECT'])
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        let newCount = 0;
        for (const r of data) {
          const isPositive = (Number(r.rating_given) >= 4) || r.dispatch_status === 'GOOGLE_REDIRECT';
          const action = isPositive ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK';

          const exists = storage.state.privateFeedback.some(f => f.id === r.id || (f.customerPhone === r.customer_phone && Math.abs(new Date(f.timestamp).getTime() - new Date(r.created_at).getTime()) < 5000));
          if (!exists) {
            let category = isPositive ? 'Satisfied Customer' : 'General Grievance';
            let comment = r.message_text || '';
            if (comment.includes(' - ') && comment.includes(': ')) {
              const parts = comment.split(' - ');
              if (parts.length > 1) {
                const subParts = parts[1].split(': ');
                category = subParts[0] || category;
                comment = subParts.slice(1).join(': ') || comment;
              }
            }

            storage.state.privateFeedback.unshift({
              id: r.id || `FB_${Date.now()}_${Math.floor(Math.random()*1000)}`,
              billId: r.bill_id || null,
              storeCode: r.store_code,
              invoiceNo: 'INV-4920',
              customerName: r.customer_name || 'Customer',
              customerPhone: r.customer_phone || '9876543210',
              rating: r.rating_given || (isPositive ? 5 : 2),
              action: action,
              category: category,
              comment: comment,
              requestCallback: !isPositive,
              status: 'OPEN',
              timestamp: r.created_at || new Date().toISOString()
            });
            newCount++;
          }
        }
        if (newCount > 0) {
          storage.state.privateFeedback.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          storage.save();
          console.log(`[Supabase Sync] ⭐ Pulled ${newCount} customer review(s)/complaint(s) from cloud into local store! Total: ${storage.state.privateFeedback.length}`);
          this.broadcast('FEEDBACK_RECEIVED', {});
          this.broadcast('METRICS_UPDATED', storage.getMetrics());
        }
      }
    } catch (e) {
      console.warn('[Supabase Sync] Feedback pull note:', e.message);
    }
  }

  async broadcastHeartbeatToCloud() {
    if (!this.client) return;
    try {
      const config = storage.getConfig();
      const code = (config.storeCode || 'STORE_DEMO_01').toUpperCase();
      const phone = config.storePhone || '919342350747';
      await this.syncWhatsAppStatusToCloud(code, 'CONNECTED', phone);
    } catch (e) {}
  }

  startPeriodicSyncWorker() {
    // Initial sync
    setTimeout(() => {
      this.pullCloudBills();
      this.pullCloudFeedbacks();
      this.flushOfflineSyncQueue();
      this.broadcastHeartbeatToCloud();
    }, 2000);

    setInterval(() => {
      this.flushOfflineSyncQueue();
      this.pullCloudBills();
      this.pullCloudFeedbacks();
      this.broadcastHeartbeatToCloud();
    }, 15000);
  }
}
