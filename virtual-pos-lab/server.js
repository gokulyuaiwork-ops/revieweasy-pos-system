import express from 'express';
import path from 'path';
import net from 'net';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.LAB_PORT || 3001;

app.use(express.json());
app.use(express.static(__dirname));

// Stream raw ESC/POS binary commands directly over TCP 127.0.0.1:9100
app.post('/api/lab/send-raw-tcp', (req, res) => {
  const { rawText, host = '127.0.0.1', port = 9100 } = req.body;
  if (!rawText) {
    return res.status(400).json({ success: false, error: 'rawText is required' });
  }

  try {
    // Construct real binary ESC/POS thermal receipt stream
    const initCmd = Buffer.from([0x1B, 0x40]); // ESC @ (Initialize printer)
    const textBuffer = Buffer.from(rawText, 'utf-8');
    const feedCutCmd = Buffer.from([0x1B, 0x64, 0x03, 0x1D, 0x56, 0x41, 0x00]); // Feed 3 lines & Cut paper
    const escposPayload = Buffer.concat([initCmd, textBuffer, feedCutCmd]);

    const client = net.connect({ host, port: Number(port) }, () => {
      console.log(`[Virtual POS Lab] 🖨️ Transmitted ${escposPayload.length} raw ESC/POS bytes to TCP ${host}:${port}`);
      client.write(escposPayload);
      client.end();
    });

    client.on('error', (err) => {
      console.error(`[Virtual POS Lab] TCP Error connecting to ${host}:${port}:`, err.message);
      res.status(500).json({ 
        success: false, 
        error: `Could not connect to TCP 9100 on ${host}:${port}. Error: ${err.message}` 
      });
    });

    client.on('close', () => {
      res.json({ 
        success: true, 
        bytesSent: escposPayload.length, 
        mode: 'TCP_9100_RAW_ESCPOS',
        target: `${host}:${port}`
      });
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🛒 VIRTUAL POS & THERMAL PRINTER LAB READY`);
  console.log(`📍 Web URL: http://localhost:${PORT}`);
  console.log(`🔗 Connected To: ReviewEasy Production Engine (:3000)`);
  console.log(`📡 Real Raw TCP Streamer: 127.0.0.1:9100`);
  console.log(`========================================================\n`);
});
