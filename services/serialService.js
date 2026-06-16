const { SerialPort } = require('serialport');
const { existsSync } = require('fs');
const path = require('path');
const { GifUtil } = require('gifwrap');
const Jimp = require('jimp');
const sharp = require('sharp');

// Maps status keys (used in UI) to actual GIF filenames on disk
// This is now mostly fallback/override as main.js sends the filename as the key
const GIF_MAP = {
  'Back soon': 'BeBack',
};

class SerialMonitor {
  constructor(options = {}) {
    this.options = options;
    this.currentPort = null;
    this.socket = null;
    this.pollInterval = 1800;
    this.knownPorts = new Set();
    this.framesCache = {}; // status -> array of buffers
    this.animationQueue = [];
    this.currentRequest = null;
    this.currentAbort = { aborted: false };
    this.isSending = false;
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
      // Automatically show the StoFo Logo upon connection
      this.showLogo().catch(err => console.error('[scanPorts] Failed to show logo on connect:', err));
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

  abortCurrentSend() {
    if (this.currentAbort && !this.currentAbort.aborted) {
      this.currentAbort.aborted = true;
    }

    // Stop any in-flight upload immediately so a partial older design cannot
    // continue streaming into the next selected design.
    this.closePort();
  }

  _throwIfAborted() {
    if (this.currentAbort && this.currentAbort.aborted) {
      throw new Error('Animation send cancelled by new selection');
    }
  }

  async loadGifFrames(status) {
    if (this.framesCache[status]) {
      this._throwIfAborted();
      return this.framesCache[status];
    }

    this._throwIfAborted();
    const gifNameBase = GIF_MAP[status] || status;
    const designsDir = path.join(__dirname, '../designs');

    const fs = require('fs');

    let fileName = null;
    let filePath = null;
    const subdirs = ['gifs', 'images', 'cartoons'];

    for (const subdir of subdirs) {
      const dir = path.join(designsDir, subdir);
      if (!fs.existsSync(dir)) continue;
      
      const files = fs.readdirSync(dir);
      const found = files.find(f => {
        if (f.toLowerCase() === gifNameBase.toLowerCase()) return true;
        const ext = path.extname(f).toLowerCase();
        const base = path.basename(f, ext).toLowerCase();
        return base === gifNameBase.toLowerCase() && ['.gif', '.png', '.jpg', '.jpeg', '.webp'].includes(ext);
      });
      
      if (found) {
        fileName = found;
        filePath = path.join(dir, fileName);
        break;
      }
    }

    if (!fileName) {
      throw new Error(`Media file missing for status: ${status}`);
    }

    const ext = path.extname(fileName).toLowerCase();
    const buffers = [];

    const WIDTH = 128;
    const HEIGHT = 160;

    if (ext === '.gif') {
      const gif = await GifUtil.read(filePath);
      this._throwIfAborted();

      // We use a canvas of the GIF's logical size to handle frame offsets correctly
      let canvas = new Jimp(gif.width, gif.height, 0x000000FF);

      const ESP_FRAME_RATE_MS = 100; // Target 10 FPS
      let elapsedGifTimeMs = 0;
      let nextSampleTimeMs = 0;

      const MAX_FRAMES = 150;
      const totalDuration = gif.frames.reduce((acc, f) => acc + Math.max(2, f.delayCentisecs) * 10, 0);
      const idealFrameCount = totalDuration / ESP_FRAME_RATE_MS;
      
      let effectiveFrameRateMs = ESP_FRAME_RATE_MS;
      if (idealFrameCount > MAX_FRAMES) {
         effectiveFrameRateMs = totalDuration / MAX_FRAMES;
      }

      const totalFrames = gif.frames.length;
      let previousCanvas = canvas.clone();

      for (let i = 0; i < totalFrames; i++) {
        this._throwIfAborted();
        const frame = gif.frames[i];

        if (frame.disposalMethod === 3) {
          previousCanvas = canvas.clone();
        }

        const frameJimp = GifUtil.copyAsJimp(Jimp, frame);

        // Handle transparency/offsets by compositing onto our logical canvas
        canvas.composite(frameJimp, frame.xOffset, frame.yOffset);

        const frameDelayMs = Math.max(2, frame.delayCentisecs) * 10;
        elapsedGifTimeMs += frameDelayMs;

        // While our sampling time is within the current frame's display duration, emit a frame
        while (nextSampleTimeMs < elapsedGifTimeMs && buffers.length < MAX_FRAMES) {
          this._throwIfAborted();
          try {
            // Scale the canvas to cover the hardware display (fill entire screen)
            const displayImage = canvas.clone();
            
            // Calculate scale to cover the entire display while maintaining aspect ratio
            const scaleX = WIDTH / displayImage.bitmap.width;
            const scaleY = HEIGHT / displayImage.bitmap.height;
            const scale = Math.max(scaleX, scaleY);
            
            const scaledWidth = Math.round(displayImage.bitmap.width * scale);
            const scaledHeight = Math.round(displayImage.bitmap.height * scale);
            displayImage.resize(scaledWidth, scaledHeight);
            
            const finalCanvas = new Jimp(WIDTH, HEIGHT, 0x000000FF);
            const posX = Math.floor((WIDTH - scaledWidth) / 2);
            const posY = Math.floor((HEIGHT - scaledHeight) / 2);
            finalCanvas.composite(displayImage, posX, posY);

            const data = Buffer.alloc(WIDTH * HEIGHT * 2);
            let offset = 0;

            const bitmapData = finalCanvas.bitmap.data;
            for (let j = 0; j < bitmapData.length; j += 4) {
              const r = bitmapData[j];
              const g = bitmapData[j + 1];
              const b = bitmapData[j + 2];
              
              // Convert to RGB565 (2 bytes per pixel)
              const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);

              data[offset++] = (rgb565 >> 8) & 0xFF;
              data[offset++] = rgb565 & 0xFF;
            }
            buffers.push(data);
          } catch (frameErr) {
            console.error(`[loadGifFrames] Error processing frame ${i}:`, frameErr.message);
            throw frameErr;
          }
          nextSampleTimeMs += effectiveFrameRateMs;
        }

        if (frame.disposalMethod === 2) {
          for (let y = frame.yOffset; y < frame.yOffset + frame.bitmap.height; y++) {
            for (let x = frame.xOffset; x < frame.xOffset + frame.bitmap.width; x++) {
              canvas.setPixelColor(0x000000FF, x, y);
            }
          }
        } else if (frame.disposalMethod === 3) {
          canvas = previousCanvas.clone();
        }
      }
    } else if (ext === '.webp') {
      // Handle animated WebP files
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const metadata = await sharp(fileBuffer).metadata();
        
        if (metadata.pages && metadata.pages > 1) {
          // Animated WebP - extract all frames
          const MAX_FRAMES = 150;
          
          for (let i = 0; i < Math.min(metadata.pages, MAX_FRAMES); i++) {
            try {
              const frameBuffer = await sharp(fileBuffer, { page: i }).png().toBuffer();
              const frameImage = await Jimp.read(frameBuffer);
              
              // Scale to cover the entire display
              const scaleX = WIDTH / frameImage.bitmap.width;
              const scaleY = HEIGHT / frameImage.bitmap.height;
              const scale = Math.max(scaleX, scaleY);
              
              const scaledWidth = Math.round(frameImage.bitmap.width * scale);
              const scaledHeight = Math.round(frameImage.bitmap.height * scale);
              frameImage.resize(scaledWidth, scaledHeight);
              
              const finalCanvas = new Jimp(WIDTH, HEIGHT, 0x000000FF);
              const posX = Math.floor((WIDTH - scaledWidth) / 2);
              const posY = Math.floor((HEIGHT - scaledHeight) / 2);
              finalCanvas.composite(frameImage, posX, posY);
              
              const data = Buffer.alloc(WIDTH * HEIGHT * 2);
              let offset = 0;
              
              const bitmapData = finalCanvas.bitmap.data;
              for (let j = 0; j < bitmapData.length; j += 4) {
                const r = bitmapData[j];
                const g = bitmapData[j + 1];
                const b = bitmapData[j + 2];
                
                const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
                data[offset++] = (rgb565 >> 8) & 0xFF;
                data[offset++] = rgb565 & 0xFF;
              }
              buffers.push(data);
            } catch (frameErr) {
              console.error(`[loadGifFrames] Error processing WebP frame ${i}:`, frameErr.message);
            }
          }
          
          if (buffers.length === 0) {
            throw new Error('No frames extracted from animated WebP');
          }
        } else {
          // Static WebP - treat as single frame
          throw new Error('Static WebP - use standard image handler');
        }
      } catch (webpErr) {
        // If animated WebP processing fails, treat as static image
        const fileBuffer = fs.readFileSync(filePath);
        let displayImage = sharp(fileBuffer).toFormat('png');
        const pngBuffer = await displayImage.toBuffer();
        displayImage = await Jimp.read(pngBuffer);
        
        const imageCopy = displayImage.clone();
        const scaleX = WIDTH / imageCopy.bitmap.width;
        const scaleY = HEIGHT / imageCopy.bitmap.height;
        const scale = Math.max(scaleX, scaleY);
        
        const scaledWidth = Math.round(imageCopy.bitmap.width * scale);
        const scaledHeight = Math.round(imageCopy.bitmap.height * scale);
        imageCopy.resize(scaledWidth, scaledHeight);
        
        let canvas = new Jimp(WIDTH, HEIGHT, 0x000000FF);
        const posX = Math.floor((WIDTH - scaledWidth) / 2);
        const posY = Math.floor((HEIGHT - scaledHeight) / 2);
        canvas.composite(imageCopy, posX, posY);
        
        const data = Buffer.alloc(WIDTH * HEIGHT * 2);
        let offset = 0;
        
        const bitmapData = canvas.bitmap.data;
        for (let j = 0; j < bitmapData.length; j += 4) {
          const r = bitmapData[j];
          const g = bitmapData[j + 1];
          const b = bitmapData[j + 2];
          
          const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
          data[offset++] = (rgb565 >> 8) & 0xFF;
          data[offset++] = rgb565 & 0xFF;
        }
        buffers.push(data);
      }
    } else {
      // Handle static image (.png, .jpg, .jpeg)
      let displayImage;
      
      // Use Jimp for other formats
      displayImage = await Jimp.read(filePath);
      
      // Scale to cover the entire display while maintaining aspect ratio
      const imageCopy = displayImage.clone();
      
      // Calculate scale to cover the entire display
      const scaleX = WIDTH / imageCopy.bitmap.width;
      const scaleY = HEIGHT / imageCopy.bitmap.height;
      const scale = Math.max(scaleX, scaleY);
      
      const scaledWidth = Math.round(imageCopy.bitmap.width * scale);
      const scaledHeight = Math.round(imageCopy.bitmap.height * scale);
      imageCopy.resize(scaledWidth, scaledHeight);

      // Composite onto a black background to handle transparency and centering
      let canvas = new Jimp(WIDTH, HEIGHT, 0x000000FF);
      const posX = Math.floor((WIDTH - scaledWidth) / 2);
      const posY = Math.floor((HEIGHT - scaledHeight) / 2);
      canvas.composite(imageCopy, posX, posY);

      const data = Buffer.alloc(WIDTH * HEIGHT * 2);
      let offset = 0;

      const bitmapData = canvas.bitmap.data;
      for (let j = 0; j < bitmapData.length; j += 4) {
        const r = bitmapData[j];
        const g = bitmapData[j + 1];
        const b = bitmapData[j + 2];

        // Convert to RGB565 (2 bytes per pixel)
        const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);

        data[offset++] = (rgb565 >> 8) & 0xFF;
        data[offset++] = rgb565 & 0xFF;
      }
      buffers.push(data);
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
      if (error.message && error.message.toLowerCase().includes('access denied')) {
        this.notifyError('Port is already been used');
      } else {
        this.notifyError('Serial error: ' + error.message);
      }
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

    // Give the hardware time to boot up after DTR reset
    await this.delay(3500);
  }

  async sendStatus(status) {
    if (this.currentRequest) {
      this.abortCurrentSend();
    }
    this.animationQueue = [];

    return new Promise((resolve, reject) => {
      const request = { status, resolve, reject };
      this.animationQueue.push(request);
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.isSending || this.animationQueue.length === 0) {
      return;
    }

    this.isSending = true;
    const request = this.animationQueue.shift();
    this.currentRequest = request;
    this.currentAbort = { aborted: false };

    try {
      await this._sendAnimationToTFT(request.status);
      request.resolve({ success: true, status: request.status });
    } catch (err) {
      request.reject(err);
    } finally {
      this.isSending = false;
      this.currentRequest = null;
      this.currentAbort = { aborted: false };
      // Process next queued animation
      if (this.animationQueue.length > 0) {
        this._processQueue();
      }
    }
  }

  async _sendAnimationToTFT(status) {
    if (!this.currentPort) {
      throw new Error('Device not connected');
    }

    let frames;
    try {
      frames = await this.loadGifFrames(status);
    } catch (err) {
      throw new Error('Media load error: ' + err.message);
    }

    try {
      await this.ensurePortOpen();
    this._throwIfAborted();
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('access denied')) {
        throw new Error('Port is already been used');
      }
      throw new Error('Failed to open serial port: ' + err.message);
    }

    try {
      this._throwIfAborted();
      await this.write(Buffer.from('STOP\n'));
      this._throwIfAborted();
      await this.delay(300);

      this._throwIfAborted();
      await this.write(Buffer.from('UPLOAD\n'));
      this._throwIfAborted();
      await this.delay(300);

      const CHUNK_SIZE = 2048;
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        this._throwIfAborted();
        const frameBytes = frames[frameIndex];
        await this.write(Buffer.from('FRAME\n'));
        this._throwIfAborted();
        await this.delay(30);

        let chunksSent = 0;
        for (let i = 0; i < frameBytes.length; i += CHUNK_SIZE) {
          this._throwIfAborted();
          const chunk = frameBytes.subarray(i, i + CHUNK_SIZE);
          await this.write(chunk);
          chunksSent++;
        }
      }

      this._throwIfAborted();
      await this.write(Buffer.from('END\n'));
      this._throwIfAborted();
      await this.delay(800);

      this._throwIfAborted();
      await this.write(Buffer.from('PLAY\n'));
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
    } catch (e) {
      if (e.message && e.message.toLowerCase().includes('access denied')) {
        this.notifyError('Port is already been used');
      } else {
        this.notifyError('Failed to set brightness: ' + e.message);
      }
      this.closePort();
    }
  }

  async showLogo() {
    if (!this.currentPort) return;
    try {
      await this.ensurePortOpen();
      await this.delay(1500); // Wait a bit extra to ensure hardware is fully ready to receive logo


      const logoPath = path.join(__dirname, '../public/STOFO LOGO.png');
      if (require('fs').existsSync(logoPath)) {
        const Jimp = require('jimp');
        const logoJimp = await Jimp.read(logoPath);
        const WIDTH = 128;
        const HEIGHT = 160;

        // Create a solid black background canvas
        const background = new Jimp(WIDTH, HEIGHT, 0x000000FF);

        // Scale logo and center it (phone boot style)
        const logoResized = logoJimp.clone()
          .contain(WIDTH - 40, HEIGHT - 40, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);

        background.composite(logoResized, 20, 20);

        const data = Buffer.alloc(WIDTH * HEIGHT * 2);
        let dataOffset = 0;

        for (let y = 0; y < HEIGHT; y++) {
          for (let x = 0; x < WIDTH; x++) {
            const color = background.getPixelColor(x, y);
            const rgba = Jimp.intToRGBA(color);
            const rgb565 = ((rgba.r & 0xF8) << 8) | ((rgba.g & 0xFC) << 3) | (rgba.b >> 3);
            data[dataOffset++] = (rgb565 >> 8) & 0xFF;
            data[dataOffset++] = rgb565 & 0xFF;
          }
        }

        await this.write(Buffer.from('STOP\n'));
        await this.delay(300);
        await this.write(Buffer.from('UPLOAD\n'));
        await this.delay(300);
        await this.write(Buffer.from('FRAME\n'));
        await this.delay(30);

        const CHUNK_SIZE = 2048;
        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
          const chunk = data.subarray(i, i + CHUNK_SIZE);
          await this.write(chunk);
          if (i + CHUNK_SIZE < data.length) {
            await this.delay(5);
          }
        }

        await this.delay(50);
        await this.write(Buffer.from('END\n'));
        await this.delay(800);
        await this.write(Buffer.from('PLAY\n'));
      }
    } catch (e) {
      if (e.message && e.message.toLowerCase().includes('access denied')) {
        this.notifyError('Port is already been used');
      } else {
        this.notifyError('Failed to show logo: ' + e.message);
      }
      this.closePort();
    }
  }

  async resetDisplay() {
    if (!this.currentPort) return;
    try {
      await this.showLogo();
    } catch (e) {
      this.notifyError('Failed to reset display: ' + e.message);
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
