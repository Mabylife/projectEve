// main.js
// 要點：不做任何「預熱 / prime」，保留 autoShowFirstToggle = true。
// 退出時透過 fetch /shutdown 讓 Python 優雅關閉；失敗才 fallback taskkill。

const { app, Tray, Menu, dialog, shell, globalShortcut, nativeImage, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const net = require("net");

// ------------------ Mica ------------------
let MicaBrowserWindow;
let micaLoadError = null;
try {
  ({ MicaBrowserWindow } = require("mica-electron"));
} catch (e) {
  micaLoadError = e;
}

// ------------------ 全域狀態 ------------------
let tray = null;
let pyProc = null;
let jsProc = null;
let mainWin = null;
let mediaWin = null;

let isPlaying = false;
let isImmOn = false;
let windowsVisible = false;
const autoShowFirstToggle = true; // 保留你的設定

const PY_PORT = 54321;
const MAX_RESTART = 5;
let pyRestartCount = 0;
let jsRestartCount = 0;
let lastPyStart = 0;
let restarting = false;
let exiting = false;
const isDev = !app.isPackaged;
let backendIssueFlag = false;

// ------------------ 工具：路徑 ------------------
function extResourcePath(...segments) {
  return app.isPackaged ? path.join(process.resourcesPath, ...segments) : path.join(__dirname, ...segments);
}
function appAssetPath(...segments) {
  return path.join(__dirname, ...segments);
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
  writeLog("PATH", `__dirname=${__dirname}`);
  writeLog("PATH", `userData=${app.getPath("userData")}`);
  writeLog("PATH", `logsDir=${logsDir}`);
  writeLog("MICA", micaLoadError ? "載入失敗: " + micaLoadError.message : "載入成功");
}

// ------------------ 工具：Port/Process ------------------
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(600);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
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

  const exe = extResourcePath("servers", "server.exe");
  if (!fs.existsSync(exe)) {
    writeLog("PY", `缺少 server.exe: ${exe}`);
    backendIssueFlag = true;
    refreshTrayMenu();
    return;
  }

  writeLog("PY", `啟動 ${exe}`);
  try {
    pyProc = spawn(exe, [], {
      cwd: path.dirname(exe),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env },
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
  let fetchOk = false;
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    // Node 18+ 有全域 fetch
    const res = await fetch(`http://127.0.0.1:${PY_PORT}/shutdown`, {
      method: "POST",
      signal: controller.signal,
    });
    clearTimeout(id);
    fetchOk = res.ok;
    writeLog("PY", "shutdown 呼叫結果 ok=" + fetchOk);
  } catch (e) {
    writeLog("PY-ERR", "shutdown 呼叫失敗: " + e.message);
  }

  // 等待 port 關閉
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
    // 只針對 server.exe，避免誤殺其他 python 工作
    taskkillByName("server.exe", "PY-KILL");
  }
}

// ------------------ JS Server ------------------
function startJsServer() {
  if (jsProc && !jsProc.killed) {
    writeLog("JS", "已有 jsProc，跳過");
    return;
  }
  const entry = extResourcePath("servers", "js", "jsserver.js");
  if (!fs.existsSync(entry)) {
    writeLog("JS", `缺少 jsserver.js: ${entry}`);
    backendIssueFlag = true;
    refreshTrayMenu();
    return;
  }
  writeLog("JS", `啟動 ${entry}`);
  try {
    jsProc = spawn(process.execPath, [entry], {
      cwd: path.dirname(entry),
      env: { ...process.env, NODE_ENV: isDev ? "development" : "production" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (e) {
    writeLog("JS-ERR", "spawn 失敗: " + e.message);
    backendIssueFlag = true;
    refreshTrayMenu();
    return;
  }
  writeLog("JS-PID", `pid=${jsProc.pid}`);

  jsProc.stdout.on("data", (d) => writeLog("JS", d.toString().trim()));
  jsProc.stderr.on("data", (d) => writeLog("JS-ERR", d.toString().trim()));
  jsProc.on("exit", (code, signal) => {
    writeLog("JS", `退出 code=${code} signal=${signal}`);
    jsProc = null;
    if (code !== 0 && jsRestartCount < MAX_RESTART && !exiting) {
      jsRestartCount++;
      backendIssueFlag = true;
      refreshTrayMenu();
      setTimeout(() => {
        writeLog("JS", `自動重啟 (${jsRestartCount}/${MAX_RESTART})`);
        startJsServer();
      }, 1500);
    } else if (code === 0) {
      backendIssueFlag = backendIssueFlag || false;
      refreshTrayMenu();
    }
  });
}

function stopJsServer(final = true) {
  if (jsProc && !jsProc.killed) {
    writeLog("JS", "停止");
    try {
      jsProc.kill();
    } catch (e) {
      writeLog("JS-ERR", e.message);
    }
  }
  jsProc = null;
  if (final) jsRestartCount = MAX_RESTART;
}

// ------------------ 重啟 ------------------
function restartServices() {
  if (restarting) {
    writeLog("SYS", "忽略：正在重啟中");
    return;
  }
  restarting = true;
  writeLog("SYS", "重啟服務");
  pyRestartCount = 0;
  jsRestartCount = 0;
  backendIssueFlag = false;
  refreshTrayMenu();
  stopJsServer(false);
  gracefulStopPython({ timeoutMs: 2500, fallbackKill: true }).then(() => {
    setTimeout(() => {
      startPythonServer();
      startJsServer();
      restarting = false;
    }, 600);
  });
}

// ------------------ 視窗 (無預熱，只初始顯示/隱藏一次) ------------------
function createWindowsIfNeeded() {
  if (mainWin || mediaWin) return;
  if (micaLoadError || !MicaBrowserWindow) {
    dialog.showErrorBox("Mica 模組缺失", "無法載入 mica-electron，視窗功能停用。");
    writeLog("MICA", "停用視窗：" + (micaLoadError && micaLoadError.message));
    return;
  }

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
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  try {
    mainWin.setRoundedCorner();
    mainWin.setDarkTheme();
    mainWin.setMicaAcrylicEffect();
    mainWin.alwaysFocused(true);
  } catch (e) {
    writeLog("MICA", "主視窗效果設定失敗: " + e.message);
  }

  const indexHtml = appAssetPath("index.html");
  if (fs.existsSync(indexHtml)) mainWin.loadFile(indexHtml);
  else writeLog("WIN", "缺少 index.html: " + indexHtml);

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
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  try {
    mediaWin.setRoundedCorner();
    mediaWin.setDarkTheme();
    mediaWin.setMicaAcrylicEffect();
  } catch (e) {
    writeLog("MICA", "媒體視窗效果設定失敗: " + e.message);
  }

  const mediaHtml = appAssetPath("mediaCard.html");
  if (fs.existsSync(mediaHtml)) mediaWin.loadFile(mediaHtml);
  else writeLog("WIN", "缺少 mediaCard.html: " + mediaHtml);

  mainWin.on("close", (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      hideWindows();
    }
  });

  writeLog("WIN", "Mica 視窗建立完成");
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

  if (isPlaying && !isImmOn) mediaWin.showInactive();
  else mediaWin.hide();

  windowsVisible = true;
  mainWin.webContents.send("focus-input");
  writeLog("WIN", "顯示視窗");
}

function hideWindows() {
  if (mainWin) mainWin.hide();
  if (mediaWin) mediaWin.hide();
  windowsVisible = false;
  writeLog("WIN", "隱藏視窗");
}

function toggleWindows() {
  if (!mainWin || !mediaWin) createWindowsIfNeeded();
  if (!mainWin || !mediaWin) return;
  windowsVisible ? hideWindows() : showWindows();
}

function updateMediaVisibility() {
  if (!mediaWin) return;
  if (!windowsVisible) {
    mediaWin.hide();
    return;
  }
  if (isPlaying && !isImmOn) {
    if (!mediaWin.isVisible()) mediaWin.showInactive();
  } else {
    mediaWin.hide();
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
            `pyRestartCount: ${pyRestartCount}\n` +
            `jsRestartCount: ${jsRestartCount}\n`,
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
  let iconPath = appAssetPath("icons", "tray_icon.png");
  if (!fs.existsSync(iconPath)) {
    const icoFallback = appAssetPath("icons", "app.ico");
    if (fs.existsSync(icoFallback)) iconPath = icoFallback;
  }
  if (!fs.existsSync(iconPath)) {
    writeLog("TRAY", "找不到圖示: " + iconPath);
    dialog.showErrorBox("Tray 圖示缺失", "找不到 tray_icon.png 或 app.ico");
    return;
  }
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img);
  refreshTrayMenu();
  tray.setToolTip("Project Eve");
  tray.on("double-click", toggleWindows);
  writeLog("TRAY", "Tray 建立完成");
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
    const status = data.mediaStatus;
    isPlaying = status === "playing" || status === "paused";
    isImmOn = !!data.isImmOn;
    writeLog("IPC", `更新 isPlaying=${isPlaying} isImmOn=${isImmOn}`);
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

app.whenReady().then(() => {
  debugPaths();
  createTray();
  registerShortcuts();
  startPythonServer();
  startJsServer();
  createWindowsIfNeeded();
  if (autoShowFirstToggle) {
    // 你的原始「閃一下」行為
    if (mediaWin) mediaWin.show();
    if (mainWin) mainWin.show();
    setTimeout(() => {
      if (mainWin) mainWin.hide();
      if (mediaWin) mediaWin.hide();
    }, 100);
  }
});

// ------------------ 優雅退出 ------------------
async function cleanExit() {
  if (exiting) return;
  exiting = true;
  writeLog("SYS", "應用程式退出");
  // 防止自動重啟
  pyRestartCount = MAX_RESTART;
  jsRestartCount = MAX_RESTART;

  // 先停 JS
  stopJsServer(true);
  // 優雅關閉 Python
  await gracefulStopPython({
    timeoutMs: 4000,
    fallbackKill: true,
  });

  globalShortcut.unregisterAll();
}

app.on("before-quit", (e) => {
  // 確保 async 動作完成
  if (!exiting) {
    e.preventDefault();
    cleanExit().then(() => {
      writeLog("SYS", "清理完成，即將退出");
      app.exit(0);
    });
  }
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
