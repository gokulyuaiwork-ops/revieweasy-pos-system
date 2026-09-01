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
    this.processedSpoolFiles = new Map(); // filename -> timestamp
    this.activePollers = new Set(); // filenames currently being polled
  }

  start() {
    try {
      if (!fs.existsSync(this.spoolDir)) {
        fs.mkdirSync(this.spoolDir, { recursive: true });
      }

      this.watcher = fs.watch(this.spoolDir, (eventType, filename) => {
        if (filename && filename.toLowerCase().endsWith('.spl')) {
          this.handleSpoolFileEvent(filename);
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
   * Resilient Stabilization Poller for Windows Spooler Files
   * Handles 0-byte initial allocations, save dialog delays, and locked write streams
   */
  handleSpoolFileEvent(filename) {
    const now = Date.now();

    // 1. De-duplicate: If this file was already successfully processed in the last 30 seconds, ignore
    const lastProcessed = this.processedSpoolFiles.get(filename);
    if (lastProcessed && (now - lastProcessed < 30000)) {
      return;
    }

    // 2. Prevent concurrent polling loops on the same file
    if (this.activePollers.has(filename)) {
      return;
    }

    this.activePollers.add(filename);
    const filePath = path.join(this.spoolDir, filename);

    let attempts = 0;
    const maxAttempts = 35; // 35 * 300ms = 10.5 seconds max wait window
    let lastSize = -1;
    let stableCount = 0;

    const pollTimer = setInterval(() => {
      attempts++;

      try {
        if (!fs.existsSync(filePath)) {
          // File was deleted or moved by Windows spoolsv
          clearInterval(pollTimer);
          this.activePollers.delete(filename);
          return;
        }

        const stat = fs.statSync(filePath);
        const currentSize = stat.size;

        // Check if file has data
        if (currentSize > 0) {
          if (currentSize === lastSize) {
            stableCount++;
          } else {
            stableCount = 0;
            lastSize = currentSize;
          }

          // When file size is stable for 2 consecutive checks (600ms) or reached max attempts
          if (stableCount >= 2 || attempts >= maxAttempts) {
            clearInterval(pollTimer);
            this.activePollers.delete(filename);

            try {
              const buffer = fs.readFileSync(filePath);
              if (buffer && buffer.length > 0) {
                console.log(`[Spooler Watcher] 🖨️ Intercepted stabilized spool file: ${filename} (${buffer.length} bytes)`);
                storage.incrementMetric('totalPrintsIntercepted');

                const parsed = parseReceiptStream(buffer);
                this.processedSpoolFiles.set(filename, Date.now());

                const tx = this.dispatcher.processIncomingBill({
                  source: 'WINDOWS_PRINT_SPOOLER',
                  spoolFile: filename,
                  ...parsed
                });
                this.broadcast('NEW_PRINT_JOB', { source: 'SPOOLER', tx });
              }
            } catch (readErr) {
              console.warn(`[Spooler Watcher] Spool file read warning (${filename}):`, readErr.message);
            }
            return;
          }
        }
      } catch (err) {
        // EBUSY or locked by Windows spoolsv while writing
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        this.activePollers.delete(filename);
      }
    }, 300);
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
