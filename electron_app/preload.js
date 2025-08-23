const { contextBridge, ipcRenderer } = require("electron");

// 快取 imm:set 的最後狀態，確保 renderer 晚註冊也能收到
let lastImmWanted = null;
const immSetCallbacks = new Set();

ipcRenderer.on("imm:set", (_e, on) => {
  lastImmWanted = !!on;
  for (const cb of immSetCallbacks) {
    try {
      cb(lastImmWanted);
    } catch {}
  }
});

contextBridge.exposeInMainWorld("eve", {
  // 主題/UI 即時更新
  onThemeUpdate: (cb) => ipcRenderer.on("theme:update", (_, data) => cb && cb(data)),
  onUiUpdate: (cb) => ipcRenderer.on("ui:update", (_, data) => cb && cb(data)),

  // 其他 IPC 溝通
  onFocusInput: (cb) => ipcRenderer.on("focus-input", () => cb && cb()),
  sendVariable: (payload) => ipcRenderer.send("send-variable", payload),

  // 整頁縮放 + 視窗重算
  setUiScale: (scale) => ipcRenderer.send("ui:set-scale", scale),

  // 新增：啟動時套用預設沉浸模式（一次性）
  onImmSet: (cb) => {
    if (typeof cb === "function") {
      immSetCallbacks.add(cb);
      // 若主行程已經推送過 imm:set，晚註冊者立刻補一次
      if (lastImmWanted !== null) {
        queueMicrotask(() => cb(lastImmWanted));
      }
      return () => immSetCallbacks.delete(cb);
    }
    return () => {};
  },
});
