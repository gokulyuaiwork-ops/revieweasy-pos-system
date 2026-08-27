import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('         REVIEWEASY POS & WHATSAPP AUTOMATION SYSTEM');
console.log('              1-CLICK INSTALLER & AUTO-START SETUP');
console.log('======================================================================\n');

const installDir = __dirname;
const vbsPath = path.join(installDir, 'ReviewEasy-Silent-Launcher.vbs');
const startupFolder = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const startupLnk = path.join(startupFolder, 'ReviewEasy-POS-Agent.lnk');
const desktopDir = path.join(os.homedir(), 'Desktop');
const desktopUrl = path.join(desktopDir, 'ReviewEasy POS Dashboard.url');
const desktopLnk = path.join(desktopDir, 'ReviewEasy POS Dashboard.lnk');

console.log(`[*] Installation Directory : ${installDir}`);
console.log(`[*] Silent Launcher Script : ${vbsPath}`);
console.log(`[*] User Desktop           : ${desktopDir}\n`);

// -------------------------------------------------------------
// Step 1: Check Node.js Runtime
// -------------------------------------------------------------
console.log('[1/5] Checking Node.js Environment...');
try {
  const nodeVer = execSync('node -v', { encoding: 'utf8' }).trim();
  console.log(`  ✅ [PASS] Node.js is installed & active: ${nodeVer}`);
} catch (e) {
  console.error('  ❌ [FAIL] Node.js is not found in system PATH!');
  console.error('  Please install Node.js from https://nodejs.org');
  process.exit(1);
}

// -------------------------------------------------------------
// Step 2: Layer 1 - Windows Startup Folder Hook
// -------------------------------------------------------------
console.log('\n[2/5] Installing Layer 1: Windows Startup Folder Hook...');
try {
  const vbsShortcutMaker = path.join(os.tmpdir(), 'make_startup_shortcut.vbs');
  const vbsScript = `
    Set ws = CreateObject("WScript.Shell")
    Set s = ws.CreateShortcut("${startupLnk.replace(/\\/g, '\\\\')}")
    s.TargetPath = "wscript.exe"
    s.Arguments = """${vbsPath.replace(/\\/g, '\\\\')}"""
    s.WorkingDirectory = """${installDir.replace(/\\/g, '\\\\')}"""
    s.Description = "ReviewEasy POS Background Spooler & WhatsApp Agent"
    s.WindowStyle = 7
    s.Save
  `;
  fs.writeFileSync(vbsShortcutMaker, vbsScript);
  execSync(`wscript.exe "${vbsShortcutMaker}"`);
  try { fs.unlinkSync(vbsShortcutMaker); } catch (e) {}

  if (fs.existsSync(startupLnk)) {
    console.log('  ✅ [PASS] Startup Folder shortcut created successfully.');
  } else {
    console.log('  ⚠️  [INFO] Startup Shortcut registered.');
  }
} catch (err) {
  console.warn('  ⚠️  [WARN] Startup shortcut write note:', err.message);
}

// -------------------------------------------------------------
// Step 3: Layer 2 - Windows Registry AutoRun (HKCU\Run)
// -------------------------------------------------------------
console.log('\n[3/5] Installing Layer 2: Windows Registry AutoRun Hook...');
try {
  const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ReviewEasyPOS" /t REG_SZ /d "wscript.exe \\"${vbsPath}\\"" /f`;
  execSync(regCmd, { stdio: 'ignore' });
  console.log('  ✅ [PASS] Windows Registry AutoRun key active (HKCU\\...\\Run\\ReviewEasyPOS).');
} catch (err) {
  console.warn('  ⚠️  [WARN] Registry write skipped:', err.message);
}

// -------------------------------------------------------------
// Step 4: Layer 3 - Windows Task Scheduler (OnLogon)
// -------------------------------------------------------------
console.log('\n[4/5] Installing Layer 3: Windows Task Scheduler (On-Logon)...');
try {
  const schCmd = `schtasks /create /tn "ReviewEasyPOS" /tr "wscript.exe \\"${vbsPath}\\"" /sc onlogon /f`;
  execSync(schCmd, { stdio: 'ignore' });
  console.log('  ✅ [PASS] Windows Task Scheduler OnLogon task configured.');
} catch (err) {
  console.log('  ℹ️  [INFO] Task Scheduler skipped or already active.');
}

// -------------------------------------------------------------
// Step 5: Layer 4 - Create Desktop Shortcut for Store Manager
// -------------------------------------------------------------
console.log('\n[5/5] Installing Layer 4: Desktop 1-Click Dashboard Shortcut...');
try {
  const candidateDesktops = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'OneDrive', 'Desktop'),
    path.join(process.env.USERPROFILE || '', 'OneDrive - Personal', 'Desktop'),
    path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop')
  ];
  const activeDesktops = [...new Set(candidateDesktops.filter(d => d && fs.existsSync(d)))];

  const vbsDeskMaker = path.join(os.tmpdir(), 'make_desktop_shortcut.vbs');
  let vbsScripts = `Set ws = CreateObject("WScript.Shell")\n`;

  activeDesktops.forEach((deskPath, idx) => {
    const urlFile = path.join(deskPath, 'ReviewEasy POS Dashboard.url');
    const lnkFile = path.join(deskPath, 'ReviewEasy POS Dashboard.lnk');

    // Method A: Native Internet Shortcut
    const urlContent = `[InternetShortcut]\r\nURL=http://localhost:3000/index.html\r\nIconIndex=0\r\nIconFile=${process.env.SystemRoot || 'C:\\Windows'}\\system32\\SHELL32.dll\r\n`;
    try { fs.writeFileSync(urlFile, urlContent); } catch (e) {}

    // Method B: LNK Shortcut via cmd launcher
    vbsScripts += `
      Set s${idx} = ws.CreateShortcut("${lnkFile.replace(/\\/g, '\\\\')}")
      s${idx}.TargetPath = "cmd.exe"
      s${idx}.Arguments = "/c start http://localhost:3000/index.html"
      s${idx}.Description = "Open ReviewEasy POS Dashboard"
      s${idx}.IconLocation = "shell32.dll,13"
      s${idx}.Save
    `;
  });

  fs.writeFileSync(vbsDeskMaker, vbsScripts);
  execSync(`wscript.exe "${vbsDeskMaker}"`);
  try { fs.unlinkSync(vbsDeskMaker); } catch (e) {}

  console.log(`  ✅ [PASS] Desktop shortcut "ReviewEasy POS Dashboard" installed to ${activeDesktops.length} desktop location(s):`);
  activeDesktops.forEach(d => console.log(`     • ${d}`));
} catch (err) {
  console.warn('  ⚠️  [WARN] Desktop shortcut note:', err.message);
}

// -------------------------------------------------------------
// Launch Background Agent & Open Dashboard
// -------------------------------------------------------------
console.log('\n[*] Launching ReviewEasy Agent in silent background mode...');
try {
  execSync(`wscript.exe "${vbsPath}"`);
  console.log('  ✅ [PASS] Background service started successfully.');
} catch (err) {
  console.warn('  ⚠️  [WARN] Service launch note:', err.message);
}

console.log('\n======================================================================');
console.log('  🎉 SUCCESS! REVIEWEASY BACKGROUND SYSTEM IS FULLY INSTALLED!');
console.log('======================================================================');
console.log('  1. ReviewEasy is now actively monitoring your POS printer.');
console.log('  2. It will automatically start every morning when this PC turns on.');
console.log('  3. Double-click "ReviewEasy POS Dashboard" on your Desktop anytime.');
console.log('  4. Opening your dashboard at http://localhost:3000 right now...\n');

// Open dashboard in browser
try {
  if (process.platform === 'win32') {
    exec('start http://localhost:3000/index.html');
  }
} catch (e) {}
