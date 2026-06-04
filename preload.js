const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API channels to the frontend renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  sendNotification: (title, body) => ipcRenderer.send('notify', { title, body }),
  getAppVersion: () => ipcRenderer.invoke('get-version'),
  getBackendPort: () => ipcRenderer.invoke('get-port'),
  logRendererError: (err) => ipcRenderer.send('log-error', err),
  setHideCliFlag: (hide) => ipcRenderer.invoke('set-hide-cli', hide),
  getHideCliFlag: () => ipcRenderer.invoke('get-hide-cli'),
  setCloseToTrayFlag: (enable) => ipcRenderer.invoke('set-close-to-tray', enable),
  getCloseToTrayFlag: () => ipcRenderer.invoke('get-close-to-tray'),
  setShowMenuBarFlag: (show) => ipcRenderer.invoke('set-show-menu-bar', show),
  getShowMenuBarFlag: () => ipcRenderer.invoke('get-show-menu-bar'),
  writeMqttLog: (content) => ipcRenderer.invoke('write-mqtt-log', content)
});
