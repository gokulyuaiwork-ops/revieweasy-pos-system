import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion, 
  makeCacheableSignalKeyStore 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';

const sessionDir = path.resolve('./data/sessions/test_session');
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
const { version } = await fetchLatestBaileysVersion();
console.log('Baileys version:', version);

const logger = pino({ level: 'silent' });

const sock = makeWASocket({
  version,
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger)
  },
  logger,
  printQRInTerminal: true,
  browser: ['ReviewEasy Desktop Agent', 'Chrome', '124.0.0.0']
});

sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', async (update) => {
  const { connection, qr, lastDisconnect } = update;
  if (qr) {
    console.log('\n✅ REAL WHATSAPP META QR STRING RECEIVED:');
    console.log(qr.slice(0, 50) + '...');
    const dataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
    console.log('Generated QR Data URL length:', dataUrl.length);
    console.log('Test successful! Closing socket.');
    sock.end(undefined);
    process.exit(0);
  }
  if (connection === 'close') {
    console.log('Connection closed:', lastDisconnect?.error?.message);
  }
});
