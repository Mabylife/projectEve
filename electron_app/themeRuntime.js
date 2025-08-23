// 用 preload 暴露的 API 套用 theme/ui
// 重點：scale 不再動字級，改通知主程序做整頁縮放與視窗重算

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

  // 只設定字體基準，避免和縮放打架
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

  // 視窗內容整體透明度
  if (typeof u.windowOpacity === "number") {
    document.body.style.opacity = String(u.windowOpacity);
  }

  // 整頁縮放 + 視窗尺寸/位置重算交給主程序
  const s = clampScale(u.scale ?? 1.0);
  window.eve?.setUiScale?.(s);
}

// 預設先套用
applyTheme(defaultTheme);
applyUi(defaultUi);

// 綁 IPC
window.eve?.onThemeUpdate?.(applyTheme);
window.eve?.onUiUpdate?.(applyUi);
