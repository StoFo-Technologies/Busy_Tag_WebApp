const { SerialPort } = require('serialport');
const { existsSync } = require('fs');
const path = require('path');
const { GifUtil } = require('gifwrap');
const Jimp = require('jimp');

// Maps status keys (used in UI) to actual GIF filenames on disk
// This is now mostly fallback/override as main.js sends the filename as the key
const GIF_MAP = {
  'Back soon':      'BeBack',
};

class SerialMonitor {
  constructor(options = {}) {
    this.options = options;
    this.currentPort = null;
    this.socket = null;
    this.pollInterval = 1800;
    this.knownPorts = new Set();
    this.framesCache = {}; // status -> array of buffers
    this.esp32Ids = new Set([
      '10C4:EA60', '10C4:EA61', '10C4:EA63', '10C4:EA70', '10C4:EA71', '10C4:EA80', // CP210x
      '1A86:7523', '1A86:5523', '1A86:55D3', '1A86:55D4', '1A86:7522', // CH34x
      '0403:6001', '0403:6010', '0403:6011', '0403:6014', '0403:6015', // FTDI
      '303A:1001', '303A:0002', '303A:0009', // ESP32 Native/JTAG
      '2341:0043', '2341:0042', '2341:0010', '2341:8036', '2341:8037', // Arduino/AVR
      '2E8A:0003', '2E8A:0005', '2E8A:000A' // Raspberry Pi Pico
    ]);
  }

  async scanPorts() {
    const ports = await SerialPort.list();
    const portKeys = new Set();
    let bestMatch = null;

    for (const p of ports) {
      const key = p.path;
      portKeys.add(key);

      // If we don't have a current port, check if this port is our device
      if (!this.currentPort) {
        if (this.isESP32Port(p)) {
          bestMatch = p;
        }
      }
    }

    const newlyConnected = [...portKeys].filter((x) => !this.knownPorts.has(x));
    const removedPorts = [...this.knownPorts].filter((x) => !portKeys.has(x));

    this.knownPorts = portKeys;

    if (bestMatch && !this.currentPort) {
      this.currentPort = bestMatch.path;
      this.notifyConnect(bestMatch);
    }

    if (removedPorts.length && this.currentPort && removedPorts.includes(this.currentPort)) {
      this.currentPort = null;
      this.notifyDisconnect();
    }
  }

  isESP32Port(port) {
    if (port.vendorId && port.productId) {
      const signature = `${port.vendorId.toUpperCase()}:${port.productId.toUpperCase()}`;
      if (this.esp32Ids.has(signature)) return true;
    }
    
    // Fallback: Check manufacturer or friendly name for common terms
    const searchTerms = ['Silicon Labs', 'QinHeng', 'CH34', 'CP210', 'FTDI', 'ESP32', 'WCH.CN', 'Arduino'];
    const m = (port.manufacturer || '').toLowerCase();
    const f = (port.friendlyName || '').toLowerCase();
    
    return searchTerms.some(term => {
      const t = term.toLowerCase();
      return m.includes(t) || f.includes(t);
    });
  }

  notifyConnect(portInfo) {
    if (this.options.onConnect) this.options.onConnect(portInfo);
  }

  notifyDisconnect() {
    if (this.options.onDisconnect) this.options.onDisconnect();
  }

  notifyError(message) {
    if (this.options.onError) this.options.onError(message);
  }

  start() {
    this.scanTimer = setInterval(() => {
      this.scanPorts().catch((error) => this.notifyError('Port scan error: ' + error.message));
    }, this.pollInterval);

    this.scanPorts().catch((error) => this.notifyError('Port scan error: ' + error.message));
  }

  stop() {
    clearInterval(this.scanTimer);
    this.closePort();
  }

  closePort() {
    if (this.socket && this.socket.isOpen) {
      this.socket.close();
    }
    this.socket = null;
  }

  async loadGifFrames(status) {
    if (this.framesCache[status]) {
      return this.framesCache[status];
    }

    const gifNameBase = GIF_MAP[status] || status;
    const gifsDir = path.join(__dirname, '../gifs');
    
    // Find the actual file to handle .gif vs .GIF case differences
    const files = require('fs').readdirSync(gifsDir);
    const fileName = files.find(f => f.toLowerCase() === `${gifNameBase.toLowerCase()}.gif`);
    
    if (!fileName) {
      throw new Error(`GIF file missing for status: ${status} (expected ${gifNameBase}.gif)`);
    }

    const gifPath = path.join(gifsDir, fileName);
    const gif = await GifUtil.read(gifPath);
    const buffers = [];

    const WIDTH = 128;
    const HEIGHT = 160;

    // We use a canvas of the GIF's logical size to handle frame offsets correctly
    let canvas = new Jimp(gif.width, gif.height, 0x000000FF);

    const MAX_FRAMES = 45;
    const totalFrames = gif.frames.length;
    const step = Math.max(1, Math.ceil(totalFrames / MAX_FRAMES));
    
    for (let i = 0; i < totalFrames; i++) {
        const frame = gif.frames[i];
        const frameJimp = GifUtil.copyAsJimp(Jimp, frame);
        
        // Handle transparency/offsets by compositing onto our logical canvas
        // This ensures a 100x100 frame at offset (50,50) in a 480x480 GIF is placed correctly
        canvas.composite(frameJimp, frame.xOffset, frame.yOffset);

        // Only process and send the frames dictated by our step/MAX_FRAMES
        if (i % step === 0) {
            try {
                // Clone the current state of the canvas and scale it to fit the hardware display
                // .cover ensures the screen is filled while maintaining aspect ratio
                const displayImage = canvas.clone().cover(WIDTH, HEIGHT, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);

                const data = Buffer.alloc(WIDTH * HEIGHT * 2);
                let offset = 0;

                for (let y = 0; y < HEIGHT; y++) {
                  for (let x = 0; x < WIDTH; x++) {
                    const color = displayImage.getPixelColor(x, y);
                    const rgba = Jimp.intToRGBA(color);
                    const r = rgba.r;
                    const g = rgba.g;
                    const b = rgba.b;

                    // Convert to RGB565 (2 bytes per pixel)
                    const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);

                    data[offset++] = (rgb565 >> 8) & 0xFF;
                    data[offset++] = rgb565 & 0xFF;
                  }
                }
                buffers.push(data);
            } catch (frameErr) {
                console.error(`[loadGifFrames] Error processing frame ${i}:`, frameErr.message);
                throw frameErr;
            }
        }
    }

    this.framesCache[status] = buffers;
    return buffers;
  }

  async ensurePortOpen() {
    // Check if we have a valid, open socket
    if (this.socket && this.socket.isOpen) {
      return;
    }

    if (!this.currentPort) {
      throw new Error('Device not connected');
    }

    // Close any existing socket first
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        // ignore
      }
      this.socket = null;
    }
    
    this.socket = new SerialPort({ path: this.currentPort, baudRate: 921600, autoOpen: false });
    
    // Set up event handlers BEFORE opening to catch all events
    this.socket.on('error', (error) => {
      console.error('[Socket Event] Serial port error:', error.message);
      this.socket = null;
      this.notifyError('Serial error: ' + error.message);
    });

    this.socket.on('close', () => {
      this.socket = null;
    });

    this.socket.on('open', () => {
      // socket opened
    });
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.socket) {
          this.socket.close((err) => {
            if (err) {
              // ignore
            }
          });
        }
        this.socket = null;
        reject(new Error('Port open timeout after 5 seconds'));
      }, 5000);

      this.socket.open((err) => {
        clearTimeout(timeout);
        if (err) {
          this.socket = null;
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    if (!this.socket || !this.socket.isOpen) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      throw new Error('Port failed to open properly - isOpen check failed');
    }
  }

  async sendStatus(status) {
    if (!this.currentPort) {
      throw new Error('Device not connected');
    }

    let frames;
    try {
      frames = await this.loadGifFrames(status);
    } catch (err) {
      throw new Error('GIF load error: ' + err.message);
    }

    try {
      await this.ensurePortOpen();
    } catch (err) {
      throw new Error('Failed to open serial port: ' + err.message);
    }

    try {
      await this.write(Buffer.from('STOP\n'));
      await this.delay(300);

      await this.write(Buffer.from('UPLOAD\n'));
      await this.delay(300);

      const CHUNK_SIZE = 2048;
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const frameBytes = frames[frameIndex];
        await this.write(Buffer.from('FRAME\n'));
        await this.delay(30);
        
        let chunksSent = 0;
        for (let i = 0; i < frameBytes.length; i += CHUNK_SIZE) {
          const chunk = frameBytes.subarray(i, i + CHUNK_SIZE);
          await this.write(chunk);
          chunksSent++;
          if (i + CHUNK_SIZE < frameBytes.length) {
            await this.delay(5);
          }
        }
        await this.delay(50);
      }

      await this.write(Buffer.from('END\n'));
      await this.delay(800);

      await this.write(Buffer.from('PLAY\n'));

      return { success: true, status: status, frameCount: frames.length };
    } catch (err) {
      this.closePort();
      throw err;
    }
  }

  async setBrightness(val) {
    if (!this.currentPort) return;
    
    try {
      await this.ensurePortOpen();
      await this.write(Buffer.from(`BRIGHT:${val}\n`));
    } catch(e) {
      this.notifyError('Failed to set brightness: ' + e.message);
      this.closePort();
    }
  }

  write(buf) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.isOpen) {
        this.socket = null;  // Ensure we reset on failed write check
        return reject(new Error('Serial connection is not open'));
      }

      let timeout = false;
      
      const timeoutHandle = setTimeout(() => {
        timeout = true;
        if (this.socket && this.socket.isOpen) {
          this.socket.close();
        }
        reject(new Error('Write timeout - device not responding'));
      }, 5000);

      this.socket.write(buf, (err) => {
        if (timeout) return;  // Ignore callbacks after timeout
        
        clearTimeout(timeoutHandle);
        
        if (err) {
          this.notifyError('Send failed: ' + err.message);
          this.closePort();  // Clean up on error
          return reject(err);
        }
        
        this.socket.drain((drainErr) => {
          if (timeout) return;  // Ignore callbacks after timeout
          
          if (drainErr) {
            this.notifyError('Drain failed: ' + drainErr.message);
            this.closePort();  // Clean up on error
            return reject(drainErr);
          }
          resolve();
        });
      });
    });
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { SerialMonitor };
