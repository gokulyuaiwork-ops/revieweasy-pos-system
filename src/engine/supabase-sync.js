/**
 * ReviewEasy POS - Supabase Cloud Synchronization Engine
 * Lightweight, zero-dependency REST sync using native fetch.
 * Powers real-time Customer Review Shield and feedback reflection between Cloud & Local POS.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fzjjztbobwtuywohwmfe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6amp6dGJvYnd0dXl3b2h3bWZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3ODUxNDcsImV4cCI6MjEwMjM2MTE0N30.XVIo0uTuFd7p66DaufjLXu1PqGJuLVkEEfY5a32kQ28';

export class SupabaseSyncEngine {
  constructor() {
    this.url = SUPABASE_URL;
    this.key = SUPABASE_KEY;
    this.isOnline = true;
    this.pendingSyncCount = 0;
    this.lastSyncTimestamp = null;
  }

  getHeaders() {
    return {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  /**
   * Pushes a customer review or shielded feedback entry to Supabase review_dispatches table.
   */
  async syncFeedbackToCloud(feedback) {
    if (!feedback) return null;
    try {
      const storeCode = (feedback.storeCode || 'STORE_DEMO_01').toUpperCase();
      const rating = Number(feedback.rating) || 5;
      const action = feedback.action || (rating >= (Number(feedback.googleRedirectMinRating) || 4) ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK');
      
      const billRef = feedback.invoiceNo || feedback.billId || '';
      const billTag = billRef ? ` [Bill #${billRef}]` : '';
      const msgText = action === 'PRIVATE_FEEDBACK'
        ? `Shielded Complaint (${rating}★)${billTag} - ${feedback.category || 'Grievance'}: ${feedback.comment || 'No comment'}`
        : `Customer rated ${rating}★${billTag} and was routed to Google.`;

      // In Supabase, bill_id is a UUID column. Only pass valid UUIDs, otherwise keep null to prevent 22P02 Postgres errors
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(feedback.billId || '');
      const billIdForDb = isUuid ? feedback.billId : null;

      const payload = {
        store_code: storeCode,
        bill_id: billIdForDb,
        customer_name: feedback.customerName || 'Valued Customer',
        customer_phone: feedback.customerPhone && feedback.customerPhone !== 'N/A' ? feedback.customerPhone : '',
        rating_given: rating,
        dispatch_status: action,
        message_text: msgText,
        review_link_clicked: true,
        dispatched_at: feedback.timestamp || new Date().toISOString()
      };

      const res = await fetch(`${this.url}/rest/v1/review_dispatches`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn('[SupabaseSync] Cloud feedback insert notice:', res.status, errText);
        return null;
      }

      const rows = await res.json();
      return rows && rows.length > 0 ? rows[0] : null;
    } catch (err) {
      console.warn('[SupabaseSync] Network notice syncing feedback to cloud:', err.message);
      return null;
    }
  }

  /**
   * Pulls feedbacks for a given store (or all stores) from Supabase review_dispatches table.
   */
  async pullCloudFeedbacks(storeCode = null, minTimestamp = 0) {
    try {
      let query = `${this.url}/rest/v1/review_dispatches?dispatch_status=in.(PRIVATE_FEEDBACK,GOOGLE_REDIRECT)&order=created_at.desc&limit=50`;
      if (storeCode) {
        query += `&store_code=eq.${encodeURIComponent(storeCode.toUpperCase())}`;
      }
      if (minTimestamp && minTimestamp > 0) {
        query += `&created_at=gt.${encodeURIComponent(new Date(minTimestamp).toISOString())}`;
      }

      const res = await fetch(query, {
        headers: {
          'apikey': this.key,
          'Authorization': `Bearer ${this.key}`
        }
      });

      if (!res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];

      return rows
        .filter(r => r.dispatch_status === 'PRIVATE_FEEDBACK' || r.dispatch_status === 'GOOGLE_REDIRECT')
        .map(r => {
          let category = 'General Experience';
          let comment = r.message_text || '';
          let invoiceNo = 'N/A';

          const billMatch = comment.match(/\[Bill #([^\]]+)\]/);
          if (billMatch) {
            invoiceNo = billMatch[1];
          }

          if (comment.includes(' - ') && comment.includes(': ')) {
            const parts = comment.split(' - ');
            if (parts.length > 1) {
              const subParts = parts[1].split(': ');
              category = subParts[0] || category;
              comment = subParts.slice(1).join(': ') || comment;
            }
          }
          const rating = Number(r.rating_given) || (r.dispatch_status === 'GOOGLE_REDIRECT' ? 5 : 2);
          return {
            id: r.id,
            storeCode: (r.store_code || 'STORE_DEMO_01').toUpperCase(),
            billId: r.bill_id || 'N/A',
            invoiceNo: invoiceNo,
            customerName: r.customer_name || 'Valued Customer',
            customerPhone: r.customer_phone || 'N/A',
            rating: rating,
            action: r.dispatch_status === 'GOOGLE_REDIRECT' ? 'GOOGLE_REDIRECT' : 'PRIVATE_FEEDBACK',
            category: category,
            comment: comment,
            requestCallback: true,
            status: r.resolution_status || 'OPEN',
            timestamp: r.created_at || r.dispatched_at || new Date().toISOString()
          };
        });
    } catch (err) {
      console.warn('[SupabaseSync] Notice pulling cloud feedbacks:', err.message);
      return [];
    }
  }

  /**
   * Updates resolution status in Supabase.
   */
  async updateFeedbackStatus(id, status) {
    try {
      await fetch(`${this.url}/rest/v1/review_dispatches?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ resolution_status: status })
      });
    } catch (e) {}
  }

  /**
   * Pushes active store config to Supabase bills table under source: 'STORE_CONFIG'.
   * Allows serverless Vercel cloud to immediately resolve store name and Google Place ID without needing long query params.
   */
  async syncStoreConfigToCloud(config) {
    if (!config || !config.storeCode) return null;
    try {
      const storeCode = config.storeCode.trim().toUpperCase();
      const configData = {
        id: storeCode,
        storeCode: storeCode,
        storeName: config.storeName || storeCode,
        storePhone: config.storePhone || '',
        ownerPhone: config.ownerPhone || config.storePhone || '',
        storeGstin: config.storeGstin || '',
        googlePlaceId: config.googlePlaceId || '',
        googleReviewUrl: config.googleReviewUrl || (config.googlePlaceId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(config.googlePlaceId)}` : ''),
        businessCategory: config.businessCategory || 'RESTAURANT_CAFE',
        customWhatsAppTemplate: config.customWhatsAppTemplate || null,
        flyerImageUrl: config.flyerImageUrl || '/assets/default-review-flyer.jpg',
        status: 'ACTIVE'
      };

      const checkRes = await fetch(`${this.url}/rest/v1/bills?source=eq.STORE_CONFIG&store_code=eq.${encodeURIComponent(storeCode)}`, {
        headers: this.getHeaders()
      });
      const existing = await checkRes.json();

      if (Array.isArray(existing) && existing.length > 0) {
        const rowId = existing[0].id;
        await fetch(`${this.url}/rest/v1/bills?id=eq.${encodeURIComponent(rowId)}`, {
          method: 'PATCH',
          headers: this.getHeaders(),
          body: JSON.stringify({
            invoice_no: `CFG-${storeCode}`,
            customer_name: configData.storeName,
            customer_phone: configData.storePhone,
            raw_text: JSON.stringify(configData),
            status: 'ACTIVE'
          })
        });
      } else {
        await fetch(`${this.url}/rest/v1/bills`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            store_code: storeCode,
            invoice_no: `CFG-${storeCode}`,
            customer_name: configData.storeName,
            customer_phone: configData.storePhone,
            total_amount: 0,
            status: 'ACTIVE',
            source: 'STORE_CONFIG',
            raw_text: JSON.stringify(configData)
          })
        });
      }
      console.log(`[SupabaseSync] ☁️ Store config synced to cloud for [${storeCode}] (${configData.storeName})`);
      return configData;
    } catch (err) {
      console.warn('[SupabaseSync] Error syncing store config to cloud:', err.message);
      return null;
    }
  }

  /**
   * Pushes a transaction bill to Supabase bills table so cloud review landing page can hydrate customer and invoice data.
   */
  async syncBillToCloud(tx) {
    if (!tx) return null;
    try {
      const storeCode = (tx.storeCode || 'STORE_DEMO_01').toUpperCase();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tx.id || '');
      
      const payload = {
        store_code: storeCode,
        invoice_no: tx.invoiceNo || 'N/A',
        customer_name: tx.customerName || 'Valued Customer',
        customer_phone: tx.customerPhone && tx.customerPhone !== 'N/A' ? tx.customerPhone : '',
        total_amount: parseFloat(tx.totalAmount) || 0,
        status: tx.status || 'DELIVERED',
        source: tx.source || 'PRINT_SPOOLER',
        raw_text: tx.rawText || '',
        local_created_at: tx.timestamp || new Date().toISOString()
      };
      if (isUuid) {
        payload.id = tx.id;
      }

      const res = await fetch(`${this.url}/rest/v1/bills`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn('[SupabaseSync] Bill sync notice:', res.status, errText);
        return null;
      }
      const data = await res.json();
      return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (err) {
      console.warn('[SupabaseSync] Error syncing bill to cloud:', err.message);
      return null;
    }
  }

  /**
   * Syncs a dispatch event or status update to Supabase cloud.
   */
  async syncDispatchToCloud(txId, status, details = {}) {
    if (!txId) return null;
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txId);
      if (isUuid) {
        await fetch(`${this.url}/rest/v1/bills?id=eq.${encodeURIComponent(txId)}`, {
          method: 'PATCH',
          headers: this.getHeaders(),
          body: JSON.stringify({ status })
        }).catch(() => {});
      }
      return { success: true, txId, status };
    } catch (err) {
      console.warn('[SupabaseSync] Notice syncing dispatch status to cloud:', err.message);
      return null;
    }
  }

  async syncStoreToCloud(store) {
    return this.syncStoreConfigToCloud(store);
  }

  async deleteStoreFromCloud(storeCode) {
    try {
      const code = storeCode.toUpperCase();
      await fetch(`${this.url}/rest/v1/bills?source=eq.STORE_CONFIG&store_code=eq.${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ status: 'DELETED' })
      });
    } catch (e) {}
  }

  async pullCloudStores() {
    try {
      const res = await fetch(`${this.url}/rest/v1/bills?source=eq.STORE_CONFIG&status=neq.DELETED`, {
        headers: {
          'apikey': this.key,
          'Authorization': `Bearer ${this.key}`
        }
      });
      if (!res.ok) return [];
      const rows = await res.json();
      return (rows || []).map(r => {
        try {
          return typeof r.raw_text === 'string' ? JSON.parse(r.raw_text) : r.raw_text;
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  async pullCloudBills(storeCode) {
    try {
      let url = `${this.url}/rest/v1/bills?order=created_at.desc&limit=50`;
      if (storeCode) url += `&store_code=eq.${encodeURIComponent(storeCode.toUpperCase())}`;
      const res = await fetch(url, {
        headers: {
          'apikey': this.key,
          'Authorization': `Bearer ${this.key}`
        }
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      return [];
    }
  }

  async getStoreConfig(storeCode) {
    if (!storeCode) return null;
    try {
      const code = storeCode.trim().toUpperCase();
      const res = await fetch(`${this.url}/rest/v1/bills?source=eq.STORE_CONFIG&store_code=eq.${encodeURIComponent(code)}&status=neq.DELETED&limit=1`, {
        headers: this.getHeaders()
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const row = data[0];
        const cfg = typeof row.raw_text === 'string' ? JSON.parse(row.raw_text) : row.raw_text;
        const placeId = cfg.googlePlaceId || '';
        const reviewUrl = (cfg.googleReviewUrl && !cfg.googleReviewUrl.includes('outbid'))
          ? cfg.googleReviewUrl
          : (placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : '');
        let effectiveName = cfg.storeName || row.customer_name || code;
        if (code === 'RUCHI-KABAB' && effectiveName === 'Gokul Hotel') {
          effectiveName = 'RUCHI KABAB';
        }
        return {
          id: code,
          storeCode: code,
          storeName: effectiveName,
          storePhone: cfg.storePhone || row.customer_phone || '',
          ownerPhone: cfg.ownerPhone || row.customer_phone || '',
          googlePlaceId: placeId,
          googleReviewUrl: reviewUrl,
          businessCategory: cfg.businessCategory || 'RESTAURANT_CAFE'
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async getBill(storeCode, billId) {
    if (!billId) return null;
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(billId);
      let query = `${this.url}/rest/v1/bills?`;
      if (isUuid) {
        query += `or=(id.eq.${billId},invoice_no.eq.${billId})`;
      } else {
        query += `invoice_no=eq.${encodeURIComponent(billId)}`;
      }
      if (storeCode) {
        query += `&store_code=eq.${encodeURIComponent(storeCode.toUpperCase())}`;
      }
      query += `&order=created_at.desc&limit=1`;

      const res = await fetch(query, { headers: this.getHeaders() });
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const b = data[0];
        return {
          id: b.id,
          invoiceNo: b.invoice_no,
          totalAmount: (b.total_amount || 0).toFixed(2),
          customerName: b.customer_name || 'Valued Customer',
          customerPhone: b.customer_phone || ''
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async clearCloudStoreData(storeCode) {
    if (!storeCode) return false;
    try {
      const code = storeCode.toUpperCase();
      const codes = [code];
      if (code === 'GOKUL' || code === 'STORE') {
        codes.push('GOKUL', 'STORE');
      }
      const uniqueCodes = Array.from(new Set(codes)).join(',');

      // Delete dispatches from Supabase
      await fetch(`${this.url}/rest/v1/review_dispatches?store_code=in.(${uniqueCodes})`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });

      // Delete bills from Supabase
      await fetch(`${this.url}/rest/v1/bills?store_code=in.(${uniqueCodes})`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });

      console.log(`[SupabaseSync] 🧹 Cleared cloud bills & dispatches for store: ${uniqueCodes}`);
      return true;
    } catch (e) {
      console.warn('[SupabaseSync] Cloud clear note:', e.message);
      return false;
    }
  }
}
