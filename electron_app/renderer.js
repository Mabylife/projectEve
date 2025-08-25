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
      author: null,
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

  // Track if this is the initial application load
  let isInitialLoad = true;

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
    console.log("[EVE][THEME] Applying theme:", themeObj);
    state.theme = themeObj || {};
    const t = state.theme?.theme || {};

    const bgRGB = t.backgroundColor || [0, 0, 0];
    const bgOpacity = t.backgroundOpacity ?? 0.25;
    const textRGB = t.textColor || [255, 255, 255];
    const mainOpacity = t.mainTextOpacity ?? 1;
    const secondaryOpacity = t.secondaryTextOpacity ?? 0.5;
    const baseFontSizePx = t.baseFontSizePx ?? 16;
    const blurPx = t.backdropBlurPx ?? 20;

    console.log("[EVE][THEME] Setting CSS variables - bg:", bgRGB, "opacity:", bgOpacity, "fontSize:", baseFontSizePx);

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
    console.log("[EVE][UI] Applying UI config:", uiObj);
    state.ui = uiObj || {};
    const u = state.ui?.ui || {};

    const scale = u.scale ?? 1;
    const baseSize = state.theme?.theme?.baseFontSizePx ?? 16;
    const newFontSize = `${baseSize * scale}px`;
    console.log("[EVE][UI] Setting font size to:", newFontSize, "(base:", baseSize, "scale:", scale, ")");
    document.documentElement.style.setProperty("--eve-font-size", newFontSize);

    if (typeof u.default_immersive_mode === "string" && isInitialLoad) {
      const v = u.default_immersive_mode.toLowerCase();
      state.isImmOn = v === "on";
      console.log("[EVE][UI] Setting initial immersive mode to:", state.isImmOn);
      reflectMediaToMain();
    }

    // After initial load, prevent default immersive mode from being applied again
    isInitialLoad = false;
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
    state.media.author = first.artist || null; // Extract artist field as author
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
      if (typeof meta.artist !== "undefined") state.media.author = meta.artist;
      if (typeof meta.statusName !== "undefined") state.media.statusName = meta.statusName;
      updateMediaUI();
      reflectMediaToMain();
    }
  }

  function reflectMediaToMain() {
    api.setMediaAndImmersive({
      mediaStatus: state.media.status,
      isImmOn: state.isImmOn,
    });
  }

  // ------------------------
  // UI 更新（綁定到實際 DOM）
  // ------------------------
  function updateMediaUI() {
    let displayTime = `${state.media.position || "--"} / ${state.media.duration || "--"}`;
    setText(document.querySelector("[data-eve-media-title]"), state.media.title || "");
    setText(document.querySelector("[data-eve-media-status]"), state.media.status || "");
    setImg(document.querySelector("[data-eve-media-thumb]"), state.media.thumbnail || "../assets/defaultThumbnail.svg");
    setText(document.querySelector("[data-eve-media-author]"), state.media.author || "");
    setText(document.querySelector("[data-eve-media-time]"), displayTime || "");

    // 更新進度條 (僅在 immersive 模式)
    const progressBar = document.querySelector(".progress-bar");
    if (progressBar && state.isImmOn) {
      const progress = renderProgressBar(state.media.position, state.media.duration);
      setText(progressBar, progress);
    }

    setAttr(document.body, "data-media-status", state.media.status);
    // Also update the music playing status in the status section
    updateMusicPlayingUI();
  }

  function renderProgressBar(position, duration, totalBars = 20) {
    if (typeof position !== "number" || typeof duration !== "number" || duration === 0) {
      return "[--------------------]";
    }
    const progress = Math.floor((position / duration) * totalBars);
    let bar = "[";
    for (let i = 0; i < totalBars; i++) {
      if (i === progress) {
        bar += "O";
      } else {
        bar += "-";
      }
    }
    bar += "]";
    return bar;
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

  // New: Date/Time updates (should be local, not from server)
  function updateDateTime() {
    const now = new Date();
    const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dateStr = `${now.getMonth() + 1}/${now.getDate()} ${weekday[now.getDay()]}`;

    let hour = now.getHours();
    let min = now.getMinutes();
    let ampm = hour >= 12 ? "PM" : "AM";
    hour %= 12;
    if (hour === 0) {
      hour = 12;
    }
    min = min < 10 ? "0" + min : min;
    const timeStr = `${hour}:${min} ${ampm}`;

    setText(document.querySelector("#date"), dateStr);
    setText(document.querySelector("#time"), timeStr);
  }

  // New: Power mode updates
  function updatePowerModeUI(mode) {
    setText(document.querySelector("#power-mode"), mode || "silent");
  }

  // New: Media playing status updates
  function updateMusicPlayingUI() {
    const status = state.media.status || "stopped";
    setText(document.querySelector("#music-playing"), status);
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
            if (res.data.isChangePowerMode) {
              updatePowerModeUI(res.data.mode);
            }
            if (res.data.isToggleImmMode) {
              setImmersive(!state.isImmOn);
            }
            if (res.data.isReconnect) {
              api.refreshAll();
            }
            if (res.data.isMakeRecycleBinZero) {
              // Refresh recycle bin status
              api.refreshAll();
            }
            if (res.data.isAutoFocusOn !== undefined) {
              autoFocus(res.data.isAutoFocusOn);
            }
            if (res.data.isClearOutput) {
              // Clear terminal output
              if (outputContainer) {
                if (res.data.isFullClear) {
                  outputContainer.innerHTML = "";
                } else {
                  // Clear all output except initial help messages
                  const helpMessages = outputContainer.querySelectorAll("p.small");
                  outputContainer.innerHTML = "";
                  // Add back the first two help messages
                  if (helpMessages.length >= 2) {
                    outputContainer.appendChild(helpMessages[0].cloneNode(true));
                    outputContainer.appendChild(helpMessages[1].cloneNode(true));
                  }
                }
              }
            }
            if (res.data.isCopiedQuote) {
              // Copy quote to clipboard
              if (state.quote) {
                try {
                  const text = `"${state.quote.quote || ""}" - ${state.quote.author || ""}`;
                  navigator.clipboard.writeText(text);
                } catch (e) {
                  console.debug("[EVE] Failed to copy quote to clipboard:", e);
                }
              }
            }
            if (res.data.isChangeQuote) {
              // Refresh quote
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

    // 切換 upperPart 的 class
    const upperPart = document.querySelector(".upperPart");
    const alphaSection = document.querySelector(".alphaSection");

    if (upperPart && alphaSection) {
      if (state.isImmOn) {
        // 進入 immersive 模式
        upperPart.classList.remove("immOff");
        upperPart.classList.add("immOn");
        alphaSection.classList.remove("daily_quote");

        // 保存原始內容
        if (!alphaSection.dataset.originalContent) {
          alphaSection.dataset.originalContent = alphaSection.innerHTML;
        }

        // 替換為 immersive 媒體內容
        alphaSection.innerHTML = `
          <div class="imm">
            <small class="fetch-status">/ media</small>
            <div>
              <img class="song-thumbnail" src="assets/defaultThumbnail.svg" alt="" data-eve-media-thumb />
              <div class="rightPart">
                <div><span class="small">Song</span><span class="normal song-title" data-eve-media-title>--</span></div>
                <div><span class="small">Author</span><span class="normal song-author" data-eve-media-author>--</span></div>
                <div><span class="small">Time</span><span class="normal song-time" data-eve-media-time>--</span></div>
                <p class="normal progress-bar">[--------------------]</p>
              </div>
            </div>
          </div>
        `;

        // 重新綁定媒體數據到新的 DOM 元素
        updateMediaUI();
      } else {
        // 退出 immersive 模式
        upperPart.classList.remove("immOn");
        upperPart.classList.add("immOff");
        alphaSection.classList.add("daily_quote");

        // 恢復原始內容
        if (alphaSection.dataset.originalContent) {
          alphaSection.innerHTML = alphaSection.dataset.originalContent;
        }
      }
    }

    try {
      api.setMediaAndImmersive({ mediaStatus: state.media.status, isImmOn: state.isImmOn });
    } catch {}
  }

  // ------------------------
  // Auto-focus functionality
  // ------------------------
  let currentAutoFocusHandler = null;

  function autoFocus(isAutoFocusOn) {
    const input = document.querySelector("[data-eve-console-input]") || document.querySelector("#terminalInput");
    if (!input) return;

    // Remove existing handler if any
    if (currentAutoFocusHandler) {
      input.removeEventListener("blur", currentAutoFocusHandler);
      currentAutoFocusHandler = null;
    }

    if (isAutoFocusOn) {
      currentAutoFocusHandler = function () {
        input.focus();
      };
      input.addEventListener("blur", currentAutoFocusHandler);
    }
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

    // Start auto-focus for terminal input
    autoFocus(true);

    // Start date/time updates every second
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // 要求 Main 立刻拉一次所有非即時資料（Main 收到後會 broadcast）
    api.refreshAll();
    console.debug("[EVE] Renderer started. Waiting IPC updates from Main...");
  });
})();
