const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile() && !fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

// 僅在此檔內部使用的 resource 路徑解析，避免與 main.js 命名衝突
function _resPath(...segments) {
  // 打包後：process.resourcesPath
  // 開發時：從專案根的 assets 作為 defaults 來源較直觀
  const base = process.resourcesPath || path.join(app.getAppPath(), "assets");
  return path.join(base, ...segments);
}

// 第一次啟動：補 commands.json 與 shortcuts
function ensureUserDataExtras() {
  const userData = app.getPath("userData");
  const configDir = path.join(userData, "config");
  const shortcutsDir = path.join(userData, "shortcuts");
  ensureDir(configDir);
  ensureDir(shortcutsDir);

  // 從 resources/defaults 帶預設檔
  const defaultsRoot = _resPath("defaults");
  try {
    if (fs.existsSync(defaultsRoot)) {
      const defCfg = path.join(defaultsRoot, "config");
      const defShort = path.join(defaultsRoot, "shortcuts");

      // commands.json 若不存在則補上
      const cmdSrc = path.join(defCfg, "commands.json");
      const cmdDest = path.join(configDir, "commands.json");
      if (fs.existsSync(cmdSrc) && !fs.existsSync(cmdDest)) {
        fs.copyFileSync(cmdSrc, cmdDest);
      }

      // shortcuts 目錄若為空就整包拷貝
      if (fs.existsSync(defShort) && fs.readdirSync(shortcutsDir).length === 0) {
        copyDir(defShort, shortcutsDir);
      }
    }
  } catch (e) {
    // 靜默失敗以免影響主程式啟動；如需可在 main.js 記錄 log
  }
  return { configDir, shortcutsDir };
}

// 尋找 Tray icon（優先 resources/icons，次選 asar/icons）
function getTrayIconPath() {
  const candidates = [
    _resPath("icons", "tray_icon.ico"),
    _resPath("icons", "tray_icon.png"),
    _resPath("icons", "app.ico"),
    // 在開發模式下，嘗試從專案的 icons 目錄讀取
    path.join(app.getAppPath(), "icons", "tray_icon.ico"),
    path.join(app.getAppPath(), "icons", "tray_icon.png"),
    path.join(app.getAppPath(), "icons", "app.ico"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

module.exports = { ensureUserDataExtras, getTrayIconPath };
