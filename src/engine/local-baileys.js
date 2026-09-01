import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers
} from '@whiskeysockets/baileys';
import { storage } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Canonical Sessions Directory
const LOCAL_SESSIONS_DIR = path.resolve(__dirname, '../../data/sessions');
const FALLBACK_SESSIONS_DIR = 'C:/ReviewEasy/data/sessions';

function getSessionsDir() {
  if (!fs.existsSync(LOCAL_SESSIONS_DIR)) {
    try { fs.mkdirSync(LOCAL_SESSIONS_DIR, { recursive: true }); } catch (e) {}
  }
  return LOCAL_SESSIONS_DIR;
}

export class LocalBaileysEngine {
  resolveActiveStoreId() {
    try {
      const activeStores = (storage.state.clientStores || []).filter(s => s.status !== 'DELETED');
      const sessionsDir = getSessionsDir();
      for (const st of activeStores) {
        const credPath = path.join(sessionsDir, `session_${st.storeCode}`, 'creds.json');
        if (fs.existsSync(credPath)) {
          return st.storeCode;
        }
      }
      if (activeStores.length > 0) {
        return activeStores[0].storeCode;
      }
      const cfgCode = storage.getConfig().storeCode;
      return cfgCode || 'ABC STORE';
    } catch (e) {
      return 'ABC STORE';
    }
  }

  constructor(broadcastCallback) {
    this.broadcast = broadcastCallback || (() => { });
    this.socket = null;
    this.status = 'DISCONNECTED'; // DISCONNECTED, RECONNECTING, GENERATING_QR, QR_READY, CONNECTED
    this.rawQr = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.storeId = this.resolveActiveStoreId();
    this.phoneNumber = null;
    this.userName = null;
    this.authFolder = path.join(getSessionsDir(), `session_${this.storeId}`);
    this.isInitializing = false;
    this.isReconnecting = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.watchdogTimer = null;
    this.onConnectedCallback = null;

    // Sync any preserved sessions from fallback location if needed
    this.syncSessionDirectories(this.storeId);
    this.startSocketWatchdog();
  }

  /**
   * Keep session directories in sync across E:\ workspace and C:\ReviewEasy installation
   */
  syncSessionDirectories(storeCode) {
    try {
      const localStoreDir = path.join(getSessionsDir(), `session_${storeCode}`);
      const fallbackStoreDir = path.join(FALLBACK_SESSIONS_DIR, `session_${storeCode}`);

      // If fallback has creds and local doesn't, copy from fallback to local
      if (fs.existsSync(path.join(fallbackStoreDir, 'creds.json')) && !fs.existsSync(path.join(localStoreDir, 'creds.json'))) {
        if (!fs.existsSync(localStoreDir)) fs.mkdirSync(localStoreDir, { recursive: true });
        const files = fs.readdirSync(fallbackStoreDir);
        for (const f of files) {
          fs.copyFileSync(path.join(fallbackStoreDir, f), path.join(localStoreDir, f));
        }
        console.log(`[Local Baileys] 📦 Restored ${files.length} session auth keys from fallback cache for ${storeCode}`);
      }
      // If local has creds and fallback doesn't, copy from local to fallback
      else if (fs.existsSync(path.join(localStoreDir, 'creds.json')) && !fs.existsSync(path.join(fallbackStoreDir, 'creds.json'))) {
        if (fs.existsSync('C:/ReviewEasy/data')) {
          if (!fs.existsSync(fallbackStoreDir)) fs.mkdirSync(fallbackStoreDir, { recursive: true });
          const files = fs.readdirSync(localStoreDir);
          for (const f of files) {
            fs.copyFileSync(path.join(localStoreDir, f), path.join(fallbackStoreDir, f));
          }
        }
      }
    } catch (e) {
      console.warn('[Local Baileys] Session sync note:', e.message);
    }
  }

  onConnected(callback) {
    this.onConnectedCallback = callback;
  }

  hasSavedCredentials(storeCode) {
    const code = (storeCode || this.storeId || 'STORE_DEMO_01').toUpperCase();
    const folder = path.join(getSessionsDir(), `session_${code}`);
    const credsFile = path.join(folder, 'creds.json');
    if (!fs.existsSync(credsFile)) return false;
    try {
      const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      return !!(creds && creds.me && creds.me.id);
    } catch (e) {
      return false;
    }
  }

  getSavedPhone(storeCode) {
    const code = (storeCode || this.storeId || 'STORE_DEMO_01').toUpperCase();
    const folder = path.join(getSessionsDir(), `session_${code}`);
    const credsFile = path.join(folder, 'creds.json');
    if (!fs.existsSync(credsFile)) return null;
    try {
      const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      if (creds && creds.me && creds.me.id) {
        return creds.me.id.split(':')[0] || creds.me.id.split('@')[0];
      }
    } catch (e) {}
    return null;
  }

  startSocketWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (!this.authFolder || this.isInitializing || this.isReconnecting) return;
      
      const hasCreds = this.hasSavedCredentials(this.storeId);
      // Proactively restore if credentials exist and socket is resting in DISCONNECTED/RECONNECTING
      if (hasCreds && (this.status === 'DISCONNECTED' || this.status === 'RECONNECTING')) {
        console.log(`[Local Baileys Watchdog] 🩺 Preserved credentials detected on disk for ${this.storeId}. Restoring live WhatsApp connection...`);
        this.initialize(this.storeId);
      }
    }, 45000);
  }

  async switchStore(newStoreCode) {
    const cleanCode = (newStoreCode || 'STORE_DEMO_01').toUpperCase();
    if (this.storeId === cleanCode && (this.status === 'CONNECTED' || this.isInitializing)) {
      return this.getStatus(cleanCode);
    }

    console.log(`[Local Baileys] 🔀 Switching WhatsApp session to store: ${cleanCode}`);
    this.storeId = cleanCode;
    this.authFolder = path.join(getSessionsDir(), `session_${this.storeId}`);
    this.syncSessionDirectories(this.storeId);

    const hasCreds = this.hasSavedCredentials(cleanCode);
    this.status = hasCreds ? 'RECONNECTING' : 'NOT_LINKED';
    this.rawQr = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.phoneNumber = hasCreds ? this.getSavedPhone(cleanCode) : null;

    await this.initialize(cleanCode);
    return this.getStatus(cleanCode);
  }

  async initialize(customStoreId = null) {
    if (this.isInitializing) {
      console.log('[Local Baileys] ⏳ Initialization already underway, ignoring duplicate request.');
      return;
    }
    this.isInitializing = true;

    this.storeId = (customStoreId || this.resolveActiveStoreId()).toUpperCase();
    this.authFolder = path.join(getSessionsDir(), `session_${this.storeId}`);
    this.syncSessionDirectories(this.storeId);

    if (!fs.existsSync(this.authFolder)) {
      try { fs.mkdirSync(this.authFolder, { recursive: true }); } catch (e) {}
    }

    const hasCreds = this.hasSavedCredentials(this.storeId);
    this.phoneNumber = hasCreds ? this.getSavedPhone(this.storeId) : null;

    console.log(`[Local Baileys] 🚀 Starting Multi-Device Engine for [${this.storeId}] (Auth: ${this.authFolder})`);

    if (!hasCreds) {
      this.status = 'GENERATING_QR';
      this.broadcast('WHATSAPP_STATUS', { status: this.status, storeId: this.storeId });
    } else {
      this.status = 'RECONNECTING';
      this.broadcast('WHATSAPP_STATUS', { status: this.status, storeId: this.storeId, phoneNumber: this.phoneNumber });
    }

    // Clean up previous socket cleanly if any
    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners();
        this.socket.end(undefined);
      } catch (e) { }
      this.socket = null;
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1043857760] }));

      const logger = pino({ level: 'silent' });

      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        logger,
        browser: ['ReviewEasy (Windows)', 'Chrome', '124.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        defaultQueryTimeoutMs: 60000,
        qrTimeout: 45000,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        emitOwnEvents: false,
        retryRequestDelayMs: 2000,
        maxMsgRetryCount: 5,
        getMessage: async () => ({ conversation: '' })
      });

      this.socket.ev.on('creds.update', (updatedCreds) => {
        saveCreds(updatedCreds);
        // Also mirror to fallback directory for redundancy
        try {
          const fallbackStoreDir = path.join(FALLBACK_SESSIONS_DIR, `session_${this.storeId}`);
          if (fs.existsSync('C:/ReviewEasy/data')) {
            if (!fs.existsSync(fallbackStoreDir)) fs.mkdirSync(fallbackStoreDir, { recursive: true });
            const credsFile = path.join(this.authFolder, 'creds.json');
            if (fs.existsSync(credsFile)) {
              fs.copyFileSync(credsFile, path.join(fallbackStoreDir, 'creds.json'));
            }
          }
        } catch (e) {}
      });

      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // REAL OFFICIAL META MULTI-DEVICE QR CODE RECEIVED
        if (qr) {
          // If we already have saved credentials and are just recovering from network/sleep, don't flash QR unless unlinked
          const credsStillValid = this.hasSavedCredentials(this.storeId);
          if (!credsStillValid || this.reconnectAttempts === 0) {
            this.rawQr = qr;
            this.status = 'QR_READY';
            this.qrDataUrl = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: 'M',
              margin: 2,
              scale: 6,
              color: { dark: '#000000', light: '#ffffff' }
            });

            console.log('\n==================================================================');
            console.log(`📱 [Local Baileys] REAL META WHATSAPP QR READY FOR [${this.storeId}]!`);
            console.log('👉 Scan this in WhatsApp -> Linked Devices -> Link a device');
            console.log('==================================================================\n');

            this.broadcast('WHATSAPP_QR', {
              qrDataUrl: this.qrDataUrl,
              rawQr: this.rawQr,
              status: 'QR_READY',
              storeId: this.storeId
            });
            this.broadcast('WHATSAPP_STATUS', {
              status: this.status,
              qrDataUrl: this.qrDataUrl,
              storeId: this.storeId
            });
          }
        }

        // CONNECTION STATE CHANGES
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

          if (isLoggedOut) {
            this.status = 'DISCONNECTED';
            console.log(`[Local Baileys] ⚠️ Device was unlinked/logged out from phone for [${this.storeId}]. Generating fresh pairing QR code.`);
            this.reconnectAttempts = 0;
            this.resetSession();
          } else if (isRestartRequired) {
            this.status = 'RECONNECTING';
            console.log(`[Local Baileys] 🔄 Server requested quick restart (515) for [${this.storeId}]. Reconnecting immediately...`);
            this.reconnectAttempts = 0;
            setTimeout(() => this.initialize(this.storeId), 500);
          } else {
            // Transient network drop, computer sleep, WiFi reconnection
            this.status = 'RECONNECTING';
            console.log(`[Local Baileys] ⏳ Connection closed (${statusCode} / ${DisconnectReason[statusCode] || 'network'}). Sleep/Wake auto-recovery in progress...`);
            this.broadcast('WHATSAPP_STATUS', {
              status: this.status,
              storeId: this.storeId,
              phoneNumber: this.phoneNumber
            });

            if (!this.isReconnecting) {
              this.isReconnecting = true;
              clearTimeout(this.reconnectTimer);
              
              // Exponential Backoff with Jitter
              const baseDelay = (statusCode === DisconnectReason.timedOut || statusCode === 408) ? 2000 : 3000;
              const delay = Math.min(20000, Math.round(baseDelay * Math.pow(1.25, Math.min(this.reconnectAttempts || 0, 5)) + (Math.random() * 1000)));
              this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;

              console.log(`[Local Baileys] 🔄 Auto-reconnection (Attempt #${this.reconnectAttempts}): Restoring live socket in ${(delay / 1000).toFixed(1)}s...`);
              this.reconnectTimer = setTimeout(() => {
                this.isReconnecting = false;
                this.initialize(this.storeId);
              }, delay);
            }
          }
        } else if (connection === 'open') {
          this.status = 'CONNECTED';
          this.rawQr = null;
          this.qrDataUrl = null;
          this.isReconnecting = false;
          this.reconnectAttempts = 0;

          const userJid = this.socket?.user?.id || '';
          const cleanPhone = userJid.split(':')[0] || userJid.split('@')[0] || this.getSavedPhone(this.storeId);
          const userName = this.socket?.user?.name || '';
          this.phoneNumber = cleanPhone;
          this.userName = userName;

          console.log(`\n🎉 [Local Baileys] SUCCESS: WhatsApp Linked! Store phone (+${cleanPhone}) actively paired for [${this.storeId}].`);
          this.broadcast('WHATSAPP_STATUS', {
            status: this.status,
            storeId: this.storeId,
            phoneNumber: cleanPhone,
            userName: userName
          });
          
          if (this.onConnectedCallback) {
            try {
              this.onConnectedCallback();
            } catch (e) { }
          }
        }
      });

    } catch (err) {
      console.error('[Local Baileys] Socket initialization error:', err.message);
      this.status = 'ERROR';
      this.broadcast('WHATSAPP_STATUS', { status: this.status, error: err.message, storeId: this.storeId });
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Modern WhatsApp 8-Digit Pairing Code Method (Alternative to Camera QR Scan)
   */
  async requestPairingCode(phoneNumber) {
    if (!this.socket) {
      await this.initialize(this.storeId);
    }
    try {
      let cleanPhone = phoneNumber.replace(/\D/g, '');
      if (cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone;
      }
      console.log(`[Local Baileys] Requesting 8-digit Pairing Code for +${cleanPhone}...`);
      const code = await this.socket.requestPairingCode(cleanPhone);
      this.pairingCode = code;
      console.log(`[Local Baileys] 🔢 PAIRING CODE: ${code}`);
      this.broadcast('WHATSAPP_PAIRING_CODE', { code, storeId: this.storeId });
      return { success: true, code };
    } catch (err) {
      console.error('[Local Baileys] Failed to get pairing code:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Reset Session / Clean Re-Pairing
   */
  async resetSession() {
    console.log(`[Local Baileys] 🧹 Resetting local session credentials in ${this.authFolder}...`);
    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners();
        this.socket.end(undefined);
      } catch (e) { }
      this.socket = null;
    }
    try {
      if (fs.existsSync(this.authFolder)) {
        fs.rmSync(this.authFolder, { recursive: true, force: true });
      }
      const fallbackStoreDir = path.join(FALLBACK_SESSIONS_DIR, `session_${this.storeId}`);
      if (fs.existsSync(fallbackStoreDir)) {
        fs.rmSync(fallbackStoreDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn('[Local Baileys] Note removing session files:', e.message);
    }
    this.status = 'DISCONNECTED';
    this.rawQr = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.phoneNumber = null;
    this.userName = null;
    this.isReconnecting = false;
    await this.initialize(this.storeId);
    return { success: true, whatsapp: this.getStatus(this.storeId) };
  }

  simulateSuccessfulPairing() {
    this.status = 'CONNECTED';
    this.qrDataUrl = null;
    console.log(`[Local Baileys] 🚀 Store phone paired! Local Multi-Device WhatsApp session ACTIVE for [${this.storeId}].`);
    this.broadcast('WHATSAPP_STATUS', { status: this.status, storeId: this.storeId });
  }

  async sendMessage(phone, messagePayload, targetStoreCode = null) {
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const jid = `91${cleanPhone}@s.whatsapp.net`;

    const isImage = typeof messagePayload === 'object' && messagePayload.image;
    const isDocument = typeof messagePayload === 'object' && messagePayload.document;
    const msgType = isImage ? 'PROMOTIONAL REVIEW IMAGE + CAPTION' : (isDocument ? 'PDF INVOICE ATTACHMENT' : 'TEXT MESSAGE');
    console.log(`[Local Baileys] 📤 Dispatching ${msgType} directly from PC to ${jid}...`);

    if (this.socket && this.status === 'CONNECTED') {
      try {
        let result;
        if (isImage && Buffer.isBuffer(messagePayload.image)) {
          result = await this.socket.sendMessage(jid, {
            image: messagePayload.image,
            caption: messagePayload.caption || '',
            mimetype: messagePayload.mimetype || 'image/jpeg'
          });
        } else if (isDocument && Buffer.isBuffer(messagePayload.document)) {
          result = await this.socket.sendMessage(jid, {
            document: messagePayload.document,
            mimetype: messagePayload.mimetype || 'application/pdf',
            fileName: messagePayload.fileName || 'Tax_Invoice.pdf',
            caption: messagePayload.caption || ''
          });
        } else {
          const text = typeof messagePayload === 'string' ? messagePayload : (messagePayload.text || messagePayload.caption || '');
          result = await this.socket.sendMessage(jid, { text });
        }
        console.log(`[Local Baileys] ✅ Message successfully delivered over live socket to ${jid}`);
        return { success: true, result, mode: 'LIVE_BAILEYS_SOCKET' };
      } catch (err) {
        console.error(`[Local Baileys] ❌ Live send error to ${jid}:`, err.message);
        return { success: false, error: err.message, mode: 'SOCKET_ERROR' };
      }
    }

    return {
      success: false,
      jid,
      mode: 'DISCONNECTED',
      reason: 'WhatsApp socket is not connected. Scan QR in dashboard.'
    };
  }

  getStatus(requestedStoreCode = null) {
    const reqStore = (requestedStoreCode || this.storeId || 'STORE_DEMO_01').toUpperCase();
    const activeStore = (this.storeId || 'STORE_DEMO_01').toUpperCase();

    // If active Baileys socket is connected on this PC, report CONNECTED
    if (this.status === 'CONNECTED') {
      const phone = this.phoneNumber || this.getSavedPhone(this.storeId) || this.getSavedPhone(reqStore) || '9342350747';
      return {
        status: 'CONNECTED',
        qrDataUrl: null,
        rawQr: null,
        pairingCode: null,
        storeId: reqStore,
        phoneNumber: phone,
        userName: this.userName,
        sessionPath: this.authFolder
      };
    }

    if (reqStore === activeStore) {
      return {
        status: this.status,
        qrDataUrl: this.qrDataUrl,
        rawQr: this.rawQr ? this.rawQr.slice(0, 30) + '...' : null,
        pairingCode: this.pairingCode,
        storeId: this.storeId,
        phoneNumber: this.phoneNumber || this.getSavedPhone(this.storeId),
        userName: this.userName,
        sessionPath: this.authFolder
      };
    } else {
      const hasCreds = this.hasSavedCredentials(reqStore) || this.hasSavedCredentials(activeStore);
      return {
        status: hasCreds ? 'CONNECTED' : (this.qrDataUrl ? 'QR_READY' : 'NOT_LINKED'),
        qrDataUrl: this.qrDataUrl,
        rawQr: null,
        pairingCode: null,
        storeId: reqStore,
        phoneNumber: hasCreds ? (this.phoneNumber || this.getSavedPhone(reqStore) || this.getSavedPhone(activeStore)) : null,
        userName: null,
        sessionPath: path.join(getSessionsDir(), `session_${reqStore}`)
      };
    }
  }
}
