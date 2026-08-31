import http from 'http';
import https from 'https';
import { exec } from 'child_process';
import { storage } from './storage.js';

export class SystemResilienceEngine {
  constructor(broadcastCallback) {
    this.broadcast = broadcastCallback || (() => {});
    this.timeOffsetMs = 0;
    this.lastSyncedAt = null;
    this.spoolerStatus = 'HEALTHY';
    this.activePrinterName = 'POS-80 Thermal';
    this.activePrinterStatus = 'Healthy';
    this.activePrinterPort = 'USB001';
    this.detectedPrinters = [];
    this.usbDevices = [
      { name: "POS-80 Thermal Printer", vid: "0483", pid: "5743", port: "USB001", status: "ONLINE" }
    ];

    this.detectInstalledPrinters();
    this.checkSpoolerHealth();

    // Periodically re-check printer status every 30 seconds
    setInterval(() => {
      this.detectInstalledPrinters();
      this.checkSpoolerHealth();
    }, 30000);
  }

  /**
   * Check real-time internet connectivity
   */
  async checkInternet() {
    return new Promise((resolve) => {
      const req = https.request('https://www.google.com', { method: 'HEAD', timeout: 3000 }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  /**
   * Category C1: SNTP / HTTP Date-Header Time Drift Correction (Dead CMOS Battery Fix)
   */
  async syncSystemClockOffset() {
    return new Promise((resolve) => {
      console.log('[System Resilience] Syncing authoritative network time via HTTP Date header...');
      const req = http.request('http://worldtimeapi.org/api/timezone/Asia/Kolkata', { method: 'HEAD', timeout: 5000 }, (res) => {
        const serverDateHeader = res.headers['date'];
        if (serverDateHeader) {
          const authoritativeTime = new Date(serverDateHeader).getTime();
          const localTime = Date.now();
          this.timeOffsetMs = authoritativeTime - localTime;
          this.lastSyncedAt = new Date().toISOString();
          console.log(`[System Resilience] Clock offset calibrated: ${this.timeOffsetMs}ms (Authoritative time: ${new Date(authoritativeTime).toLocaleTimeString()})`);
          resolve({ success: true, offsetMs: this.timeOffsetMs, authoritativeTime });
        } else {
          resolve({ success: false, offsetMs: 0 });
        }
      });

      req.on('error', (err) => {
        console.warn(`[System Resilience] Primary time sync failed (${err.message}). Using local timestamp.`);
        resolve({ success: false, offsetMs: 0 });
      });

      req.end();
    });
  }

  getCorrectedTimestamp() {
    return new Date(Date.now() + this.timeOffsetMs);
  }

  /**
   * Category C4: Windows Print Spooler Watchdog (spoolsv.exe check)
   */
  checkSpoolerHealth() {
    if (process.platform === 'win32') {
      exec('powershell -Command "Get-Service -Name Spooler | Select-Object -ExpandProperty Status"', (err, stdout) => {
        if (!err && stdout) {
          const status = stdout.trim();
          this.spoolerStatus = status === 'Running' ? 'HEALTHY' : 'STOPPED';
          if (status !== 'Running') {
            console.warn('[Watchdog] Spooler service is stopped! Attempting auto-restart...');
            exec('net start Spooler', (startErr) => {
              if (!startErr) console.log('[Watchdog] Spooler restarted successfully.');
            });
          }
        }
      });
    } else {
      this.spoolerStatus = 'HEALTHY';
    }
    return this.spoolerStatus;
  }

  /**
   * Detect real connected/configured Windows printers
   */
  detectInstalledPrinters() {
    if (process.platform === 'win32') {
      exec('powershell -Command "Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName, PrinterStatus, WorkOffline | ConvertTo-Json"', (err, stdout) => {
        if (!err && stdout) {
          try {
            const parsed = JSON.parse(stdout);
            const printers = Array.isArray(parsed) ? parsed : [parsed];
            this.detectedPrinters = printers;

            // Look for POS / Thermal / Receipt printer, or default printer
            const posPrinter = printers.find(p => /pos|thermal|receipt|80|tm-|epson|tvs|citizen|star|bixolon|rpp|bill/i.test(p.Name));
            const defaultPrinter = printers.find(p => p.Default === true);
            const chosen = posPrinter || defaultPrinter || printers[0];

            if (chosen) {
              this.activePrinterName = chosen.Name;
              this.activePrinterStatus = chosen.WorkOffline ? 'Offline' : 'Healthy';
              this.activePrinterPort = chosen.PortName || 'USB001';
            }
          } catch (e) {}
        }
      });
    }
  }

  /**
   * Category A3: USB Device VID/PID Auto-Rebind Simulator / Monitor
   */
  simulateUsbPortHop() {
    const currentDevice = this.usbDevices[0];
    const newPort = currentDevice.port === 'USB001' ? 'USB002' : 'USB001';
    currentDevice.port = newPort;
    currentDevice.name = `POS-80 Thermal Printer (Auto-Rebound to ${newPort})`;
    console.log(`[USB Monitor] WM_DEVICECHANGE: Hardware ID VID_${currentDevice.vid}&PID_${currentDevice.pid} re-bound to ${newPort}`);
    
    this.broadcast('USB_PORT_REBOUND', { device: currentDevice });
    return currentDevice;
  }

  getHealthSummary() {
    const config = storage.getConfig();
    const printerName = config.printerName || this.activePrinterName || 'POS-80 Thermal';
    const printerStatus = this.spoolerStatus === 'STOPPED' ? 'Stopped' : (this.activePrinterStatus || 'Healthy');
    return {
      clockOffsetMs: this.timeOffsetMs,
      lastSyncedAt: this.lastSyncedAt,
      spoolerStatus: `${printerName}: ${printerStatus}`,
      printerName: printerName,
      printerStatus: printerStatus,
      printerPort: this.activePrinterPort || 'USB001',
      usbDevices: this.usbDevices,
      correctedTime: this.getCorrectedTimestamp().toISOString()
    };
  }
}
