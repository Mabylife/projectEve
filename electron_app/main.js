const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron");

const { PARAMS, VALUE, MicaBrowserWindow, IS_WINDOWS_11, WIN10 } = require("mica-electron");
const path = require("path");

let isplaying = false;
let isImmOn = false;

let media;
let main;

function createWindow() {
  main = new MicaBrowserWindow({
    resizable: false,
    width: 1200,
    height: 700,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  main.setRoundedCorner();
  main.setDarkTheme();
  main.setMicaAcrylicEffect();
  main.alwaysFocused(true);
  main.loadFile("index.html");

  main.center(); // 先置中
  main.show();
  setTimeout(() => {
    main.hide();
  }, 100);

  // 取得 main 的位置與尺寸
  const mainBounds = main.getBounds();

  // 計算 media 的位置
  const mediaWidth = 300;
  const mediaHeight = 511;
  const mediaX = mainBounds.x + mainBounds.width + 30; // main 右邊界 + 30px
  const mediaY = mainBounds.y + mainBounds.height - mediaHeight; // main 下邊界貼齊

  media = new MicaBrowserWindow({
    resizable: false,
    width: mediaWidth,
    height: mediaHeight,
    x: mediaX,
    y: mediaY,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  media.setRoundedCorner();
  media.setDarkTheme();
  media.setMicaAcrylicEffect();
  media.loadFile("mediaCard.html");

  media.show();
  setTimeout(() => {
    media.hide();
  }, 100);

  globalShortcut.register("CommandOrControl+Space", () => {
    if (main.isVisible()) {
      media.hide();
      main.hide();
      return;
    } else {
      if (isplaying && !isImmOn) {
        media.show();
      }
      main.show();
      main.focus();
      main.webContents.send("focus-input");
      return;
    }
  });
}

app.whenReady().then(createWindow);

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.on("send-variable", (event, data) => {
  if (data.mediaStatus == "playing" || data.mediaStatus == "paused") {
    isplaying = true;
  } else {
    isplaying = false;
  }
  isImmOn = data.isImmOn;

  if (isplaying && !isImmOn) {
    if (main.isVisible()) {
      media.show();
    }
  } else if (!isplaying || isImmOn) {
    media.hide();
  }
});
