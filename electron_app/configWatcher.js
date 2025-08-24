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
      default_immersive_mode: "on",
    },
  });

  // 新增 commands.json 預設
  await writeJsonIfMissing(path.join(configDir, "commands.json"), {
    version: 1,
    commands: [
      {
        id: "open_notepad",
        name: "記事本",
        action: { type: "process", cmd: "notepad.exe", args: [] },
      },
      {
        id: "pause_media",
        name: "媒體暫停/播放",
        action: { type: "key", keys: ["mediaPlayPause"] },
      },
    ],
  });

  return configDir;
}

async function loadAllConfigs() {
  const dir = resolveConfigDir();
  const theme = (await readJsonSafe(path.join(dir, "theme.json"))) || {};
  const ui = (await readJsonSafe(path.join(dir, "ui.json"))) || {};
  const commands = (await readJsonSafe(path.join(dir, "commands.json"))) || {};
  return { dir, theme, ui, commands };
}

function broadcastToAll(getWindows, channel, payload) {
  const wins = (getWindows?.() || []).filter(Boolean);
  console.log(`[ConfigWatcher] Broadcasting ${channel} to ${wins.length} windows`);
  wins.forEach((w, index) => {
    try {
      if (w && w.webContents && !w.isDestroyed()) {
        w.webContents.send(channel, payload);
        console.log(`[ConfigWatcher] Successfully sent ${channel} to window ${index}`);
      } else {
        console.warn(`[ConfigWatcher] Window ${index} is not valid for broadcast`);
      }
    } catch (error) {
      console.error(`[ConfigWatcher] Error broadcasting to window ${index}:`, error.message);
    }
  });
}

// options: { onThemeChange?, onUiChange?, onCommandsChange? }
async function setupConfigHotReload(getWindows, options = {}) {
  console.log("[ConfigWatcher] Setting up config hot reload...");
  const configDir = await ensureDefaultConfigs();
  console.log("[ConfigWatcher] Config directory:", configDir);

  // 初次載入並廣播
  const { theme, ui, commands } = await loadAllConfigs();
  console.log("[ConfigWatcher] Initial configs loaded");
  broadcastToAll(getWindows, "theme:update", theme);
  broadcastToAll(getWindows, "ui:update", ui);
  broadcastToAll(getWindows, "commands:update", commands);
  options.onThemeChange?.(theme);
  options.onUiChange?.(ui);
  options.onCommandsChange?.(commands, path.join(configDir, "commands.json"));

  // 監看變更
  const targets = ["theme.json", "ui.json", "commands.json"].map((f) => path.join(configDir, f));
  console.log("[ConfigWatcher] Watching files:", targets);
  
  let watcher;
  try {
    watcher = chokidar.watch(targets, { 
      ignoreInitial: true,
      persistent: true,
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });
    console.log("[ConfigWatcher] Chokidar watcher created successfully");
  } catch (error) {
    console.error("[ConfigWatcher] Failed to create chokidar watcher:", error);
    // Fallback to polling if chokidar fails
    console.log("[ConfigWatcher] Attempting fallback to polling...");
    try {
      watcher = chokidar.watch(targets, { 
        ignoreInitial: true,
        persistent: true,
        usePolling: true,
        interval: 1000
      });
      console.log("[ConfigWatcher] Fallback polling watcher created");
    } catch (fallbackError) {
      console.error("[ConfigWatcher] Fallback watcher also failed:", fallbackError);
      throw fallbackError;
    }
  }

  let timer;
  watcher.on("change", async (changedPath) => {
    console.log("[ConfigWatcher] File change detected:", changedPath);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      console.log("[ConfigWatcher] Processing file change:", changedPath);
      const file = path.basename(changedPath);
      const data = await readJsonSafe(changedPath);
      if (!data) {
        console.warn("[ConfigWatcher] Failed to read JSON data from:", changedPath);
        return;
      }
      console.log("[ConfigWatcher] Successfully read data for:", file);
      if (file === "theme.json") {
        console.log("[ConfigWatcher] Broadcasting theme:update");
        broadcastToAll(getWindows, "theme:update", data);
        options.onThemeChange?.(data);
      } else if (file === "ui.json") {
        console.log("[ConfigWatcher] Broadcasting ui:update");
        broadcastToAll(getWindows, "ui:update", data);
        options.onUiChange?.(data);
      } else if (file === "commands.json") {
        console.log("[ConfigWatcher] Broadcasting commands:update");
        broadcastToAll(getWindows, "commands:update", data);
        options.onCommandsChange?.(data, changedPath);
      }
    }, 80);
  });

  watcher.on("error", (error) => {
    console.error("[ConfigWatcher] Watcher error:", error);
  });

  watcher.on("ready", () => {
    console.log("[ConfigWatcher] Watcher is ready and monitoring files");
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
