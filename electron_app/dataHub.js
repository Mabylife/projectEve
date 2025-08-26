// DataHub: 由 Main 與 Python (HTTP) 溝通，並用 IPC 廣播到 Renderer。
// 功能：
// - 定期輪詢 Python 各 API
// - 緩存最近一次資料，任何新視窗可立即接收快照
// - 提供 refreshAll() 讓 Main 在後端健康時立刻刷新一次

const { ipcMain, BrowserWindow } = require("electron");

function getAllWins(getWindows) {
  if (typeof getWindows === "function") {
    try {
      const arr = getWindows();
      if (Array.isArray(arr)) return arr.filter(Boolean);
    } catch {}
  }
  return BrowserWindow.getAllWindows();
}

function broadcast(getWindows, channel, payload) {
  for (const w of getAllWins(getWindows)) {
    try {
      w.webContents.send(channel, payload);
    } catch {}
  }
}

function initDataHub({ getWindows, pyPort = 54321, pollIntervals = {} }) {
  const PY_BASE = `http://127.0.0.1:${pyPort}`;

  // 簡單快取：新視窗 did-finish-load 時可立即重播
  const cache = {
    disk: null,
    recyclebin: null,
    quote: null,
    mediaList: null,
  };

  // 輪詢間隔（毫秒）
  const intv = {
    disk: pollIntervals.disk ?? 60_000,
    recyclebin: pollIntervals.recyclebin ?? 60_000,
    quote: pollIntervals.quote ?? 600_000,
    media: pollIntervals.media ?? 2_000,
  };

  const timers = { disk: null, recyclebin: null, quote: null, media: null };

  async function httpGetJson(path) {
    const res = await fetch(`${PY_BASE}${path}`);
    return await res.json();
  }

  async function httpPostJson(path, body) {
    const res = await fetch(`${PY_BASE}${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  }

  async function pollDisk() {
    try {
      const data = await httpGetJson("/disk");
      cache.disk = data;
      broadcast(getWindows, "disk:update", data);
    } catch {}
  }

  async function pollRecyclebin() {
    try {
      const data = await httpGetJson("/recyclebin");
      cache.recyclebin = data;
      broadcast(getWindows, "recyclebin:update", data);
    } catch {}
  }

  async function pollQuote() {
    try {
      const data = await httpGetJson("/dailyquote");
      cache.quote = data;
      broadcast(getWindows, "quote:update", data);
    } catch {}
  }

  async function pollMedia() {
    try {
      const list = await httpGetJson("/media");
      cache.mediaList = list;
      // 統一型別，照你現有 renderer 的處理邏輯
      broadcast(getWindows, "media:update", { type: "media:snapshot", list });
    } catch {}
  }

  function startPollers() {
    stopPollers();
    timers.disk = setInterval(pollDisk, intv.disk);
    timers.recyclebin = setInterval(pollRecyclebin, intv.recyclebin);
    timers.quote = setInterval(pollQuote, intv.quote);
    timers.media = setInterval(pollMedia, intv.media);

    // 啟動即跑一次（但注意視窗尚未載入時，資料可能被丟掉 → 我們有快取可補）
    pollDisk();
    pollRecyclebin();
    pollQuote();
    pollMedia();
  }

  function stopPollers() {
    for (const k of Object.keys(timers)) {
      if (timers[k]) clearInterval(timers[k]);
      timers[k] = null;
    }
  }

  // 立即刷新一次（給 Main 在後端健康時呼叫）
  async function refreshAll() {
    await Promise.allSettled([pollDisk(), pollRecyclebin(), pollQuote(), pollMedia()]);
  }

  // 對單一視窗重播最近快照（在 did-finish-load 後呼叫）
  function replayTo(win) {
    try {
      if (!win || win.isDestroyed()) return;
      if (cache.disk) win.webContents.send("disk:update", cache.disk);
      if (cache.recyclebin) win.webContents.send("recyclebin:update", cache.recyclebin);
      if (cache.quote) win.webContents.send("quote:update", cache.quote);
      if (cache.mediaList) win.webContents.send("media:update", { type: "media:snapshot", list: cache.mediaList });
    } catch {}
  }

  // IPC: 控制台指令 → Python
  ipcMain.handle("terminal:run", async (_e, inputText) => {
    try {
      const data = await httpPostJson("/terminal/run", { input: String(inputText || "") });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Renderer 主動要求刷新（保留相容）
  ipcMain.on("status:refresh-all", () => {
    refreshAll();
  });

  return {
    start: startPollers,
    stop: stopPollers,
    refreshAll,
    replayTo,
  };
}

module.exports = { initDataHub };
