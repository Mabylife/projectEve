// configManager.js - Simplified, robust config system
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const { app } = require("electron");

class ConfigManager {
  constructor() {
    this.configs = {
      theme: null,
      ui: null,
      commands: null,
    };
    this.watchers = new Map();
    this.listeners = new Map();
    this.isInitialized = false;
    this.getWindows = null;
    this.fileChangeTimeouts = new Map(); // For debouncing file changes
  }

  // Get config directory path
  getConfigDir() {
    if (app && app.isPackaged) {
      return path.join(app.getPath("userData"), "config");
    }

    // Development mode: check multiple possible locations
    const candidates = [path.join(process.cwd(), "config"), path.join(process.cwd(), "electron_app", "config"), path.join(__dirname, "config")];

    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        return dir;
      }
    }

    // Default fallback
    return path.join(process.cwd(), "config");
  }

  // Ensure config directory exists
  async ensureConfigDir() {
    const configDir = this.getConfigDir();
    await fs.promises.mkdir(configDir, { recursive: true });
    return configDir;
  }

  // Default configurations
  getDefaultConfigs() {
    return {
      theme: {
        version: 1,
        theme: {
          backgroundColor: [0, 0, 0],
          backgroundOpacity: 0.25,
          backdropBlurPx: 20,
          textColor: [255, 255, 255],
          mainTextOpacity: 1,
          secondaryTextOpacity: 0.5,
          baseFontSizePx: 16,
          fontFamily: "Space Mono",
        },
      },
      ui: {
        ui: {
          scale: 1,
          alwaysOnTop: true,
          mediaWindow: {
            visibilityMode: "auto",
          },
          default_immersive_mode: "off",
        },
      },
      commands: {
        version: 1,
        commands: [
          {
            id: "open_notepad",
            name: "記事本",
            action: { type: "process", cmd: "notepad.exe", args: [] },
          },
          {
            id: "pause_media",
            name: "媒體暫停/播放",
            action: { type: "key", keys: ["mediaPlayPause"] },
          },
        ],
      },
    };
  }

  // Read JSON file safely
  async readJsonSafe(filePath) {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.warn(`[ConfigManager] Failed to read ${filePath}:`, error.message);
      return null;
    }
  }

  // Write JSON file safely with atomic operation
  async writeJsonSafe(filePath, data) {
    const tempPath = filePath + ".tmp";
    try {
      await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.promises.rename(tempPath, filePath);
      return true;
    } catch (error) {
      console.error(`[ConfigManager] Failed to write ${filePath}:`, error.message);
      try {
        await fs.promises.unlink(tempPath);
      } catch {}
      return false;
    }
  }

  // Create config file if it doesn't exist
  async ensureConfigFile(configName) {
    const configDir = await this.ensureConfigDir();
    const filePath = path.join(configDir, `${configName}.json`);

    if (!fs.existsSync(filePath)) {
      const defaults = this.getDefaultConfigs();
      await this.writeJsonSafe(filePath, defaults[configName]);
      console.log(`[ConfigManager] Created default ${configName}.json`);
    }

    return filePath;
  }

  // Load all configs
  async loadConfigs() {
    const configNames = ["theme", "ui", "commands"];
    const defaults = this.getDefaultConfigs();

    for (const name of configNames) {
      try {
        const filePath = await this.ensureConfigFile(name);
        const config = await this.readJsonSafe(filePath);
        this.configs[name] = config || defaults[name];
        console.log(`[ConfigManager] Loaded ${name} config`);
      } catch (error) {
        console.error(`[ConfigManager] Error loading ${name} config:`, error.message);
        this.configs[name] = defaults[name];
      }
    }

    return { ...this.configs };
  }

  // Initialize config system
  async initialize(getWindowsFunction, options = {}) {
    this.getWindows = getWindowsFunction;

    console.log("[ConfigManager] Initializing config system...");

    // Load all configs
    await this.loadConfigs();

    // Set up event listeners
    if (options.onThemeChange) this.on("theme:change", options.onThemeChange);
    if (options.onUiChange) this.on("ui:change", options.onUiChange);
    if (options.onCommandsChange) this.on("commands:change", options.onCommandsChange);

    // Trigger initial callbacks for main process
    this.emit("theme:change", this.configs.theme);
    this.emit("ui:change", this.configs.ui);
    this.emit("commands:change", this.configs.commands);

    // Start watching for changes
    await this.startWatching();

    this.isInitialized = true;
    console.log("[ConfigManager] Initialization complete");

    return this;
  }

  // Send initial configs to windows once they're ready
  async sendInitialConfigsToWindows() {
    console.log("[ConfigManager] Sending initial configs to windows...");
    
    // Broadcast initial configs to all windows
    this.broadcastToAllWindows("theme:update", this.configs.theme);
    this.broadcastToAllWindows("ui:update", this.configs.ui);
    this.broadcastToAllWindows("commands:update", this.configs.commands);
    
    console.log("[ConfigManager] Initial configs sent to windows");
  }

  // Start file watching for hot reload
  async startWatching() {
    const configDir = this.getConfigDir();
    const configFiles = ["theme.json", "ui.json", "commands.json"];

    for (const fileName of configFiles) {
      const filePath = path.join(configDir, fileName);

      if (this.watchers.has(fileName)) {
        this.watchers.get(fileName).close();
      }

      try {
        const watcher = chokidar.watch(filePath, {
          ignoreInitial: true,
          persistent: true,
          usePolling: false,
          awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50,
          },
        });

        watcher.on("change", async () => {
          console.log(`[ConfigManager] Detected change in ${fileName}`);
          
          // Debounce file changes to handle editors that write multiple times
          if (this.fileChangeTimeouts.has(fileName)) {
            clearTimeout(this.fileChangeTimeouts.get(fileName));
          }
          
          const timeout = setTimeout(async () => {
            this.fileChangeTimeouts.delete(fileName);
            await this.handleFileChange(fileName, filePath);
          }, 200); // 200ms debounce
          
          this.fileChangeTimeouts.set(fileName, timeout);
        });

        watcher.on("error", (error) => {
          console.error(`[ConfigManager] Watcher error for ${fileName}:`, error.message);
        });

        this.watchers.set(fileName, watcher);
        console.log(`[ConfigManager] Watching ${fileName}`);
      } catch (error) {
        console.error(`[ConfigManager] Failed to watch ${fileName}:`, error.message);
      }
    }
  }

  // Handle file changes
  async handleFileChange(fileName, filePath) {
    const configName = fileName.replace(".json", "");
    const newConfig = await this.readJsonSafe(filePath);

    if (!newConfig) {
      console.warn(`[ConfigManager] Failed to load changed config: ${fileName}`);
      return;
    }

    // Update internal state
    const oldConfig = this.configs[configName];
    this.configs[configName] = newConfig;

    // For UI config, handle special case: default_immersive_mode should not be hot-reloaded
    if (configName === "ui" && newConfig.ui) {
      const configToSend = { ...newConfig };
      if (configToSend.ui.default_immersive_mode !== undefined) {
        // Remove default_immersive_mode from hot reload update
        delete configToSend.ui.default_immersive_mode;
        console.log("[ConfigManager] Removed default_immersive_mode from hot reload (startup-only setting)");
      }

      // Broadcast the modified config (without default_immersive_mode)
      this.broadcastToAllWindows("ui:update", configToSend);
      this.emit("ui:change", configToSend);
    } else {
      // For theme and commands, send full config
      this.broadcastToAllWindows(`${configName}:update`, newConfig);
      this.emit(`${configName}:change`, newConfig);
    }

    console.log(`[ConfigManager] Config ${configName} hot-reloaded successfully`);
  }

  // Broadcast to all windows
  broadcastToAllWindows(channel, data) {
    if (!this.getWindows) return;

    const windows = this.getWindows().filter(Boolean);
    console.log(`[ConfigManager] Broadcasting ${channel} to ${windows.length} window(s)`);

    windows.forEach((win, index) => {
      try {
        if (win && win.webContents && !win.isDestroyed()) {
          win.webContents.send(channel, data);
          console.log(`[ConfigManager] Sent ${channel} to window ${index}`);
        }
      } catch (error) {
        console.error(`[ConfigManager] Failed to send ${channel} to window ${index}:`, error.message);
      }
    });
  }

  // Event system
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  emit(event, ...args) {
    const eventListeners = this.listeners.get(event) || [];
    eventListeners.forEach((listener) => {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[ConfigManager] Error in listener for ${event}:`, error.message);
      }
    });
  }

  // Get current config
  getConfig(configName) {
    return this.configs[configName];
  }

  // Get all configs
  getAllConfigs() {
    return { ...this.configs };
  }

  // Clean up
  destroy() {
    console.log("[ConfigManager] Cleaning up...");

    // Clear any pending file change timeouts
    for (const [fileName, timeout] of this.fileChangeTimeouts) {
      clearTimeout(timeout);
      console.log(`[ConfigManager] Cleared pending timeout for ${fileName}`);
    }
    this.fileChangeTimeouts.clear();

    for (const [fileName, watcher] of this.watchers) {
      try {
        watcher.close();
        console.log(`[ConfigManager] Closed watcher for ${fileName}`);
      } catch (error) {
        console.error(`[ConfigManager] Error closing watcher for ${fileName}:`, error.message);
      }
    }

    this.watchers.clear();
    this.listeners.clear();
    this.isInitialized = false;
  }
}

// Export singleton instance
const configManager = new ConfigManager();

module.exports = {
  configManager,
  ConfigManager,
};
