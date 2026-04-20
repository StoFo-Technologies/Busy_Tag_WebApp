const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stofotag', {
  sendStatus: (status) => ipcRenderer.invoke('send-status', status),

  setBrightness: (val) => ipcRenderer.invoke('set-brightness', val),
  getGifs: () => ipcRenderer.invoke('get-gifs'),
  onDeviceStatus: (fn) => ipcRenderer.on('device-status', (event, data) => fn(data)),
  onDeviceError: (fn) => ipcRenderer.on('device-error', (event, msg) => fn(msg))
});
