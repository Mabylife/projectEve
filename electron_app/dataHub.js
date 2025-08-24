// dataHub.js
// 中樞：只允許 Main 連到 Python（HTTP/WS），並用 IPC 廣播給 Renderer。
// Renderer 不可直接對 Python 發請求。

const { ipcMain, BrowserWindow } = require("electron");
const WebSocket = require("ws");

function getAllWins(getWindows) {
  const wins = typeof getWindows === "function" ? getWindows() : [];
  return Array.isArray(wins) && wins.length ? wins.filter(Boolean) : BrowserWindow.getAllWindows();
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
  const WS_URL = `ws://127.0.0.1:${pyPort}/ws`;

  let ws = null;
  let reconnectTimer = null;
  let hbTimer = null;
  let stopped = false;

  const intv = {
    disk: pollIntervals.disk ?? 60_000,
    recyclebin: pollIntervals.recyclebin ?? 60_000,
    quote: pollIntervals.quote ?? 600_000,
    media: pollIntervals.media ?? 2_000, // 2 秒輪詢媒體狀態，可配置
    mediaOnce: 0, // 開機後做一次快照
  };

  let timers = {
    disk: null,
    recyclebin: null,
    quote: null,
    media: null, // 定期媒體輪詢
    mediaOnce: null,
  };

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

  // ----- WS: 媒體即時 -----
  function startWs() {
    cleanupWs();

    ws = new WebSocket(WS_URL);
    ws.on("open", () => {
      // 心跳
      hbTimer = setInterval(() => {
        try {
          ws.ping();
        } catch {}
      }, 15000);
    });

    ws.on("message", (data) => {
      try {
        const text = typeof data === "string" ? data : data.toString("utf-8");
        const obj = JSON.parse(text);
        // 直接轉播給 UI
        broadcast(getWindows, "realtime:update", obj);
        if (obj?.type === "media") {
          broadcast(getWindows, "media:update", obj);
        }
      } catch {
        // 非 JSON 忽略或必要時轉為 raw
        // broadcast(getWindows, "realtime:update", { type: "raw", data: String(data) });
      }
    });

    ws.on("close", () => {
      cleanupWs();
      if (!stopped) scheduleReconnect();
    });

    ws.on("error", () => {
      // 交給 close/reconnect
    });
  }

  function cleanupWs() {
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, "restart");
    } catch {}
    ws = null;
  }

  function scheduleReconnect() {
    if (stopped) return;
    reconnectTimer = setTimeout(() => {
      startWs();
    }, 1500);
  }

  // ----- Pollers: 非即時資料（Main 代抓） -----
  async function pollDisk() {
    try {
      const data = await httpGetJson("/disk");
      broadcast(getWindows, "disk:update", data);
    } catch {}
  }

  async function pollRecyclebin() {
    try {
      const data = await httpGetJson("/recyclebin");
      broadcast(getWindows, "recyclebin:update", data);
    } catch {}
  }

  async function pollQuote() {
    try {
      const data = await httpGetJson("/dailyquote");
      broadcast(getWindows, "quote:update", data);
    } catch {}
  }

  async function pollMedia() {
    try {
      const list = await httpGetJson("/media");
      broadcast(getWindows, "media:update", { type: "media:snapshot", list });
    } catch {}
  }

  async function pollMediaOnceSnapshot() {
    try {
      const list = await httpGetJson("/media"); // 一次性快照
      broadcast(getWindows, "media:update", { type: "media:snapshot", list });
    } catch {}
  }

  function startPollers() {
    stopPollers();

    // 一次性快照（避免 UI 等 WS 才有畫面）
    timers.mediaOnce = setTimeout(pollMediaOnceSnapshot, 300);

    // 定期輪詢媒體狀態 (取代 Python 端的 watchdog)
    timers.media = setInterval(pollMedia, intv.media);
    pollMedia(); // 立即執行一次

    timers.disk = setInterval(pollDisk, intv.disk);
    pollDisk();

    timers.recyclebin = setInterval(pollRecyclebin, intv.recyclebin);
    pollRecyclebin();

    timers.quote = setInterval(pollQuote, intv.quote);
    pollQuote();
  }

  function stopPollers() {
    for (const k of Object.keys(timers)) {
      if (timers[k]) clearInterval(timers[k]);
      timers[k] = null;
    }
  }

  // ----- IPC: Renderer → Main → Python -----
  ipcMain.handle("terminal:run", async (_e, inputText) => {
    try {
      const data = await httpPostJson("/terminal/run", { input: String(inputText || "") });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.on("status:refresh-all", async () => {
    // 立即刷新一次
    pollDisk();
    pollRecyclebin();
    pollQuote();
    pollMediaOnceSnapshot();
  });

  return {
    start() {
      stopped = false;
      startWs();
      startPollers();
    },
    stop() {
      stopped = true;
      cleanupWs();
      stopPollers();
      try {
        ipcMain.removeHandler("terminal:run");
      } catch {}
    },
  };
}

module.exports = { initDataHub };
