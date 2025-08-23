const fs = require("fs/promises");
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
  // 開發時：electron_app/config
  return path.join(process.cwd(), "config");
}

async function ensureDefaultConfigs(app) {
  const configDir = resolveConfigDir(app);
  await ensureDir(configDir);

  await writeJsonIfMissing(path.join(configDir, "theme.json"), {
    version: 1,
    theme: {
      backgroundColor: [0, 0, 0], // 對應 --background-color (r,g,b)
      backgroundOpacity: 0.25, // 對應 --background-opacity
      backdropBlurPx: 20, // 對應 --backdrop-blur (px)
      textColor: [255, 255, 255], // 對應 --text-color (r,g,b)
      mainTextOpacity: 1, // 對應 --main-text-opacity
      secondaryTextOpacity: 0.5, // 對應 --secondary-text-opacity
      baseFontSizePx: 16, // 對應 :root font-size
    },
  });

  await writeJsonIfMissing(path.join(configDir, "ui.json"), {
    ui: {
      scale: 1.0, // 會乘上 baseFontSizePx
      windowOpacity: 0.98, // 套用在 <body> 的整體透明度
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
