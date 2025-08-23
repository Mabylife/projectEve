const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eve", {
  // 主題/UI 即時更新
  onThemeUpdate: (cb) => ipcRenderer.on("theme:update", (_, data) => cb && cb(data)),
  onUiUpdate: (cb) => ipcRenderer.on("ui:update", (_, data) => cb && cb(data)),

  // 其他 IPC 溝通
  onFocusInput: (cb) => ipcRenderer.on("focus-input", () => cb && cb()),
  sendVariable: (payload) => ipcRenderer.send("send-variable", payload),

  // 新增：通知主程序調整縮放與視窗大小/位置
  setUiScale: (scale) => ipcRenderer.send("ui:set-scale", scale),
});
