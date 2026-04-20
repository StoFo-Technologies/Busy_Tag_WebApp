process.noDeprecation = true;
const { app, BrowserWindow, Notification, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { SerialMonitor } = require('../services/serialService');

// Use a dedicated userData path for this app to avoid locked cache locations
const dedicatedUserData = path.join(app.getPath('userData'), 'StofoTag');
if (!fs.existsSync(dedicatedUserData)) {
  fs.mkdirSync(dedicatedUserData, { recursive: true });
}
app.setPath('userData', dedicatedUserData);

// Suppress known Electron/Chromium cache noise in console output
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, encoding, callback) => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString(encoding || 'utf8');
  if (
    text.includes('Unable to move the cache: Access is denied') ||
    text.includes('Unable to create cache') ||
    text.includes('Gpu Cache Creation failed')
  ) {
    if (typeof callback === 'function') callback();
    return true;
  }
  return originalStderrWrite(chunk, encoding, callback);
};

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');
app.commandLine.appendSwitch('disable-features', 'GpuCache');
app.disableHardwareAcceleration();

let mainWindow;
let monitor;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../build/icon.ico')
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: *;"]
      }
    });
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function notify(title, body) {
  new Notification({ title, body }).show();
}

app.whenReady().then(() => {
  createWindow();
  Menu.setApplicationMenu(null);

  monitor = new SerialMonitor({
    onConnect: (portInfo) => {
      mainWindow.webContents.send('device-status', { connected: true, port: portInfo.path });
      notify('Device Connected', 'Stofo Tag connected via USB: ' + portInfo.path);
    }, onDisconnect: (portInfo) => {
      mainWindow.webContents.send('device-status', { connected: false, port: null });
      notify('Device Disconnected', 'Stofo Tag disconnected');
    }, onError: (errorMessage) => {
      mainWindow.webContents.send('device-error', errorMessage);
    }
  });

  monitor.start();

  ipcMain.handle('send-status', async (event, status) => {
    return monitor.sendStatus(status);
  });



  ipcMain.handle('set-brightness', async (event, val) => {
    return monitor.setBrightness(val);
  });

  ipcMain.handle('get-gifs', async () => {
    const fs = require('fs');
    const gifsDir = path.join(__dirname, '../gifs');
    try {
      const files = fs.readdirSync(gifsDir);
      return files
        .filter(f => f.toLowerCase().endsWith('.gif'))
        .map(f => {
          const name = f.replace(/\.gif$/i, '');
          // Basic label formatting: CamelCase or kebab-case to Space Case
          let label = name
            .replace(/([A-Z])/g, ' $1')
            .replace(/[_-]/g, ' ')
            .trim();
          // Title Case
          label = label.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          return {
            key: name,
            label: label,
            gif: `../gifs/${f}`
          };
        });
    } catch (e) {
      console.error('Failed to read gifs dir:', e);
      return [];
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  let trayIconPath = path.join(__dirname, '../public/STOFO LOGO.png');
  let tray = new Tray(trayIconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => { mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Set: Available', click: () => { monitor.sendStatus('available').catch(e => notify('Error', 'Ensure tag is connected')); } },
    { label: 'Set: Busy', click: () => { monitor.sendStatus('busy').catch(e => notify('Error', 'Ensure tag is connected')); } },
    { type: 'separator' },
    { label: 'Quit App', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Stofo Tag');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
