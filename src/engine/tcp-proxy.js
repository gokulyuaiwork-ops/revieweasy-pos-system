import net from 'net';
import { storage } from './storage.js';
import { parseReceiptStream } from './parser.js';

export class Tcp9100ProxyServer {
  constructor(dispatcher, broadcastCallback) {
    this.dispatcher = dispatcher;
    this.broadcast = broadcastCallback || (() => {});
    this.server = null;
    this.port = 9100;
    this.isRunning = false;
  }

  start(port = 9100) {
    this.port = port;
    try {
      this.server = net.createServer((socket) => {
        const clientIp = socket.remoteAddress;
        console.log(`[TCP 9100 Proxy] Incoming raw print connection from: ${clientIp}`);
        storage.incrementMetric('totalPrintsIntercepted');
        storage.incrementMetric('tcp9100Intercepted');

        const chunks = [];

        socket.on('data', (chunk) => {
          chunks.push(chunk);
          // In real deployment with physical printer: forward chunk to physical printer IP
          // const forwarder = net.connect({ host: targetIp, port: 9100 });
          // forwarder.write(chunk);
        });

        socket.on('end', () => {
          const buffer = Buffer.concat(chunks);
          console.log(`[TCP 9100 Proxy] Complete stream received (${buffer.length} bytes)`);

          // Process and parse payload
          const parsed = parseReceiptStream(buffer);
          
          // Dispatch to ReviewEasy pipeline
          const tx = this.dispatcher.processIncomingBill({
            source: 'TCP_9100_NETWORK_STREAM',
            clientIp,
            rawLength: buffer.length,
            ...parsed
          });

          this.broadcast('NEW_PRINT_JOB', { source: 'TCP_9100', tx });
        });

        socket.on('error', (err) => {
          console.error(`[TCP 9100 Proxy] Socket error:`, err.message);
        });
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[TCP 9100 Proxy] Port ${this.port} in use. Will retry or use alternate virtual port.`);
        } else {
          console.error(`[TCP 9100 Proxy] Server error:`, err.message);
        }
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        this.isRunning = true;
        console.log(`[TCP 9100 Proxy] Interceptor active on 0.0.0.0:${this.port} (Category A1 ready)`);
      });
    } catch (err) {
      console.error('[TCP 9100 Proxy] Failed to start:', err.message);
    }
  }

  stop() {
    if (this.server && this.isRunning) {
      this.server.close();
      this.isRunning = false;
      console.log('[TCP 9100 Proxy] Stopped');
    }
  }
}
