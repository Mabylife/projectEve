// main.js

if (process.platform === "win32") {
  try {
    if (require("electron-squirrel-startup")) {
      process.exit(0); // 不要用 app.quit()，此時 app 可能尚未初始化
    }
  } catch (e) {
    // 模組不存在就忽略，避免打包後崩潰
  }
}

const { configManager } = require("./configManager");
const { app, Tray, Menu, dialog, shell, globalShortcut, nativeImage, ipcMain, BrowserWindow, screen } = require("electron");
const { initScaleManager } = require("./scaleManager");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const net = require("net");
const isPyPacked = true; // 是否打包成 exe
const devMode = false; // 開發模式
const { initDataHub } = require("./dataHub");
const { ensureUserDataExtras, getTrayIconPath } = require("./utils/persistence");

// ------------------ Mica ------------------
let MicaBrowserWindow;
let micaLoadError = null;
try {
  ({ MicaBrowserWindow } = require("mica-electron"));
} catch (e) {
  micaLoadError = e;
}

// ------------------ 狀態 ------------------
let latestUiConfig = { ui: { mediaWindow: { visibilityMode: "auto" }, default_immersive_mode: "off" } };
let tray = null;
let pyProc = null;
let mainWin = null;
let mediaWin = null;
let refreshWindowsPreference = true; // 是否允許創建視窗

let dataHub = null;
let isPlaying = false;
let isImmOn = false;
let windowsVisible = false;
let lastMediaVisible = false; // Track last media window visibility state
const autoShowFirstToggle = true;
let scaleMgr = null; // Scale manager instance
globalThis.__dataHub = dataHub;

const PY_PORT = 54321;
const MAX_RESTART = 5;
let pyRestartCount = 0;

// 輪詢間隔設定 (毫秒) - 可根據需要調整
const POLL_INTERVALS = {
  media: 1_000, // 1 秒 - 媒體狀態更新頻率
  disk: 60_000, // 1 分鐘 - 磁碟空間
  recyclebin: 60_000, // 1 分鐘 - 回收桶
  quote: 600_000, // 10 分鐘 - 每日金句
};

let lastPyStart = 0;
let restarting = false;
let exiting = false;
let backendIssueFlag = false;

const isPackaged = app.isPackaged;

// 路徑工具：asar 內與 resources 根目錄分開處理
function appFile(...segments) {
  // asar 內（HTML、icons 等）
  if (isPackaged) return path.join(app.getAppPath(), ...segments); // 指向 app.asar
  return path.join(__dirname, ...segments);
}
function resFile(...segments) {
  // resources 根目錄（外部二進位、DLL 等）
  if (isPackaged) return path.join(process.resourcesPath, ...segments);
  // 開發時預設也從專案目錄找
  return path.join(__dirname, ...segments);
}
function getBinaryPath(name) {
  // 打包後：resources/bin/<name>
  // 開發時：<repo>/bin/<name>（可依你開發目錄調整）
  const packagedPath = resFile("bin", name);
  if (fs.existsSync(packagedPath)) return packagedPath;

  const devFallback = path.join(__dirname, "bin", name);
  if (fs.existsSync(devFallback)) return devFallback;

  // 你原本的開發 exe 位置（若需要，可再加一層 fallback）
  const legacyDev = path.join(__dirname, "electorn_app", "servers", "py", name);
  return legacyDev;
}

// ------------------ 日誌 ------------------
const logsDir = path.join(app.getPath("userData"), "logs");
const logFile = path.join(logsDir, "backend.log");
function ensureLogsDir() {
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
}
function writeLog(tag, msg) {
  ensureLogsDir();
  fs.appendFile(logFile, `[${new Date().toISOString()}][${tag}] ${msg}\n`, () => {});
}
function debugPaths() {
  writeLog("PATH", `app.isPackaged=${app.isPackaged}`);
  writeLog("PATH", `process.resourcesPath=${process.resourcesPath}`);
  writeLog("PATH", `app.getAppPath()=${app.getAppPath()}`);
  writeLog("PATH", `__dirname=${__dirname}`);
  writeLog("PATH", `userData=${app.getPath("userData")}`);
  writeLog("PATH", `logsDir=${logsDir}`);
  writeLog("MICA", micaLoadError ? "載入失敗: " + micaLoadError.message : "載入成功");
}

// ------------------ Port / Process 工具 ------------------
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(result);
    };
    socket.setTimeout(600);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

function taskkillByName(name, label, cb = () => {}) {
  exec(`taskkill /IM ${name} /T /F`, (err) => {
    if (err) writeLog(label, `taskkill ${name} 失敗或無進程: ${err.message}`);
    else writeLog(label, `taskkill ${name} 成功`);
    cb();
  });
}

// ------------------ Python 啟動 ------------------
async function startPythonServer() {
  if (!isPyPacked) {
    writeLog("PY", "未打包，請使用python啟動.py檔案");
    return;
  }

  const now = Date.now();
  if (now - lastPyStart < 3000) {
    writeLog("PY", "啟動被節流 (3s 內)");
    return;
  }
  lastPyStart = now;

  if (pyProc && !pyProc.killed) {
    writeLog("PY", "已有 pyProc，跳過");
    return;
  }

  if (await isPortInUse(PY_PORT)) {
    writeLog("PY", `Port ${PY_PORT} 已占用，視為已啟動，跳過`);
    backendIssueFlag = false;
    refreshTrayMenu();
    return;
  }

  const exe = getBinaryPath("EveServer.exe"); // 重要：改為 resources/bin/EveServer.exe
  if (!fs.existsSync(exe)) {
    writeLog("PY", `缺少 EveServer.exe: ${exe}`);
    backendIssueFlag = true;
    refreshTrayMenu();
    return;
  }

  writeLog("PY", `啟動 ${exe}`);
  try {
    // 假設 exePath 是 EveServer.exe 的完整路徑
    const userConfigDir = path.join(app.getPath("userData"), "config");
    // 確保資料夾存在（可選，但建議）
    try {
      fs.mkdirSync(userConfigDir, { recursive: true });
    } catch {}

    pyProc = spawn(exe, [], {
      cwd: path.dirname(exe),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        EVE_CONFIG_DIR: userConfigDir,
      },
    });
  } catch (e) {
    writeLog("PY-ERR", "spawn 失敗: " + e.message);
    backendIssueFlag = true;
    refreshTrayMenu();
    return;
  }

  writeLog("PY-PID", `pid=${pyProc.pid}`);

  pyProc.stdout.on("data", (d) => writeLog("PY", d.toString().trim()));
  pyProc.stderr.on("data", (d) => writeLog("PY-ERR", d.toString().trim()));
  pyProc.on("exit", async (code, signal) => {
    writeLog("PY", `退出 code=${code} signal=${signal}`);
    pyProc = null;
    if (await isPortInUse(PY_PORT)) {
      writeLog("PY", "退出後 port 仍占用，可能殘留");
      backendIssueFlag = true;
      refreshTrayMenu();
      return;
    }
    if (code !== 0 && pyRestartCount < MAX_RESTART && !exiting) {
      pyRestartCount++;
      backendIssueFlag = true;
      refreshTrayMenu();
      setTimeout(() => {
        writeLog("PY", `自動重啟 (${pyRestartCount}/${MAX_RESTART})`);
        startPythonServer();
      }, 1500);
    } else if (code === 0) {
      backendIssueFlag = backendIssueFlag || false;
      refreshTrayMenu();
    }
  });
}

// ------------------ Python 優雅關閉 ------------------
async function gracefulStopPython(options = {}) {
  const { timeoutMs = 4000, pollInterval = 300, fallbackKill = true } = options;

  // 防止自動重啟
  pyRestartCount = MAX_RESTART;

  const portUsed = await isPortInUse(PY_PORT);
  if (!portUsed) {
    writeLog("PY", "gracefulStop: port 未占用，視為未啟動");
    if (pyProc && !pyProc.killed) {
      try {
        pyProc.kill();
      } catch {}
    }
    pyProc = null;
    return;
  }

  writeLog("PY", "送出 /shutdown");
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${PY_PORT}/shutdown`, {
      method: "POST",
      signal: controller.signal,
    });
    clearTimeout(id);
    writeLog("PY", "shutdown 呼叫結果 ok=" + res.ok);
  } catch (e) {
    writeLog("PY-ERR", "shutdown 呼叫失敗: " + e.message);
  }

  const startWait = Date.now();
  while (Date.now() - startWait < timeoutMs) {
    if (!(await isPortInUse(PY_PORT))) {
      writeLog("PY", "gracefulStop: port 已釋放");
      pyProc = null;
      return;
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  writeLog("PY", "gracefulStop: 超時仍未釋放");
  if (fallbackKill) {
    writeLog("PY", "執行 fallback 強制殺");
    if (pyProc && !pyProc.killed) {
      try {
        pyProc.kill();
        writeLog("PY", "pyProc.kill() 呼叫");
      } catch {}
    }
    pyProc = null;
    taskkillByName("EveServer.exe", "PY-KILL"); // 更正名稱
  }
}

// ------------------ 重啟服務 (僅重啟 Python) ------------------
async function restartServices() {
  if (restarting) {
    writeLog("SYS", "忽略：正在重啟中");
    return;
  }
  restarting = true;
  writeLog("SYS", "重啟服務 (Python)");

  pyRestartCount = 0;
  backendIssueFlag = false;
  refreshTrayMenu();

  await gracefulStopPython({ timeoutMs: 2500, fallbackKill: true });

  setTimeout(() => {
    writeLog("SYS", "重啟服務：啟動 Python");
    restarting = false;
    startPythonServer();
  }, 800);
}

// ------------------ 視窗 ------------------
function createWindowsIfNeeded() {
  if (mainWin || mediaWin || !refreshWindowsPreference) return;
  if (micaLoadError || !MicaBrowserWindow) {
    dialog.showErrorBox("Mica 模組缺失", "無法載入 mica-electron，視窗功能停用。");
    writeLog("MICA", "停用視窗：" + (micaLoadError && micaLoadError.message));
    return;
  }

  // Get alwaysOnTop setting from UI config
  const uiConfig = configManager.getConfig("ui");
  const alwaysOnTop = uiConfig?.ui?.alwaysOnTop !== false; // Default to true if not specified

  mainWin = new MicaBrowserWindow({
    width: 1200,
    height: 700,
    resizable: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Set to false for preload.js compatibility
      preload: path.join(__dirname, "preload.js"),
    },
  });
  try {
    mainWin.setRoundedCorner();
    mainWin.setDarkTheme();
    mainWin.setMicaAcrylicEffect();
    mainWin.alwaysFocused(true);
  } catch (e) {
    writeLog("MICA", "主視窗效果設定失敗: " + e.message);
  }

  const primaryHtml = appFile("pages", "primary.html");
  if (fs.existsSync(primaryHtml)) mainWin.loadFile(primaryHtml);
  else writeLog("WIN", "缺少 primary.html: " + primaryHtml);

  // Listen for main window ready
  mainWin.webContents.once("did-finish-load", () => {
    writeLog("WIN", "主視窗內容載入完成");
    // Send initial configs after window is ready
    if (configManager.isInitialized) {
      setTimeout(() => configManager.sendInitialConfigsToWindows(), 100);
    }
  });

  mediaWin = new MicaBrowserWindow({
    width: 300,
    height: 511,
    resizable: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Set to false for preload.js compatibility
      preload: path.join(__dirname, "preload.js"),
    },
  });
  try {
    mediaWin.setRoundedCorner();
    mediaWin.setDarkTheme();
    mediaWin.setMicaAcrylicEffect();
  } catch (e) {
    writeLog("MICA", "媒體視窗效果設定失敗: " + e.message);
  }

  const mediaHtml = appFile("pages", "mediaCard.html");
  if (fs.existsSync(mediaHtml)) mediaWin.loadFile(mediaHtml);
  else writeLog("WIN", "缺少 mediaCard.html: " + mediaHtml);

  // Listen for media window ready
  mediaWin.webContents.once("did-finish-load", () => {
    writeLog("WIN", "媒體視窗內容載入完成");
  });

  mainWin.on("close", (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      hideWindows();
    }
  });

  writeLog("WIN", "Mica 視窗建立完成");
  if (devMode) {
    mediaWin.webContents.openDevTools();
    mainWin.webContents.openDevTools();
    mediaWin.resizable = true;
    mainWin.resizable = true;
  }

  if (autoShowFirstToggle) {
    writeLog("WIN_PreShow", "開始預熱視窗");
    if (mediaWin) mediaWin.show();
    if (mainWin) mainWin.show();
    writeLog("WIN_PreShow", "顯示主視窗和媒體視窗");
    setTimeout(() => {
      if (mainWin) mainWin.hide();
      if (mediaWin) mediaWin.hide();
      writeLog("WIN_PreShow", "隱藏主視窗和媒體視窗");
    }, 100);
  }
}

function showWindows() {
  if (!mainWin || !mediaWin || windowsVisible) return;
  mainWin.center();
  mainWin.show();
  mainWin.focus();

  const mainB = mainWin.getBounds();
  const mB = mediaWin.getBounds();
  mediaWin.setBounds({
    x: mainB.x + mainB.width + 30,
    y: mainB.y + mainB.height - mB.height,
    width: mB.width,
    height: mB.height,
  });

  windowsVisible = true;
  updateMediaVisibility();
  mainWin.webContents.send("focus-input");
}

// app.whenReady()
app.whenReady().then(async () => {
  debugPaths();

  // 先建立/補齊使用者資料與預設檔
  ensureUserDataExtras();

  createTray();
  registerShortcuts();
  startPythonServer();
  createWindowsIfNeeded();

  dataHub = initDataHub({
    getWindows: () => [mainWin, mediaWin],
    pyPort: PY_PORT,
    pollIntervals: POLL_INTERVALS,
  });
  await dataHub.waitForServerReady();
  dataHub.start();

  app.once("before-quit", () => dataHub.stop());

  // Initialize scale manager first
  scaleMgr = initScaleManager(() => [mainWin, mediaWin], {
    afterApply: () => {
      if (!mainWin || !mediaWin) return;
      if (!windowsVisible) return;
      hideWindows();
      setTimeout(() => showWindows(), 120);
    },
  });
  scaleMgr.captureBaseBounds();
  if (mainWin) mainWin.once("ready-to-show", () => scaleMgr.captureBaseBounds());
  if (mediaWin) mediaWin.once("ready-to-show", () => scaleMgr.captureBaseBounds());

  // Initialize new config system
  await configManager.initialize(() => [mainWin, mediaWin], {
    onThemeChange: (theme) => {
      writeLog("CFG", "Theme updated via new config system");
    },
    onUiChange: (ui) => {
      writeLog("CFG", "UI config updated via new config system");
      latestUiConfig = ui || latestUiConfig;
      updateMediaVisibility();

      // Handle scale changes
      if (ui?.ui?.scale && typeof scaleMgr?.setScale === "function") {
        const newScale = ui.ui.scale;
        writeLog("CFG", `Applying scale change: ${newScale}`);
        scaleMgr.setScale(newScale);
      }

      // Handle alwaysOnTop changes
      if (ui?.ui?.alwaysOnTop !== undefined) {
        const alwaysOnTop = ui.ui.alwaysOnTop;
        writeLog("CFG", `Applying alwaysOnTop change: ${alwaysOnTop}`);
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.setAlwaysOnTop(alwaysOnTop);
        }
        if (mediaWin && !mediaWin.isDestroyed()) {
          mediaWin.setAlwaysOnTop(alwaysOnTop);
        }
      }
    },
    onCommandsChange: async (commandsObj, filePath) => {
      // 驗證 commands 基本格式
      const ok = validateCommands(commandsObj);
      if (!ok) {
        writeLog("CFG", "commands.json 格式檢查失敗，略過通知 Python");
        return;
      }
      // 通知 Python 重新載入（僅通知，不傳內容）
      try {
        const res = await fetch(`http://127.0.0.1:${PY_PORT}/reload-commands`, { method: "POST" });
        writeLog("PY", "reload-commands 呼叫結果 ok=" + res.ok);
      } catch (e) {
        writeLog("PY-ERR", "reload-commands 呼叫失敗: " + e.message);
      }
    },
  });

  // Apply initial scale from loaded config
  const initialUiConfig = configManager.getConfig("ui");
  if (initialUiConfig?.ui?.scale && scaleMgr) {
    writeLog("CFG", `Will apply initial scale: ${initialUiConfig.ui.scale}`);

    // Apply scale once both windows have finished loading their content
    let mainReady = false;
    let mediaReady = false;

    const checkAndApplyScale = () => {
      if (mainReady && mediaReady) {
        scaleMgr.captureBaseBounds();
        scaleMgr.setScale(initialUiConfig.ui.scale);
        writeLog("CFG", `Initial scale applied: ${initialUiConfig.ui.scale}`);
      }
    };

    if (mainWin) {
      mainWin.webContents.once("did-finish-load", () => {
        mainReady = true;
        checkAndApplyScale();
      });
    } else {
      mainReady = true;
    }

    if (mediaWin) {
      mediaWin.webContents.once("did-finish-load", () => {
        mediaReady = true;
        checkAndApplyScale();
      });
    } else {
      mediaReady = true;
    }

    // Fallback: apply after a timeout even if events don't fire
    setTimeout(() => {
      if (!mainReady || !mediaReady) {
        writeLog("CFG", "Applying initial scale via fallback timeout");
        scaleMgr.captureBaseBounds();
        scaleMgr.setScale(initialUiConfig.ui.scale);
      }
    }, 2000);
  }

  //mem logger
  startMemLogger();
});

function hideWindows() {
  if (mainWin) mainWin.hide();
  if (mediaWin) mediaWin.hide();
  windowsVisible = false;
  lastMediaVisible = false; // Reset media visibility state when hiding all windows
}

function toggleWindows() {
  if (!mainWin || !mediaWin) createWindowsIfNeeded();
  if (!mainWin || !mediaWin) return;
  windowsVisible ? hideWindows() : showWindows();
}

function getMediaVisibilityMode() {
  const mw = latestUiConfig?.ui?.mediaWindow || {};
  if (typeof mw.visible === "boolean") return mw.visible ? "always" : "never";
  const mode = mw.visibilityMode;
  return mode === "always" || mode === "never" ? mode : "auto";
}

function updateMediaVisibility() {
  if (!mediaWin) return;

  let shouldBeVisible = false;

  // 若主介面目前沒顯示，media 一律隱藏
  if (!windowsVisible) {
    shouldBeVisible = false;
  } else {
    const mode = getMediaVisibilityMode();
    if (mode === "never") {
      shouldBeVisible = false;
    } else if (mode === "always") {
      shouldBeVisible = true;
    } else {
      // auto：沿用既有條件（正在播放 且 非沉浸模式）
      shouldBeVisible = isPlaying && !isImmOn;
    }
  }

  // Only update visibility if state actually changed
  if (shouldBeVisible !== lastMediaVisible) {
    if (shouldBeVisible) {
      if (!mediaWin.isVisible()) mediaWin.showInactive();
    } else {
      mediaWin.hide();
    }
    lastMediaVisible = shouldBeVisible;
    writeLog("MEDIA_VIS", `Media window visibility changed to: ${shouldBeVisible}`);
  }
}

// ------------------ Tray ------------------
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: windowsVisible ? "隱藏介面" : "顯示介面", click: toggleWindows },
    { label: "重啟後端服務" + (backendIssueFlag ? " (後端異常)" : ""), click: restartServices },
    { label: "開啟日誌資料夾", click: () => shell.openPath(logsDir) },
    {
      label: "顯示診斷資訊",
      click: () => {
        dialog.showMessageBox({
          type: "info",
          title: "診斷資訊",
          message: "診斷資訊",
          detail:
            `Packaged: ${app.isPackaged}\n` +
            `micaLoaded: ${!micaLoadError}\n` +
            `isPlaying: ${isPlaying}\n` +
            `isImmOn: ${isImmOn}\n` +
            `windowsVisible: ${windowsVisible}\n` +
            `pyRestartCount: ${pyRestartCount}\n`,
        });
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  if (tray && typeof tray.isDestroyed === "function" && !tray.isDestroyed()) {
    writeLog("TRAY", "Tray already exists. Skip creating a new one.");
    refreshTrayMenu();
    return;
  }
  if (tray && typeof tray.destroy === "function") {
    try {
      tray.destroy();
    } catch {}
    tray = null;
  }

  const iconPath = getTrayIconPath();
  if (!iconPath) {
    writeLog("TRAY", "找不到托盤圖示（tray_icon.ico/.png 或 app.ico）");
    dialog.showErrorBox("Tray 圖示缺失", "找不到托盤圖示（tray_icon.ico/.png 或 app.ico）");
    return;
  }
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img);
  refreshTrayMenu();
  tray.setToolTip("Project Eve");
  tray.on("double-click", toggleWindows);
  writeLog("TRAY", "Tray 建立完成，icon=" + iconPath);
}

// ------------------ 快捷鍵 ------------------
function registerShortcuts() {
  try {
    const ok = globalShortcut.register("CommandOrControl+Space", () => toggleWindows());
    writeLog("SHORTCUT", `CommandOrControl+Space 註冊: ${ok}`);
  } catch (e) {
    writeLog("SHORTCUT", "註冊 CommandOrControl+Space 失敗: " + e.message);
  }
  try {
    const ok2 = globalShortcut.register("Control+Shift+L", () => shell.openPath(logsDir));
    writeLog("SHORTCUT", `Ctrl+Shift+L 註冊: ${ok2}`);
  } catch (e) {
    writeLog("SHORTCUT", "註冊 Ctrl+Shift+L 失敗: " + e.message);
  }
}

// ------------------ IPC ------------------
ipcMain.on("send-variable", (event, data) => {
  try {
    // Ignore updates from media window to avoid conflicting state
    if (mediaWin && event.sender === mediaWin.webContents) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(data, "isImmOn")) {
      isImmOn = data.isImmOn;
    }
    const status = data.mediaStatus;
    isPlaying = status === "playing" || status === "paused";
    updateMediaVisibility();
  } catch (e) {
    writeLog("IPC-ERR", "處理 send-variable 失敗: " + e.message);
  }
});

// ------------------ 單實例 ------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!windowsVisible) toggleWindows();
  });
}

// ------------------ lifecycle ------------------
app.on("window-all-closed", (e) => e.preventDefault());

// ------------------ 退出 ------------------
async function cleanExit() {
  if (exiting) return;
  exiting = true;
  writeLog("SYS", "開始清理...");

  // 先銷毀 tray，避免殘留
  if (tray && typeof tray.destroy === "function") {
    try {
      tray.destroy();
    } catch {}
    tray = null;
  }

  await gracefulStopPython({ timeoutMs: 2000, fallbackKill: true });

  // Clean up config manager
  try {
    configManager.destroy();
    writeLog("CFG", "Config manager cleaned up");
  } catch (e) {
    writeLog("CFG-ERR", "Config manager cleanup error: " + e.message);
  }

  try {
    globalShortcut.unregisterAll();
  } catch {}

  try {
    if (mainWin) mainWin.destroy();
  } catch {}
  try {
    if (mediaWin) mediaWin.destroy();
  } catch {}

  writeLog("SYS", "清理完成");
}

const MEMORY_LOG_INTERVAL = 5 * 60 * 1000;
let memLogTimer = null;
function startMemLogger() {
  try {
    if (memLogTimer) clearInterval(memLogTimer);
    memLogTimer = setInterval(() => {
      const m = process.memoryUsage();
      writeLog("MEM", `rss=${(m.rss / 1e6).toFixed(1)}MB ` + `heapUsed=${(m.heapUsed / 1e6).toFixed(1)}MB ` + `ext=${(m.external / 1e6).toFixed(1)}MB`);
    }, MEMORY_LOG_INTERVAL);
  } catch {}
}

app.on("before-quit", (e) => {
  if (!exiting) {
    e.preventDefault();
    cleanExit().then(() => {
      writeLog("SYS", "清理完成，即將退出");
      app.exit(0);
    });
  }
  if (memLogTimer) clearInterval(memLogTimer);
});

// ------------------ 例外 ------------------
process.on("SIGINT", () => {
  cleanExit().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  cleanExit().then(() => process.exit(0));
});
process.on("uncaughtException", (err) => {
  writeLog("SYS-ERR", "uncaughtException: " + (err.stack || err));
  dialog.showErrorBox("未捕捉例外", err.stack || err.message || String(err));
});
process.on("unhandledRejection", (reason) => {
  writeLog("SYS-ERR", "unhandledRejection: " + reason);
});

// --------- 小工具：commands 驗證 ---------
function validateCommands(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (!Array.isArray(obj.commands)) return false;
  for (const c of obj.commands) {
    if (!c || typeof c !== "object") return false;
    if (!c.name || !c.action) return false;
    if (!c.id) return false;
  }
  return true;
}
