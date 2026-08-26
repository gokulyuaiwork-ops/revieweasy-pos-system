import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { storage } from './storage.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

export class AutoUpdaterEngine {
  constructor(broadcastCallback, localBaileys = null) {
    this.broadcast = broadcastCallback || (() => {});
    this.localBaileys = localBaileys;
    this.packageName = '@whiskeysockets/baileys';
    this.isUpdating = false;
    this.lastCheckTime = null;
    this.currentInstalledVersion = this.getInstalledVersion();
    this.latestAvailableVersion = this.currentInstalledVersion;
    this.updateHistory = [];
    this.checkTimer = null;
  }

  setBaileys(localBaileys) {
    this.localBaileys = localBaileys;
  }

  getInstalledVersion() {
    try {
      const pkgJsonPath = path.join(ROOT_DIR, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        const rawVer = (pkg.dependencies && pkg.dependencies[this.packageName]) || '6.7.8';
        return rawVer.replace(/[\^~>=<]/g, '');
      }
    } catch (e) {
      console.warn('[Auto-Updater] Could not read package.json version:', e.message);
    }
    return '6.7.8';
  }

  /**
   * Check npm registry for the latest stable version of Baileys
   */
  async checkForUpdates() {
    this.lastCheckTime = new Date().toISOString();
    this.currentInstalledVersion = this.getInstalledVersion();

    console.log(`[Auto-Updater] 🔍 Checking for WhatsApp protocol updates (Installed: v${this.currentInstalledVersion})...`);
    this.broadcast('UPDATER_STATUS', { status: 'CHECKING', installedVersion: this.currentInstalledVersion });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(`https://registry.npmjs.org/${this.packageName}/latest`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`NPM Registry returned HTTP ${res.status}`);
      }

      const data = await res.json();
      this.latestAvailableVersion = data.version || this.currentInstalledVersion;

      const hasUpdate = this.compareVersions(this.latestAvailableVersion, this.currentInstalledVersion) > 0;

      const result = {
        hasUpdate,
        packageName: this.packageName,
        installedVersion: this.currentInstalledVersion,
        latestVersion: this.latestAvailableVersion,
        lastChecked: this.lastCheckTime
      };

      if (hasUpdate) {
        console.log(`[Auto-Updater] 🚀 New WhatsApp Protocol Update Found! (v${this.currentInstalledVersion} -> v${this.latestAvailableVersion})`);
        this.broadcast('UPDATER_STATUS', { status: 'UPDATE_AVAILABLE', ...result });
      } else {
        console.log(`[Auto-Updater] ✅ WhatsApp Protocol Engine is up-to-date (v${this.currentInstalledVersion})`);
        this.broadcast('UPDATER_STATUS', { status: 'UP_TO_DATE', ...result });
      }

      return result;
    } catch (err) {
      console.warn(`[Auto-Updater] Could not reach NPM registry (${err.message}). Local engine operating normally.`);
      const result = {
        hasUpdate: false,
        packageName: this.packageName,
        installedVersion: this.currentInstalledVersion,
        latestVersion: this.currentInstalledVersion,
        lastChecked: this.lastCheckTime,
        error: err.message
      };
      this.broadcast('UPDATER_STATUS', { status: 'CHECK_FAILED', ...result });
      return result;
    }
  }

  /**
   * Silently apply package update and gracefully reconnect Baileys
   */
  async applyUpdateSilently() {
    if (this.isUpdating) {
      return { success: false, message: 'Update already in progress' };
    }

    this.isUpdating = true;
    console.log(`[Auto-Updater] ⚙️ Applying silent protocol update for ${this.packageName}...`);
    this.broadcast('UPDATER_STATUS', { status: 'UPDATING', targetVersion: this.latestAvailableVersion });

    try {
      // Execute npm install in the background
      const { stdout, stderr } = await execAsync(`npm install ${this.packageName}@latest --save --no-audit --no-fund`, {
        cwd: ROOT_DIR,
        timeout: 60000
      });

      this.currentInstalledVersion = this.getInstalledVersion();
      const logEntry = {
        timestamp: new Date().toISOString(),
        updatedTo: this.currentInstalledVersion,
        success: true
      };
      this.updateHistory.unshift(logEntry);

      console.log(`[Auto-Updater] 🎉 Successfully updated to ${this.packageName}@v${this.currentInstalledVersion}!`);
      
      // Gracefully reinitialize Baileys with new package definitions
      if (this.localBaileys) {
        console.log('[Auto-Updater] 🔄 Gracefully refreshing WhatsApp multi-device companion session...');
        await this.localBaileys.initialize();
      }

      this.isUpdating = false;
      this.broadcast('UPDATER_STATUS', {
        status: 'UPDATED',
        installedVersion: this.currentInstalledVersion,
        updatedAt: new Date().toISOString()
      });

      return {
        success: true,
        installedVersion: this.currentInstalledVersion,
        log: logEntry
      };
    } catch (err) {
      this.isUpdating = false;
      console.error('[Auto-Updater] ❌ Silent update failed:', err.message);
      this.broadcast('UPDATER_STATUS', { status: 'UPDATE_FAILED', error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * SemVer comparator (returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal)
   */
  compareVersions(v1, v2) {
    const p1 = (v1 || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
    const p2 = (v2 || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const num1 = p1[i] || 0;
      const num2 = p2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }

  startScheduler(intervalHours = 12) {
    if (this.checkTimer) clearInterval(this.checkTimer);
    
    // Initial check after 10s of startup
    setTimeout(() => {
      this.checkForUpdates();
    }, 10000);

    // Periodic check every X hours
    this.checkTimer = setInterval(() => {
      this.checkForUpdates();
    }, intervalHours * 60 * 60 * 1000);

    console.log(`[Auto-Updater] 🛡️ Silent self-healing updater active (Checks every ${intervalHours}h)`);
  }

  getStatus() {
    return {
      packageName: this.packageName,
      installedVersion: this.currentInstalledVersion,
      latestVersion: this.latestAvailableVersion,
      isUpdating: this.isUpdating,
      lastChecked: this.lastCheckTime,
      history: this.updateHistory
    };
  }
}
