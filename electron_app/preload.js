const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eve", {
  onThemeUpdate: (cb) => ipcRenderer.on("theme:update", (_, data) => cb && cb(data)),
  onUiUpdate: (cb) => ipcRenderer.on("ui:update", (_, data) => cb && cb(data)),
});
