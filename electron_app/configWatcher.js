const path = require("path");
const chokidar = require("chokidar");
const { app } = require("electron");
const { ensureDefaultConfigs, loadAllConfigs, readJsonSafe, resolveConfigDir } = require("./configLoader");

let latestTheme = null;
let latestUi = null;

function broadcastToAll(getWindows, channel, payload) {
  const windows = (getWindows?.() || []).filter(Boolean);
  windows.forEach((w) => {
    try {
      w.webContents.send(channel, payload);
    } catch {}
  });
}

async function setupConfigHotReload(getWindows) {
  const configDir = await ensureDefaultConfigs(app);

  // 首次載入
  const { theme, ui } = await loadAllConfigs(app);
  latestTheme = theme;
  latestUi = ui;

  // 首次廣播
  broadcastToAll(getWindows, "theme:update", latestTheme);
  broadcastToAll(getWindows, "ui:update", latestUi);

  // 監看兩個檔案
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
        latestTheme = data;
        broadcastToAll(getWindows, "theme:update", latestTheme);
      } else if (file === "ui.json") {
        latestUi = data;
        broadcastToAll(getWindows, "ui:update", latestUi);
      }
    }, 100);
  });

  return {
    configDir,
    close: () => watcher.close(),
    getLatest: () => ({ theme: latestTheme, ui: latestUi }),
  };
}

module.exports = { setupConfigHotReload, resolveConfigDir };
