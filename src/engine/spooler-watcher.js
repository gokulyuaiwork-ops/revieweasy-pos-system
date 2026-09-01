import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { storage } from './storage.js';
import { parseReceiptStream } from './parser.js';

export class SpoolerWatcher {
  constructor(dispatcher, broadcastCallback) {
    this.dispatcher = dispatcher;
    this.broadcast = broadcastCallback || (() => {});
    this.spoolDirs = [
      process.platform === 'win32' ? 'C:\\Windows\\System32\\spool\\PRINTERS' : null,
      path.resolve('./data/spool_virtual'),
      path.resolve('./data/spool_drop')
    ].filter(Boolean);
    this.watchers = [];
    this.isWatching = false;
    this.processedHashes = new Map(); // hash -> timestamp
    this.activePollers = new Set(); // filePaths currently being polled
  }

  start() {
    for (const dir of this.spoolDirs) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const watcher = fs.watch(dir, (eventType, filename) => {
          if (filename && (filename.toLowerCase().endsWith('.spl') || filename.toLowerCase().endsWith('.txt') || filename.toLowerCase().endsWith('.prn'))) {
            this.handleSpoolFileEvent(path.join(dir, filename), filename);
          }
        });

        this.watchers.push(watcher);
        console.log(`[Spooler Watcher] 👁️ Actively monitoring: ${dir}`);
      } catch (err) {
        console.warn(`[Spooler Watcher] Note on ${dir}: ${err.message}.`);
      }
    }
    this.isWatching = true;
  }

  /**
   * Resilient Stabilization Poller for Windows Spooler Files
   * Handles 0-byte initial allocations, save dialog delays, and locked write streams
   */
  handleSpoolFileEvent(filePath, filename) {
    const key = `${filePath}_${Date.now()}`;

    // Prevent concurrent duplicate pollers on the exact same active path
    if (this.activePollers.has(filePath)) {
      return;
    }

    this.activePollers.add(filePath);
    let attempts = 0;
    const maxAttempts = 40; // 40 * 250ms = 10 seconds wait window
    let lastSize = -1;
    let stableCount = 0;

    const pollTimer = setInterval(() => {
      attempts++;

      try {
        if (!fs.existsSync(filePath)) {
          clearInterval(pollTimer);
          this.activePollers.delete(filePath);
          return;
        }

        const stat = fs.statSync(filePath);
        const currentSize = stat.size;

        // Check if file has flushed data
        if (currentSize > 0) {
          if (currentSize === lastSize) {
            stableCount++;
          } else {
            stableCount = 0;
            lastSize = currentSize;
          }

          // When file size is stable for 2 consecutive polls (500ms) or reached max attempts
          if (stableCount >= 2 || attempts >= maxAttempts) {
            clearInterval(pollTimer);
            this.activePollers.delete(filePath);

            try {
              const buffer = fs.readFileSync(filePath);
              if (buffer && buffer.length > 0) {
                // Hash de-duplication: Only ignore if the exact same buffer was parsed in the last 10s
                const hash = crypto.createHash('md5').update(buffer).digest('hex');
                const lastProcessed = this.processedHashes.get(hash);
                const now = Date.now();

                if (lastProcessed && (now - lastProcessed < 10000)) {
                  return; // Same print job duplicate event
                }

                this.processedHashes.set(hash, now);
                console.log(`[Spooler Watcher] 🖨️ Intercepted print job: ${filename} (${buffer.length} bytes)`);
                storage.incrementMetric('totalPrintsIntercepted');

                const parsed = parseReceiptStream(buffer);
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
        // EBUSY while Windows spoolsv is actively streaming bytes
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        this.activePollers.delete(filePath);
      }
    }, 250);
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
