// renderer 側：即時把主進程廣播的 theme/ui 套用為 CSS 變數
// 注意：你目前 BrowserWindow 啟用了 nodeIntegration: true, contextIsolation: false
// 因此可以直接使用 require('electron').ipcRenderer

const { ipcRenderer } = require("electron");

const defaultTheme = {
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
};

const defaultUi = {
  ui: {
    scale: 1.0,
    windowOpacity: 0.98,
  },
};

function rgbTupleToVar(arr, fallback = [0, 0, 0]) {
  const a = Array.isArray(arr) && arr.length === 3 ? arr : fallback;
  return `${a[0]}, ${a[1]}, ${a[2]}`;
}

function applyTheme(themeFile) {
  const t = themeFile?.theme ?? defaultTheme.theme;
  const rootStyle = document.documentElement.style;

  rootStyle.setProperty("--background-color", rgbTupleToVar(t.backgroundColor));
  rootStyle.setProperty("--background-opacity", String(t.backgroundOpacity ?? 0.25));
  rootStyle.setProperty("--backdrop-blur", `${Number(t.backdropBlurPx ?? 20)}px`);
  rootStyle.setProperty("--text-color", rgbTupleToVar(t.textColor));
  rootStyle.setProperty("--main-text-opacity", String(t.mainTextOpacity ?? 1));
  rootStyle.setProperty("--secondary-text-opacity", String(t.secondaryTextOpacity ?? 0.5));

  // 設定 :root 字級（之後 ui.scale 再乘上來）
  const base = Number(t.baseFontSizePx ?? 16);
  document.documentElement.style.fontSize = `${base}px`;
}

function applyUi(uiFile) {
  const u = uiFile?.ui ?? defaultUi.ui;

  // 根據 scale 調整 :root 字級
  const baseSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const scaled = Math.max(8, baseSizePx * Number(u.scale ?? 1.0));
  document.documentElement.style.fontSize = `${scaled}px`;

  // 視窗內容整體透明度
  if (typeof u.windowOpacity === "number") {
    document.body.style.opacity = String(u.windowOpacity);
  }
}

// 預設先套用，避免 FOUC
applyTheme(defaultTheme);
applyUi(defaultUi);

// 綁定 IPC
ipcRenderer.on("theme:update", (_, data) => applyTheme(data));
ipcRenderer.on("ui:update", (_, data) => applyUi(data));
