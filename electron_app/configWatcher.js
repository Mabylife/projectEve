const path = require("path");
const chokidar = require("chokidar");
const { app } = require("electron");
const fs = require("fs/promises");

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

async function readJsonSafe(file) {
  try {
    const s = await fs.readFile(file, "utf-8");
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function writeJsonIfMissing(file, data) {
  try {
    await fs.access(file);
  } catch {
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmp, file);
  }
}

function resolveConfigDir() {
  // 開發模式支援從 repo 根或 electron_app 啟動
  const cwd = process.cwd();
  const candidates = [path.join(cwd, "config"), path.join(cwd, "electron_app", "config"), path.join(__dirname, "config")];
  for (const dir of candidates) {
    try {
      require("fs").accessSync(dir);
      return dir;
    } catch {}
  }
  return path.join(cwd, "config");
}

async function ensureDefaultConfigs() {
  const configDir = resolveConfigDir();
  await ensureDir(configDir);

  await writeJsonIfMissing(path.join(configDir, "theme.json"), {
    version: 1,
    theme: {
      backgroundColor: [0, 0, 0],
      backgroundOpacity: 0.25,
      backdropBlurPx: 20,
      textColor: [255, 255, 255],
      mainTextOpacity: 1,
      secondaryTextOpacity: 0.5,
      baseFontSizePx: 16,
    },
  });

  await writeJsonIfMissing(path.join(configDir, "ui.json"), {
    ui: {
      scale: 1,
      alwaysOnTop: true,
      nodeIntegration: true,
      contextIsolation: false,
      mediaWindow: {
        visibilityMode: "auto",
      },
      immersive_mode: "on",
    },
  });

  return configDir;
}

async function loadAllConfigs() {
  const dir = resolveConfigDir();
  const theme = (await readJsonSafe(path.join(dir, "theme.json"))) || {};
  const ui = (await readJsonSafe(path.join(dir, "ui.json"))) || {};
  return { dir, theme, ui };
}

function broadcastToAll(getWindows, channel, payload) {
  const wins = (getWindows?.() || []).filter(Boolean);
  wins.forEach((w) => {
    try {
      w.webContents.send(channel, payload);
    } catch {}
  });
}

// options: { onThemeChange?: (themeObj) => void, onUiChange?: (uiObj) => void }
async function setupConfigHotReload(getWindows, options = {}) {
  const configDir = await ensureDefaultConfigs();

  // 初次載入並廣播
  const { theme, ui } = await loadAllConfigs();
  broadcastToAll(getWindows, "theme:update", theme);
  broadcastToAll(getWindows, "ui:update", ui);
  options.onThemeChange?.(theme);
  options.onUiChange?.(ui);

  // 監看變更
  const targets = ["theme.json", "ui.json"].map((f) => path.join(configDir, f));
  const watcher = chokidar.watch(targets, { ignoreInitial: true });

  let timer;
  watcher.on("change", async (changedPath) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const file = path.basename(changedPath);
      const data = await readJsonSafe(changedPath);
      if (!data) return;
      if (file === "theme.json") {
        broadcastToAll(getWindows, "theme:update", data);
        options.onThemeChange?.(data);
      } else if (file === "ui.json") {
        broadcastToAll(getWindows, "ui:update", data);
        options.onUiChange?.(data);
      }
    }, 80);
  });

  return {
    close: () => watcher.close(),
    getLatest: async () => loadAllConfigs(),
  };
}

module.exports = {
  setupConfigHotReload,
  resolveConfigDir,
  ensureDefaultConfigs,
  loadAllConfigs,
};
