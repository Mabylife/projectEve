const path = require("path");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "ProjectEve",
    icon: path.resolve(__dirname, "assets", "icons", "app.ico"),
    extraResource: [
      path.resolve(__dirname, "assets", "bin"),
      path.resolve(__dirname, "assets", "defaults"),
      path.resolve(__dirname, "assets", "icons"),
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
        setupIcon: path.resolve(__dirname, "assets", "icons", "app.ico"),
        noMsi: true,
      },
    },
  ],
  plugins: [{ name: "@electron-forge/plugin-auto-unpack-natives", config: {} }],
};
