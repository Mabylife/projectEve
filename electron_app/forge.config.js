const path = require("path");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "ProjectEve",
    // 這裡改成你的 .ico 實際位置（必須是 .ico）
    icon: path.resolve(__dirname, "assets", "icons", "app.ico"),
    extraResource: [
      path.resolve(__dirname, "assets", "bin"),
      path.resolve(__dirname, "assets", "defaults"),
      path.resolve(__dirname, "assets", "icons"), // 你已加，這是給托盤用的
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "ProjectEve",
        authors: "Mabylife",
        exe: "ProjectEve.exe",
        setupExe: "ProjectEve-Setup-${version}.exe",
        // 安裝程式圖示也指到同一顆 .ico
        setupIcon: path.resolve(__dirname, "assets", "icons", "app.ico"),
        noMsi: true,
      },
    },
  ],
  plugins: [{ name: "@electron-forge/plugin-auto-unpack-natives", config: {} }],
};
