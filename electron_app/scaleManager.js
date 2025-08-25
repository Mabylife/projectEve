const { ipcMain, screen } = require("electron");

let getWindows; // 回傳 [mainWin, mediaWin]
let baseBounds = { main: null, media: null };
let currentScale = 1;

let afterApplyCb = null;
let afterTimer = null;

function clampScale(s) {
  const n = Number(s);
  if (!isFinite(n)) return 1;
  return Math.min(3, Math.max(0.5, n));
}

// 記錄建立後的初始尺寸，做為縮放基準（只記第一次）
function captureBaseBounds() {
  const [mainWin, mediaWin] = (getWindows?.() || []).filter(Boolean);
  if (mainWin && !baseBounds.main) baseBounds.main = mainWin.getBounds();
  if (mediaWin && !baseBounds.media) baseBounds.media = mediaWin.getBounds();
}

function applyZoomAndResize(scale) {
  const [mainWin, mediaWin] = (getWindows?.() || []).filter(Boolean);
  if (!mainWin && !mediaWin) return;

  // 整頁縮放：包含所有 px 元素、圖片、間距
  if (mainWin && !mainWin.isDestroyed()) {
    const applyMainZoom = () => {
      try {
        if (mainWin.webContents && mainWin.webContents.isLoading()) {
          // Wait for content to finish loading
          mainWin.webContents.once('did-finish-load', () => {
            mainWin.webContents.setZoomFactor(scale);
            console.log(`[ScaleManager] Applied delayed zoom factor ${scale} to main window`);
          });
        } else {
          mainWin.webContents.setZoomFactor(scale);
          console.log(`[ScaleManager] Applied zoom factor ${scale} to main window`);
        }
      } catch (e) {
        console.error(`[ScaleManager] Failed to set zoom factor for main window:`, e.message);
      }
    };
    applyMainZoom();
  }
  if (mediaWin && !mediaWin.isDestroyed()) {
    const applyMediaZoom = () => {
      try {
        if (mediaWin.webContents && mediaWin.webContents.isLoading()) {
          // Wait for content to finish loading
          mediaWin.webContents.once('did-finish-load', () => {
            mediaWin.webContents.setZoomFactor(scale);
            console.log(`[ScaleManager] Applied delayed zoom factor ${scale} to media window`);
          });
        } else {
          mediaWin.webContents.setZoomFactor(scale);
          console.log(`[ScaleManager] Applied zoom factor ${scale} to media window`);
        }
      } catch (e) {
        console.error(`[ScaleManager] Failed to set zoom factor for media window:`, e.message);
      }
    };
    applyMediaZoom();
  }

  // 確保已抓到基準尺寸
  captureBaseBounds();

  const wa = screen.getPrimaryDisplay().workArea;
  const topMargin = 24; // main 置頂邊距
  const rightGap = 30; // media 與 main 右側間距

  if (mainWin && baseBounds.main) {
    const newMainW = Math.round(baseBounds.main.width * scale);
    const newMainH = Math.round(baseBounds.main.height * scale);
    const x = Math.round(wa.x + (wa.width - newMainW) / 2); // 水平置中
    const y = Math.round(wa.y + topMargin); // 貼上方
    mainWin.setBounds({ x, y, width: newMainW, height: newMainH });
  }

  if (mediaWin && baseBounds.media && mainWin) {
    const newMediaW = Math.round(baseBounds.media.width * scale);
    const newMediaH = Math.round(baseBounds.media.height * scale);
    const mainB = mainWin.getBounds();
    const x2 = Math.round(mainB.x + mainB.width + rightGap); // 貼 main 右側
    const y2 = Math.round(mainB.y + mainB.height - newMediaH); // 與 main 底對齊
    mediaWin.setBounds({ x: x2, y: y2, width: newMediaW, height: newMediaH });
  }
}

function triggerAfterApply() {
  clearTimeout(afterTimer);
  // 防抖，避免連續多次 scale 變更造成多次閃爍
  afterTimer = setTimeout(() => {
    if (typeof afterApplyCb === "function") {
      try {
        afterApplyCb(currentScale);
      } catch {}
    }
  }, 100);
}

function initScaleManager(getWinFn, options = {}) {
  getWindows = getWinFn;
  afterApplyCb = options.afterApply || null;

  ipcMain.on("ui:set-scale", (_e, s) => {
    const scale = clampScale(s);
    currentScale = scale;
    applyZoomAndResize(scale);
    triggerAfterApply();
  });

  return {
    captureBaseBounds,
    setScale: (s) => {
      const scale = clampScale(s);
      currentScale = scale;
      applyZoomAndResize(scale);
      triggerAfterApply();
    },
    getScale: () => currentScale,
  };
}

module.exports = { initScaleManager };
