import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion, 
  makeCacheableSignalKeyStore 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';

console.log('Testing Baileys exports...');
console.log('makeWASocket:', typeof makeWASocket);
console.log('useMultiFileAuthState:', typeof useMultiFileAuthState);
console.log('DisconnectReason:', DisconnectReason);
