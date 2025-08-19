const { app, BrowserWindow, globalShortcut } = require("electron");
const glasstron = require("glasstron");
const { setBackgroundColor } = require("glasstron/src/browser_window");

const { PARAMS, VALUE, MicaBrowserWindow, IS_WINDOWS_11, WIN10 } = require("mica-electron");
const path = require("path");

function createWindow() {
  const main = new MicaBrowserWindow({
    width: 1200,
    height: 700,
    x: 680, // 距離螢幕左邊 680px
    y: 370, // 距離螢幕上方 370px
    frame: false, // 無邊框
    transparent: true, // 可半透明
    skipTaskbar: false, // 不顯示在工作列
    focusable: true, // 可聚焦
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      experimentalFeatures: true,
    },
  });

  main.setRoundedCorner();
  main.setDarkTheme();
  main.setMicaAcrylicEffect();
  main.alwaysFocused(true); // -> allows you to keep the mica effects even if the window is no focus (decrease performance)
  main.loadFile("index.html");

  // 預設隱藏
  main.hide();

  const media = new MicaBrowserWindow({
    width: 300,
    height: 511,
    x: 1910, // 距離螢幕左邊 1910px
    y: 559, // 距離螢幕上方 559px
    frame: false, // 無邊框
    transparent: true, // 可半透明
    skipTaskbar: true, // 不顯示在工作列
    focusable: false, // 可聚焦
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      experimentalFeatures: true,
    },
  });

  media.setRoundedCorner();
  media.setDarkTheme();
  media.setMicaAcrylicEffect();
  media.loadFile("mediaCard.html");

  // 預設隱藏
  media.hide();

  // 註冊全域快捷鍵，顯示/隱藏視窗
  globalShortcut.register("CommandOrControl+Space", () => {
    if (main.isVisible()) {
      media.hide();
      main.hide();
    } else {
      main.show();
      media.show();
      main.focus();
      main.webContents.send("focus-input"); // 傳訊息給 renderer
    }
  });
}

app.whenReady().then(createWindow);

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
