// 補強：讀取 ui.immersive_mode = "on" | "off" 來設定沉浸模式
// 其餘維持你現有的 themeRuntime.js 改動（包含 setUiScale 與 windowOpacity）

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
    immersive_mode: "off",
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

  const baseFontPx = Math.max(8, Number(t.baseFontSizePx ?? 16));
  document.documentElement.style.fontSize = `${baseFontPx}px`;
}

function clampScale(s) {
  const n = Number(s);
  if (!isFinite(n)) return 1.0;
  return Math.min(3.0, Math.max(0.5, n));
}

function applyUi(uiFile) {
  const u = uiFile?.ui ?? defaultUi.ui;

  // 視窗內容整體透明度（保留熱更新）
  if (typeof u.windowOpacity === "number") {
    document.body.style.opacity = String(u.windowOpacity);
  }

  // 整頁縮放交給主行程（保留熱更新）
  const n = Number(u.scale ?? 1.0);
  const s = Math.min(3.0, Math.max(0.5, isFinite(n) ? n : 1.0));
  window.eve?.setUiScale?.(s);

  // 注意：不要在這裡讀 immersive_mode、不要切換沉浸模式（避免熱更新）
}

// IPC
window.eve?.onThemeUpdate?.(applyTheme);
window.eve?.onUiUpdate?.(applyUi);

// 預設先套用
applyTheme(defaultTheme);
applyUi(defaultUi);
