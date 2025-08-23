const { contextBridge, ipcRenderer } = require("electron");

const api = {
  on(channel, listener) {
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  once(channel, listener) {
    ipcRenderer.once(channel, listener);
  },
  off(channel, listener) {
    ipcRenderer.off(channel, listener);
  },
  send(channel, payload) {
    ipcRenderer.send(channel, payload);
  },
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
  // Renderer 回送主行程的狀態（控制 media 視窗顯示）
  setMediaAndImmersive({ mediaStatus, isImmOn }) {
    ipcRenderer.send("send-variable", { mediaStatus, isImmOn });
  },
  // 封裝：執行終端命令（Main 會轉發到 PY）
  runTerminal(input) {
    return ipcRenderer.invoke("terminal:run", input);
  },
  // 封裝：要求 Main 立即刷新狀態
  refreshAll() {
    ipcRenderer.send("status:refresh-all");
  },
};

try {
  contextBridge.exposeInMainWorld("eveAPI", api);
} catch {
  // contextIsolation=false 時也可用
  window.eveAPI = api;
}
