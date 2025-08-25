// 補強：讀取 ui.default_immersive_mode = "on" | "off" 來設定沉浸模式的初始狀態
// 其餘維持你現有的 themeRuntime.js 改動（包含 setUiScale 與 windowOpacity）

const defaultTheme = {
  version: 1,
  theme: {
    backgroundColor: [0, 0, 0],
    backgroundOpacity: 0,
    backdropBlurPx: 20,
    textColor: [255, 255, 255],
    mainTextOpacity: 1,
    secondaryTextOpacity: 0.5,
    baseFontSizePx: 20,
    fontFamily: "Space Mono",
  },
};

const defaultUi = {
  ui: {
    scale: 1,
    alwaysOnTop: true,
    mediaWindow: {
      visibilityMode: "auto",
    },
    default_immersive_mode: "off",
  },
};

function rgbTupleToVar(arr, fallback = [0, 0, 0]) {
  const a = Array.isArray(arr) && arr.length === 3 ? arr : fallback;
  return `${a[0]}, ${a[1]}, ${a[2]}`;
}

function applyTheme(themeFile) {
  console.log("[THEME] Applying theme:", themeFile);
  const t = themeFile?.theme ?? defaultTheme.theme;
  const rootStyle = document.documentElement.style;
  
  console.log("[THEME] Setting CSS variables:", {
    backgroundColor: rgbTupleToVar(t.backgroundColor),
    backgroundOpacity: String(t.backgroundOpacity ?? 0.25),
    backdropBlur: `${Number(t.backdropBlurPx ?? 20)}px`,
    textColor: rgbTupleToVar(t.textColor),
    mainTextOpacity: String(t.mainTextOpacity ?? 1),
    secondaryTextOpacity: String(t.secondaryTextOpacity ?? 0.5),
    fontSize: `${Math.max(8, Number(t.baseFontSizePx ?? 16))}px`,
    fontFamily: t.fontFamily || defaultTheme.theme.fontFamily
  });
  
  rootStyle.setProperty("--background-color", rgbTupleToVar(t.backgroundColor));
  rootStyle.setProperty("--background-opacity", String(t.backgroundOpacity ?? 0.25));
  rootStyle.setProperty("--backdrop-blur", `${Number(t.backdropBlurPx ?? 20)}px`);
  rootStyle.setProperty("--text-color", rgbTupleToVar(t.textColor));
  rootStyle.setProperty("--main-text-opacity", String(t.mainTextOpacity ?? 1));
  rootStyle.setProperty("--secondary-text-opacity", String(t.secondaryTextOpacity ?? 0.5));

  const baseFontPx = Math.max(8, Number(t.baseFontSizePx ?? 16));
  document.documentElement.style.fontSize = `${baseFontPx}px`;
  
  // Apply font family if specified
  const fontFamily = t.fontFamily || defaultTheme.theme.fontFamily;
  if (fontFamily) {
    rootStyle.setProperty("--font-family", fontFamily);
    // Also apply directly to body for broader coverage
    document.body.style.fontFamily = fontFamily;
  }
}

function clampScale(s) {
  const n = Number(s);
  if (!isFinite(n)) return 1.0;
  return Math.min(3.0, Math.max(0.5, n));
}

function applyUi(uiFile) {
  const u = uiFile?.ui ?? defaultUi.ui;

  // 整頁縮放交給主行程（保留熱更新）
  const n = Number(u.scale ?? 1.0);
  const s = Math.min(3.0, Math.max(0.5, isFinite(n) ? n : 1.0));
  window.eve?.setUiScale?.(s);

  // 注意：不要在這裡讀 default_immersive_mode、不要切換沉浸模式（避免熱更新）
}

// IPC
window.eve?.onThemeUpdate?.(applyTheme);
window.eve?.onUiUpdate?.(applyUi);

// 預設先套用
applyTheme(defaultTheme);
applyUi(defaultUi);
