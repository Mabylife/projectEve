// main.js
// 主要功能：
// 1. 啟動系統匣應用，不預設顯示視窗
// 2. 啟動 Python server.exe 與 JS server (jsserver.js)
// 3. 提供 Tray 功能：開啟/隱藏視窗、重啟服務、開啟日誌資料夾、退出
// 4. 寫入簡單日誌 logs/backend.log
// 5. 服務崩潰時有限次自動重啟 (避免無限迴圈)
// 6. 單實例鎖，避免重複開啟
// --------------------------------------------------

const { app, Tray, Menu, BrowserWindow, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let tray = null;
let mainWindow = null;

let pyProc = null;
let jsProc = null;

const MAX_RESTART = 5;
let pyRestartCount = 0;
let jsRestartCount = 0;

const isDev = !app.isPackaged;

// 解析資源路徑（打包後：process.resourcesPath；開發：__dirname）
function resolveResource(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(__dirname, ...segments);
}

// 日誌設定
const logsDir = resolveResource("logs");
const logFile = path.join(logsDir, "backend.log");

function ensureLogsDir() {
  try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  } catch (e) {
    console.error("建立 logs 失敗", e);
  }
}

function writeLog(tag, message) {
  ensureLogsDir();
  const line = `[${new Date().toISOString()}][${tag}] ${message}\n`;
  fs.appendFile(logFile, line, (err) => {
    if (err) console.error("寫入日誌失敗", err);
  });
}

// 啟動 Python server.exe
function startPythonServer() {
  if (pyProc) return;
  const pythonExePath = resolveResource("servers", "server.exe"); // 你放的 EXE
  if (!fs.existsSync(pythonExePath)) {
    dialog.showErrorBox("Python Server 缺失", `找不到 ${pythonExePath}`);
    writeLog("PY", `server.exe 不存在: ${pythonExePath}`);
    return;
  }

  writeLog("PY", `啟動: ${pythonExePath}`);

  pyProc = spawn(pythonExePath, [], {
    cwd: path.dirname(pythonExePath),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  pyProc.stdout.on("data", (d) => {
    const msg = d.toString();
    writeLog("PY", msg.trim());
    console.log("[PY]", msg);
  });

  pyProc.stderr.on("data", (d) => {
    const msg = d.toString();
    writeLog("PY-ERR", msg.trim());
    console.error("[PY-ERR]", msg);
  });

  pyProc.on("exit", (code, signal) => {
    writeLog("PY", `退出 code=${code} signal=${signal}`);
    pyProc = null;
    if (code !== 0 && pyRestartCount < MAX_RESTART) {
      pyRestartCount++;
      setTimeout(() => {
        writeLog("PY", `嘗試重啟 (${pyRestartCount}/${MAX_RESTART})`);
        startPythonServer();
      }, 1500);
    } else if (code !== 0) {
      dialog.showErrorBox("Python 服務失敗", "已達最大重啟次數，請檢查日誌。");
    }
  });
}

// 啟動 JS Server (jsserver.js) - 獨立 Node 行程 (B 方案)
function startJsServer() {
  if (jsProc) return;

  const jsEntry = resolveResource("servers", "js", "jsserver.js");
  if (!fs.existsSync(jsEntry)) {
    dialog.showErrorBox("JS Server 缺失", `找不到 ${jsEntry}`);
    writeLog("JS", `jsserver.js 不存在: ${jsEntry}`);
    return;
  }

  writeLog("JS", `啟動: ${jsEntry}`);

  // 使用 electron 內建的 Node 執行
  const nodeExec = process.execPath;

  jsProc = spawn(nodeExec, [jsEntry], {
    cwd: path.dirname(jsEntry),
    env: {
      ...process.env,
      NODE_ENV: isDev ? "development" : "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  jsProc.stdout.on("data", (d) => {
    const msg = d.toString();
    writeLog("JS", msg.trim());
    console.log("[JS]", msg);
  });

  jsProc.stderr.on("data", (d) => {
    const msg = d.toString();
    writeLog("JS-ERR", msg.trim());
    console.error("[JS-ERR]", msg);
  });

  jsProc.on("exit", (code, signal) => {
    writeLog("JS", `退出 code=${code} signal=${signal}`);
    jsProc = null;
    if (code !== 0 && jsRestartCount < MAX_RESTART) {
      jsRestartCount++;
      setTimeout(() => {
        writeLog("JS", `嘗試重啟 (${jsRestartCount}/${MAX_RESTART})`);
        startJsServer();
      }, 1500);
    } else if (code !== 0) {
      dialog.showErrorBox("JS 服務失敗", "已達最大重啟次數，請檢查日誌。");
    }
  });
}

// 重啟兩個服務
function restartServices() {
  writeLog("SYS", "收到重啟指令");
  stopPythonServer(false);
  stopJsServer(false);
  pyRestartCount = 0;
  jsRestartCount = 0;
  setTimeout(() => {
    startPythonServer();
    startJsServer();
  }, 800);
}

// 停止 Python
function stopPythonServer(isQuit = true) {
  if (pyProc) {
    writeLog("PY", "停止進程");
    try {
      pyProc.kill();
    } catch (e) {
      writeLog("PY-ERR", "kill 發生錯誤 " + e.message);
    }
    pyProc = null;
  }
  if (isQuit) pyRestartCount = MAX_RESTART; // 防止再重啟
}

// 停止 JS
function stopJsServer(isQuit = true) {
  if (jsProc) {
    writeLog("JS", "停止進程");
    try {
      jsProc.kill();
    } catch (e) {
      writeLog("JS-ERR", "kill 發生錯誤 " + e.message);
    }
    jsProc = null;
  }
  if (isQuit) jsRestartCount = MAX_RESTART;
}

// 建立（可選）視窗（預設不顯示）
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    show: false, // 不自動顯示
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // 如果你沒有 html，可以不載入；若未來要 GUI 可放 index.html
  // mainWindow.loadURL('file://' + path.join(__dirname, 'index.html'));

  mainWindow.on("close", (e) => {
    // 攔截關閉改為隱藏（使用者從系統匣退出）
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// 建立系統匣
function createTray() {
  const iconPath = resolveResource("icons", "tray_icon.png"); // 確保有這個圖
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: "顯示/隱藏介面", click: () => toggleWindow() },
    { label: "重啟服務", click: () => restartServices() },
    { label: "開啟日誌資料夾", click: () => shell.openPath(logsDir) },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("Project Eve");
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => toggleWindow());
}

// 單實例鎖
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

// App 生命週期
app.whenReady().then(() => {
  createWindow();
  createTray();
  startPythonServer();
  startJsServer();
});

// 乾淨退出
function cleanExit() {
  writeLog("SYS", "應用程式退出");
  stopPythonServer(true);
  stopJsServer(true);
}

app.on("before-quit", () => {
  app.isQuiting = true;
  cleanExit();
});

app.on("window-all-closed", (e) => {
  // 不做預設關閉 (因為是 Tray app)
  e.preventDefault();
});

// Ctrl+C / 非正常結束保護
process.on("SIGINT", () => {
  cleanExit();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanExit();
  process.exit(0);
});
process.on("uncaughtException", (err) => {
  writeLog("SYS-ERR", "uncaughtException: " + err.stack);
});
process.on("unhandledRejection", (reason) => {
  writeLog("SYS-ERR", "unhandledRejection: " + reason);
});
