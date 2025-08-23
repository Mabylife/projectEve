// renderer.js
// 規範：Renderer 不可直接與 Python 溝通，所有資料與命令都透過 Main (IPC) 中轉。

(() => {
  const api = window.eveAPI;
  if (!api) {
    console.error("[EVE] eveAPI is not available. Check preload and BrowserWindow.webPreferences.preload");
    return;
  }

  // ------------------------
  // 工具：DOM 輔助
  // ------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const setText = (el, text) => {
    if (el) el.textContent = text == null ? "" : String(text);
  };
  const setAttr = (el, name, value) => {
    if (!el) return;
    if (value == null || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? "" : String(value));
  };
  const setImg = (el, src) => {
    if (el) el.src = src || "";
  };

  // ------------------------
  // 狀態
  // ------------------------
  const state = {
    theme: null,
    ui: null,
    media: {
      status: "stopped",
      title: null,
      statusName: null,
      thumbnail: null,
      duration: null,
      position: null,
    },
    disk: null,
    recyclebin: null,
    quote: null,
    isImmOn: false,
  };

  // ------------------------
  // 主題 / UI 設定套用
  // ------------------------
  function arrToRgb(arr, fallback = [255, 255, 255]) {
    const a = Array.isArray(arr) && arr.length >= 3 ? arr : fallback;
    return `rgb(${a[0] | 0}, ${a[1] | 0}, ${a[2] | 0})`;
  }
  function arrToRgba(arr, alpha = 1, fallback = [0, 0, 0]) {
    const a = Array.isArray(arr) && arr.length >= 3 ? arr : fallback;
    return `rgba(${a[0] | 0}, ${a[1] | 0}, ${a[2] | 0}, ${Number(alpha)})`;
  }

  function applyTheme(themeObj) {
    state.theme = themeObj || {};
    const t = state.theme?.theme || {};

    const bgRGB = t.backgroundColor || [0, 0, 0];
    const bgOpacity = t.backgroundOpacity ?? 0.25;
    const textRGB = t.textColor || [255, 255, 255];
    const mainOpacity = t.mainTextOpacity ?? 1;
    const secondaryOpacity = t.secondaryTextOpacity ?? 0.5;
    const baseFontSizePx = t.baseFontSizePx ?? 16;
    const blurPx = t.backdropBlurPx ?? 20;

    const root = document.documentElement;
    root.style.setProperty("--eve-bg-rgb", arrToRgb(bgRGB));
    root.style.setProperty("--eve-bg-rgba", arrToRgba(bgRGB, bgOpacity));
    root.style.setProperty("--eve-text-rgb", arrToRgb(textRGB));
    root.style.setProperty("--eve-text-main-opacity", String(mainOpacity));
    root.style.setProperty("--eve-text-secondary-opacity", String(secondaryOpacity));
    root.style.setProperty("--eve-font-size", `${baseFontSizePx}px`);
    root.style.setProperty("--eve-backdrop-blur", `${blurPx}px`);

    document.body.style.color = arrToRgb(textRGB);
  }

  function applyUiConfig(uiObj) {
    state.ui = uiObj || {};
    const u = state.ui?.ui || {};

    const scale = u.scale ?? 1;
    const baseSize = state.theme?.theme?.baseFontSizePx ?? 16;
    document.documentElement.style.setProperty("--eve-font-size", `${baseSize * scale}px`);

    if (typeof u.immersive_mode === "string") {
      const v = u.immersive_mode.toLowerCase();
      state.isImmOn = v === "on";
      reflectMediaToMain();
    }
  }

  // ------------------------
  // 媒體處理
  // ------------------------
  function normalizeMediaStatus(name) {
    if (!name) return "stopped";
    const n = String(name).toLowerCase();
    if (n.startsWith("play")) return "playing";
    if (n.startsWith("pause")) return "paused";
    return "stopped";
  }

  function handleMediaSnapshotList(list) {
    const first = Array.isArray(list) ? list[0] : null;
    if (!first) return;

    state.media.title = first.title || null;
    state.media.status = normalizeMediaStatus(first.state);
    state.media.thumbnail = first.thumbnail || null;
    state.media.duration = first.duration ?? null;
    state.media.position = first.position ?? null;
    state.media.statusName = first.state || null;

    updateMediaUI();
    reflectMediaToMain();
  }

  function handleMediaPacket(pkt) {
    if (!pkt || typeof pkt !== "object") return;

    if (pkt.type === "media:snapshot") {
      handleMediaSnapshotList(pkt.list);
      return;
    }

    if (pkt.type === "media") {
      if (typeof pkt.mediaStatus === "string") {
        state.media.status = pkt.mediaStatus;
      }
      const meta = pkt.meta || {};
      if (typeof meta.title !== "undefined") state.media.title = meta.title;
      if (typeof meta.statusName !== "undefined") state.media.statusName = meta.statusName;
      updateMediaUI();
      reflectMediaToMain();
    }
  }

  function reflectMediaToMain() {
    try {
      api.setMediaAndImmersive({
        mediaStatus: state.media.status,
        isImmOn: state.isImmOn,
      });
    } catch {}
  }

  // ------------------------
  // UI 更新（綁定到實際 DOM）
  // ------------------------
  function updateMediaUI() {
    setText(document.querySelector("[data-eve-media-title]"), state.media.title || "");
    setText(document.querySelector("[data-eve-media-status]"), state.media.status || "");
    setImg(document.querySelector("[data-eve-media-thumb]"), state.media.thumbnail || "");
    setAttr(document.body, "data-media-status", state.media.status);
  }

  function updateDiskUI() {
    const d = state.disk || {};
    setText(document.querySelector("[data-eve-disk-c]"), d["C:"] == null ? "N/A" : `${d["C:"]}%`);
    setText(document.querySelector("[data-eve-disk-d]"), d["D:"] == null ? "N/A" : `${d["D:"]}%`);
    setText(document.querySelector("[data-eve-disk-e]"), d["E:"] == null ? "N/A" : `${d["E:"]}%`);
  }

  function updateRecycleUI() {
    const mb = state.recyclebin?.recyclebinMB ?? 0;
    setText(document.querySelector("[data-eve-recycle-mb]"), `${mb} MB`);
  }

  function updateQuoteUI() {
    const q = state.quote || {};
    setText(document.querySelector("[data-eve-quote-text]"), q.quote || "");
    setText(document.querySelector("[data-eve-quote-author]"), q.author || "");
  }

  // ------------------------
  // IPC 綁定與 debug
  // ------------------------
  function bindIpc() {
    api.on("theme:update", (_e, data) => {
      console.debug("[EVE][IPC] theme:update", data);
      applyTheme(data);
    });
    api.on("ui:update", (_e, data) => {
      console.debug("[EVE][IPC] ui:update", data);
      applyUiConfig(data);
    });
    api.on("realtime:update", (_e, pkt) => {
      console.debug("[EVE][IPC] realtime:update", pkt);
      if (pkt?.type === "media") handleMediaPacket(pkt);
    });
    api.on("media:update", (_e, pkt) => {
      console.debug("[EVE][IPC] media:update", pkt);
      handleMediaPacket(pkt);
    });
    api.on("disk:update", (_e, data) => {
      console.debug("[EVE][IPC] disk:update", data);
      state.disk = data;
      updateDiskUI();
    });
    api.on("recyclebin:update", (_e, data) => {
      console.debug("[EVE][IPC] recyclebin:update", data);
      state.recyclebin = data;
      updateRecycleUI();
    });
    api.on("quote:update", (_e, data) => {
      console.debug("[EVE][IPC] quote:update", data);
      state.quote = data;
      updateQuoteUI();
    });
    api.on("focus-input", () => {
      const input = document.querySelector("[data-eve-console-input]") || document.querySelector("#console-input");
      if (input && typeof input.focus === "function") {
        input.focus();
        try {
          input.select();
        } catch {}
      }
    });
  }

  // ------------------------
  // DOM 事件（可選）
  // ------------------------
  function bindDomEvents() {
    const input = document.querySelector("[data-eve-console-input]") || document.querySelector("#console-input");
    const runBtn = document.querySelector("[data-eve-console-run]") || document.querySelector("#console-run");

    async function runTerminal(inputText) {
      try {
        const res = await api.runTerminal(inputText);
        console.debug("[EVE][terminal] result:", res);
        
        // Add terminal output to UI
        if (res && res.ok && res.data) {
          const outputContainer = document.querySelector("#terminalOutput") || document.querySelector("[data-eve-console-output]");
          if (outputContainer && res.data.output) {
            res.data.output.forEach((line) => {
              const p = document.createElement("p");
              p.className = "small";
              p.textContent = line;
              if (res.data.success === false) {
                p.style.color = "red";
              }
              outputContainer.appendChild(p);
            });
            
            // Scroll to bottom
            outputContainer.scrollTop = outputContainer.scrollHeight;
            
            // Handle special actions from terminal commands
            if (res.data.isToggleImmMode) {
              setImmersive(!state.isImmOn);
            }
            if (res.data.isReconnect) {
              api.refreshAll();
            }
          }
        }
      } catch (e) {
        console.error("[EVE][terminal] error:", e);
        
        // Show error in terminal output
        const outputContainer = document.querySelector("#terminalOutput") || document.querySelector("[data-eve-console-output]");
        if (outputContainer) {
          const p = document.createElement("p");
          p.className = "small";
          p.style.color = "red";
          p.style.opacity = "0.5";
          p.textContent = "Terminal error: " + (e.message || e);
          outputContainer.appendChild(p);
          outputContainer.scrollTop = outputContainer.scrollHeight;
        }
      }
    }

    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const text = input.value.trim();
          if (text) {
            runTerminal(text);
          }
          input.value = "";
          input.focus();
        }
      });
    }
    if (runBtn && input) {
      runBtn.addEventListener("click", () => {
        const text = input.value.trim();
        if (text) {
          runTerminal(text);
        }
        input.value = "";
        input.focus();
      });
    }

    const immToggle = document.querySelector("[data-eve-immersive-toggle]");
    if (immToggle) {
      immToggle.addEventListener("change", (e) => {
        const on = !!(e.target?.checked ?? e.detail);
        setImmersive(on);
      });
    }
    const immBtnOn = document.querySelector("[data-eve-immersive-on]");
    const immBtnOff = document.querySelector("[data-eve-immersive-off]");
    if (immBtnOn) immBtnOn.addEventListener("click", () => setImmersive(true));
    if (immBtnOff) immBtnOff.addEventListener("click", () => setImmersive(false));

    const refreshBtn = document.querySelector("[data-eve-refresh-all]");
    if (refreshBtn) refreshBtn.addEventListener("click", () => api.refreshAll());
  }

  function setImmersive(on) {
    state.isImmOn = !!on;
    setAttr(document.body, "data-immersive", String(state.isImmOn));
    try {
      api.setMediaAndImmersive({ mediaStatus: state.media.status, isImmOn: state.isImmOn });
    } catch {}
  }

  // 對外
  window.EVE_RENDERER = {
    setImmersive,
    refreshAll: () => api.refreshAll(),
  };

  // 啟動
  document.addEventListener("DOMContentLoaded", () => {
    bindIpc();
    bindDomEvents();
    // 要求 Main 立刻拉一次所有非即時資料（Main 收到後會 broadcast）
    api.refreshAll();
    console.debug("[EVE] Renderer started. Waiting IPC updates from Main...");
  });
})();
