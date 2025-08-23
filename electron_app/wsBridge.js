const WebSocket = require("ws");

function broadcastToAll(getWindows, channel, payload) {
  const wins = (getWindows?.() || []).filter(Boolean);
  for (const w of wins) {
    try {
      w.webContents.send(channel, payload);
    } catch {}
  }
}

function initWsBridge({ url, getWindows, onMessage, onMediaStatus, onConnectChange, logger = () => {} }) {
  let ws = null;
  let intentionalClose = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let backoff = 1000; // 1s 起跳

  function clearTimers() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function scheduleReconnect() {
    if (intentionalClose) return;
    clearTimers();
    reconnectTimer = setTimeout(connect, Math.min(backoff, 15000));
    backoff = Math.min(backoff * 1.8, 15000);
  }

  function startHeartbeat() {
    clearTimers();
    heartbeatTimer = setInterval(() => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      } catch {}
    }, 15000);
  }

  function connect() {
    try {
      ws = new WebSocket(url);
    } catch (e) {
      logger("WS", "new WebSocket failed: " + e.message);
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      logger("WS", "connected to " + url);
      backoff = 1000;
      startHeartbeat();
      onConnectChange?.(true);
      try {
        ws.send(JSON.stringify({ type: "hello", from: "electron-main" }));
      } catch {}
    });

    ws.on("message", (data) => {
      let obj = null;
      try {
        const text = typeof data === "string" ? data : data.toString("utf-8");
        obj = JSON.parse(text);
      } catch {
        // 非 JSON 直接丟 UI
        broadcastToAll(getWindows, "realtime:update", { type: "raw", data: data.toString?.() || data });
        return;
      }

      // 一律轉播到 UI
      broadcastToAll(getWindows, "realtime:update", obj);

      // 嘗試解讀媒體狀態，驅動「媒體卡可見性」邏輯
      const ms = obj.mediaStatus || obj.status || obj.state;
      const isMediaPacket = obj.type === "media" || obj.kind === "media" || typeof obj.mediaStatus !== "undefined";
      if (isMediaPacket && typeof ms !== "undefined") {
        broadcastToAll(getWindows, "media:update", obj);
        onMediaStatus?.(String(ms));
      }

      onMessage?.(obj);
    });

    ws.on("close", (code, reason) => {
      onConnectChange?.(false);
      logger("WS", `closed code=${code} reason=${reason}`);
      clearTimers();
      if (!intentionalClose) scheduleReconnect();
    });

    ws.on("error", (err) => {
      logger("WS-ERR", err.message);
    });
  }

  return {
    start() {
      intentionalClose = false;
      connect();
    },
    stop() {
      intentionalClose = true;
      clearTimers();
      try {
        if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, "app-exit");
      } catch {}
      ws = null;
    },
  };
}

module.exports = { initWsBridge };
