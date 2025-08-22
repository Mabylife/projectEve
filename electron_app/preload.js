// preload.js - Secure preload script that exposes minimal IPC APIs
const { contextBridge, ipcRenderer } = require('electron');

// Expose secure APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Get initial config on load
  getInitialConfig: () => {
    return ipcRenderer.invoke('get-initial-config');
  },
  
  // Theme and UI config subscriptions
  onThemeUpdate: (callback) => {
    ipcRenderer.on('theme:update', (_event, themeData) => callback(themeData));
  },
  
  onUiUpdate: (callback) => {
    ipcRenderer.on('ui:update', (_event, uiData) => callback(uiData));
  },
  
  onConfigError: (callback) => {
    ipcRenderer.on('config:error', (_event, error) => callback(error));
  },
  
  // Focus input handler
  onFocusInput: (callback) => {
    ipcRenderer.on('focus-input', callback);
  },
  
  // Send variables to main process (existing functionality)
  sendVariable: (data) => {
    ipcRenderer.send('send-variable', data);
  },
  
  // Clean up listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});