process.noDeprecation = true;
const { app, BrowserWindow, Notification, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { SerialMonitor } = require('../services/serialService');

// Use a dedicated userData path for this app to avoid locked cache locations
const dedicatedUserData = path.join(app.getPath('userData'), 'StatusTag');
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

// Hardware acceleration is enabled for crisp text and UI rendering

let mainWindow;
let monitor;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#090c10',
      symbolColor: '#ffffff'
    },
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
      notify('Device Connected', 'Status device connected via USB: ' + portInfo.path);
    }, onDisconnect: (portInfo) => {
      mainWindow.webContents.send('device-status', { connected: false, port: null });
      notify('Device Disconnected', 'Status device disconnected');
    }, onError: (errorMessage) => {
      mainWindow.webContents.send('device-error', errorMessage);
    }
  });

  monitor.start();

  let revertTimeout = null;

  ipcMain.handle('send-status', async (event, status) => {
    if (revertTimeout) {
      clearTimeout(revertTimeout);
      revertTimeout = null;
    }
    return monitor.sendStatus(status);
  });

  ipcMain.handle('set-titlebar-theme', async (event, isLight) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay({
        color: isLight ? '#f3f4f6' : '#090c10',
        symbolColor: isLight ? '#161a23' : '#ffffff'
      });
    }
  });

  ipcMain.handle('set-auto-revert', async (event, { durationMins, revertKey }) => {
    if (revertTimeout) {
      clearTimeout(revertTimeout);
      revertTimeout = null;
    }
    if (durationMins > 0) {
      revertTimeout = setTimeout(async () => {
        try {
          await monitor.sendStatus(revertKey);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auto-reverted', revertKey);
          }
        } catch (e) {
          console.error('Auto-revert error:', e);
        }
      }, durationMins * 60 * 1000);
    }
  });



  ipcMain.handle('set-brightness', async (event, val) => {
    return monitor.setBrightness(val);
  });

  ipcMain.handle('reset-display', async () => {
    return monitor.resetDisplay();
  });

  ipcMain.handle('get-device-status', async () => {
    return { connected: !!monitor.currentPort, port: monitor.currentPort };
  });

  ipcMain.handle('get-gifs', async () => {
    const fs = require('fs');
    const designsDir = path.join(__dirname, '../designs');
    try {
      const mediaList = [];
      const subdirs = ['gifs', 'images', 'cartoons'];
      
      for (const subdir of subdirs) {
        const dir = path.join(designsDir, subdir);
        if (!fs.existsSync(dir)) continue;
        
        const files = fs.readdirSync(dir);
        files.forEach(f => {
          const ext = path.extname(f).toLowerCase();
          if (!['.gif', '.png', '.jpg', '.jpeg', '.webp'].includes(ext) || f.toLowerCase() === 'berightback_cartoon.gif') return;
          
          const name = path.basename(f, ext);
          // Strip the type suffix (_Cartoon, _Gif, _Image) for label generation
          const baseName = name.replace(/_(Cartoon|Gif|Image)$/i, '');

          const LABEL_OVERRIDES = {
            'chillout': 'Time To Chill',
            'beback': 'Back Soon',
            'available': 'Available',
            'busy': 'Busy',
            'seeyaa': 'See Ya!',
            'snacktime': 'Snack Break',
            'donotdisturb': 'Do Not Disturb'
          };

          let label;
          if (subdir === 'cartoons') {
            // Use generic labels for cartoons to avoid displaying original filenames
            label = 'Cartoon';
          } else {
            label = LABEL_OVERRIDES[baseName.toLowerCase()] || baseName
              .replace(/([A-Z])/g, ' $1')
              .replace(/[_-]/g, ' ')
              .trim();
            label = label.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }

          let type = 'gif';
          if (subdir === 'images') type = 'image';
          if (subdir === 'cartoons') type = 'cartoon';

          mediaList.push({
            key: f,
            nameKey: baseName.toLowerCase(),
            label: label,
            src: `../designs/${subdir}/${f}`,
            type: type
          });
        });
      }

      // Sort alphabetically
      mediaList.sort((a, b) => a.label.localeCompare(b.label));

      // Re-order to put Available and Busy at the top
      const priority = ['available', 'busy'];
      const prioritized = [];
      const others = [];

      mediaList.forEach(item => {
        if (priority.includes(item.nameKey)) {
          prioritized.push(item);
        } else {
          others.push(item);
        }
      });

      // Special sort for priority
      prioritized.sort((a, b) => priority.indexOf(a.nameKey) - priority.indexOf(b.nameKey));

      return [...prioritized, ...others];
    } catch (e) {
      console.error('Failed to read designs dir:', e);
      return [];
    }
  });

});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
