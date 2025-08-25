const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

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

function resolveConfigDir(app) {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "config");
  }
  // 開發模式：盡量容錯，支援從 repo 根目錄或 electron_app 目錄啟動
  const candidates = [path.join(process.cwd(), "config"), path.join(process.cwd(), "electron_app", "config"), path.join(app.getAppPath(), "config")];
  for (const dir of candidates) {
    if (fssync.existsSync(dir)) return dir;
  }
  // 預設 fallback
  return path.join(process.cwd(), "config");
}

async function ensureDefaultConfigs(app) {
  const configDir = resolveConfigDir(app);
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
      mediaWindow: {
        visibilityMode: "auto",
      },
      default_immersive_mode: "off",
    },
  });

  return configDir;
}

async function loadAllConfigs(app) {
  const dir = resolveConfigDir(app);
  const theme = (await readJsonSafe(path.join(dir, "theme.json"))) || {};
  const ui = (await readJsonSafe(path.join(dir, "ui.json"))) || {};
  return { dir, theme, ui };
}

module.exports = {
  resolveConfigDir,
  ensureDefaultConfigs,
  loadAllConfigs,
  readJsonSafe,
};
