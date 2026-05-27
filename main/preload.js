const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('statustag', {
  sendStatus: (status) => ipcRenderer.invoke('send-status', status),

  setBrightness: (val) => ipcRenderer.invoke('set-brightness', val),
  resetDisplay: () => ipcRenderer.invoke('reset-display'),
  getGifs: () => ipcRenderer.invoke('get-gifs'),
  getDeviceStatus: () => ipcRenderer.invoke('get-device-status'),
  setAutoRevert: (params) => ipcRenderer.invoke('set-auto-revert', params),
  setTitleBarTheme: (isLight) => ipcRenderer.invoke('set-titlebar-theme', isLight),
  onDeviceStatus: (fn) => ipcRenderer.on('device-status', (event, data) => fn(data)),
  onDeviceError: (fn) => ipcRenderer.on('device-error', (event, msg) => fn(msg)),
  onAutoReverted: (fn) => ipcRenderer.on('auto-reverted', (event, revertKey) => fn(revertKey))
});
