import fs from 'fs';
import path from 'path';
import { storage } from './storage.js';
import { parseReceiptStream } from './parser.js';

export class SpoolerWatcher {
  constructor(dispatcher, broadcastCallback) {
    this.dispatcher = dispatcher;
    this.broadcast = broadcastCallback || (() => {});
    this.spoolDir = process.platform === 'win32' 
      ? 'C:\\Windows\\System32\\spool\\PRINTERS' 
      : path.resolve('./data/spool_virtual');
    this.watcher = null;
    this.isWatching = false;
  }

  start() {
    try {
      if (!fs.existsSync(this.spoolDir)) {
        fs.mkdirSync(this.spoolDir, { recursive: true });
      }

      this.watcher = fs.watch(this.spoolDir, (eventType, filename) => {
        if (filename && filename.toLowerCase().endsWith('.spl')) {
          const filePath = path.join(this.spoolDir, filename);
          console.log(`[Spooler Watcher] Intercepted new raw print spool file: ${filename}`);
          storage.incrementMetric('totalPrintsIntercepted');

          // Read file after slight delay for Windows spoolsv to complete flush
          setTimeout(() => {
            if (fs.existsSync(filePath)) {
              try {
                const buffer = fs.readFileSync(filePath);
                const parsed = parseReceiptStream(buffer);
                const tx = this.dispatcher.processIncomingBill({
                  source: 'WINDOWS_PRINT_SPOOLER',
                  spoolFile: filename,
                  ...parsed
                });
                this.broadcast('NEW_PRINT_JOB', { source: 'SPOOLER', tx });
              } catch (err) {
                console.error(`[Spooler Watcher] Failed to read ${filename}:`, err.message);
              }
            }
          }, 300);
        }
      });

      this.isWatching = true;
      console.log(`[Spooler Watcher] Actively monitoring: ${this.spoolDir}`);
    } catch (err) {
      console.warn(`[Spooler Watcher] Note on permissions: ${err.message}. Virtual spooler tap active.`);
      this.isWatching = true;
    }
  }

  /**
   * Direct virtual injection hook (used by web POS simulator and test runners)
   */
  injectPrintJob(rawTextOrBuffer, customOptions = {}) {
    storage.incrementMetric('totalPrintsIntercepted');
    const parsed = parseReceiptStream(rawTextOrBuffer);
    const tx = this.dispatcher.processIncomingBill({
      source: customOptions.source || 'VIRTUAL_PRINT_SPOOLER',
      customTimestamp: customOptions.customTimestamp || null,
      storeCode: customOptions.storeCode || null,
      ...parsed
    });
    this.broadcast('NEW_PRINT_JOB', { source: 'VIRTUAL_SPOOLER', tx });
    return tx;
  }
}
