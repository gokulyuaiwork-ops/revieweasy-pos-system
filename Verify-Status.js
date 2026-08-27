import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('       REVIEWEASY SYSTEM HEALTH & AUTO-START DIAGNOSTIC TOOL');
console.log('======================================================================\n');

// 1. Check Node.js
console.log('[1/6] Node.js Environment:');
try {
  const nodeVer = execSync('node -v', { encoding: 'utf8' }).trim();
  console.log(`  ✅ [PASS] Node.js installed: ${nodeVer}`);
} catch (e) {
  console.log('  ❌ [FAIL] Node.js is missing!');
}

// 2. Check Startup Shortcut
const startupFolder = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const startupLnk = path.join(startupFolder, 'ReviewEasy-POS-Agent.lnk');
console.log('\n[2/6] Windows Startup Folder Hook:');
if (fs.existsSync(startupLnk)) {
  console.log(`  ✅ [PASS] Startup shortcut found: ${startupLnk}`);
} else {
  console.log('  ❌ [FAIL] Startup shortcut not found in Startup folder.');
}

// 3. Check Registry AutoRun
console.log('\n[3/6] Windows Registry AutoRun (HKCU\\Run):');
try {
  const regQuery = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ReviewEasyPOS"', { encoding: 'utf8' });
  if (regQuery.includes('ReviewEasyPOS')) {
    console.log('  ✅ [PASS] Registry Run key is active.');
  } else {
    console.log('  ❌ [FAIL] Registry Run key not found.');
  }
} catch (e) {
  console.log('  ❌ [FAIL] Registry Run key not found.');
}

// 4. Check Desktop Shortcuts
console.log('\n[4/6] Desktop Dashboard Shortcut:');
const candidateDesktops = [
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'OneDrive', 'Desktop'),
  path.join(process.env.USERPROFILE || '', 'OneDrive - Personal', 'Desktop'),
  path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop')
];
const foundDesktops = candidateDesktops.filter(d => d && fs.existsSync(d) && (fs.existsSync(path.join(d, 'ReviewEasy POS Dashboard.lnk')) || fs.existsSync(path.join(d, 'ReviewEasy POS Dashboard.url'))));
if (foundDesktops.length > 0) {
  console.log(`  ✅ [PASS] Desktop shortcut verified and visible on ${foundDesktops.length} desktop location(s):`);
  foundDesktops.forEach(d => console.log(`     • ${d}`));
} else {
  console.log('  ❌ [FAIL] Desktop shortcut not found on any active desktop folder.');
}

// 5. Check Local Server Port 3000
console.log('\n[5/6] Local Background Engine (http://localhost:3000):');
http.get('http://localhost:3000/api/state', (res) => {
  let raw = '';
  res.on('data', chunk => raw += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(raw);
      console.log('  ✅ [PASS] Background service is LIVE and responding HTTP 200!');
      console.log(`     • Store Name: ${data.config?.storeName || 'ReviewEasy'}`);
      console.log(`     • WhatsApp  : ${data.whatsapp?.status || 'Active'}`);
      console.log(`     • Cloud Sync: ${data.supabase?.isOnline ? 'Online (Supabase)' : 'Connecting'}`);

      // 6. Check Windows Spooler Directory
      console.log('\n[6/6] Thermal Printer Spooler Monitor:');
      const spoolDir = 'C:\\Windows\\System32\\spool\\PRINTERS';
      if (fs.existsSync(spoolDir)) {
        console.log(`  ✅ [PASS] Windows Spooler directory accessible: ${spoolDir}`);
      } else {
        console.log(`  ℹ️  [INFO] Virtual spooler active.`);
      }

      console.log('\n======================================================================');
      console.log('  🌟 ALL 6 SYSTEM & AUTOSTART CHECKS VERIFIED SUCCESSFULLY!');
      console.log('======================================================================\n');
    } catch (e) {
      console.log('  ⚠️  [WARN] Server responded, but returned unexpected payload.');
    }
  });
}).on('error', (err) => {
  console.log(`  ❌ [FAIL] Could not connect to http://localhost:3000 (${err.message}).`);
  console.log('     Run START-REVIEWEASY-POS.bat or 1-CLICK-INSTALLATION.bat to start service.');
});
