class VirtualThermalPrinter {
  constructor() {
    this.audioCtx = null;
    this.isPrinting = false;
  }

  initAudio() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
  }

  // Synthesize realistic thermal printer stepper motor / line print sound
  playThermalPrintSound() {
    try {
      this.initAudio();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.6);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.6);
    } catch (e) {
      // Audio not permitted without user gesture
    }
  }

  async printReceipt(receiptText, docType = 'TAX_INVOICE') {
    if (this.isPrinting) return;
    this.isPrinting = true;

    const paperLed = document.getElementById('ledPaper');
    const paper = document.getElementById('receiptPaper');
    const content = document.getElementById('paperReceiptContent');
    const log = document.getElementById('streamLog');
    const selectedMode = document.querySelector('input[name="connMode"]:checked')?.value || 'SPOOLER';

    // 1. Activate Hardware Status
    if (paperLed) paperLed.classList.add('active');
    this.playThermalPrintSound();

    // 2. Extrude Paper Animation
    if (paper) {
      paper.classList.remove('animating');
      void paper.offsetWidth; // Trigger reflow
      paper.classList.add('animating');
    }

    if (content) {
      content.innerText = receiptText;
    }

    const byteLength = new Blob([receiptText]).size;
    if (log) {
      log.innerText = `[${selectedMode}] Flushed ${byteLength} bytes to ReviewEasy (${docType})...`;
    }

    // 3. Dispatch stream to ReviewEasy Backend (:3000)
    try {
      const source = selectedMode === 'TCP_9100' ? 'TCP_9100_NETWORK_STREAM' : 'WINDOWS_PRINT_SPOOLER';
      
      const storeCode = (window.currentActiveStore || localStorage.getItem('revieweasy_lab_store') || 'STORE_DEMO_01').toUpperCase();
      const res = await fetch('http://localhost:3000/api/simulate-print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: receiptText,
          source: source,
          storeCode: storeCode
        })
      });

      const data = await res.json();
      if (data.success) {
        if (log) {
          log.innerText = `✅ [Captured] Bill #${data.transaction.invoiceNo} | Phone: ${data.transaction.customerPhone || 'N/A'} | Status: ${data.transaction.status}`;
        }
      } else {
        if (log) {
          log.innerText = `⚠️ ReviewEasy error: ${data.error || 'Unknown error'}`;
        }
      }
    } catch (err) {
      if (log) {
        log.innerText = `⚠️ ReviewEasy (:3000) error: ${err.message}`;
      }
    }

    // 4. Reset Hardware State
    setTimeout(() => {
      if (paperLed) paperLed.classList.remove('active');
      this.isPrinting = false;
    }, 800);
  }

  feed() {
    this.playThermalPrintSound();
    const content = document.getElementById('paperReceiptContent');
    if (content) {
      content.innerText += '\n\n';
    }
  }

  cut() {
    this.playThermalPrintSound();
    const paper = document.getElementById('receiptPaper');
    if (paper) {
      paper.style.transform = 'translateY(-15px)';
      setTimeout(() => {
        paper.style.transform = 'none';
        alert('✂️ Receipt paper torn off by cashier!');
      }, 200);
    }
  }

  reset() {
    const content = document.getElementById('paperReceiptContent');
    const log = document.getElementById('streamLog');
    if (content) {
      content.innerText = `========================================
     80MM THERMAL PRINTER READY
========================================
Status: Online (Buffer Cleared)
========================================`;
    }
    if (log) {
      log.innerText = `[Buffer Cleared] Ready for next invoice.`;
    }
  }
}

window.VirtualPrinter = new VirtualThermalPrinter();

function printerFeed() { window.VirtualPrinter.feed(); }
function printerCut() { window.VirtualPrinter.cut(); }
function printerReset() { window.VirtualPrinter.reset(); }
