# JSON Hot Reload Functionality

This document explains how the JSON hot reload functionality works in ProjectEve.

## Overview

The JSON hot reload system automatically detects changes to configuration files and updates the application in real-time without requiring a restart.

## Supported Files

- **`config/theme.json`** - Theme settings (colors, fonts, opacity, blur effects)
- **`config/ui.json`** - UI settings (scale, window behavior, immersive mode)

## How It Works

1. **File Watching**: Uses `chokidar` to monitor config files for changes
2. **Change Detection**: Detects when files are modified and saved
3. **Validation**: Validates JSON syntax and structure
4. **Broadcasting**: Sends updates via IPC to all renderer processes
5. **Application**: Renderer processes apply changes to the UI immediately

## File Structure

### theme.json
```json
{
  "version": 1,
  "theme": {
    "backgroundColor": [0, 0, 0],
    "backgroundOpacity": 0.25,
    "backdropBlurPx": 20,
    "textColor": [255, 255, 255],
    "mainTextOpacity": 1,
    "secondaryTextOpacity": 0.5,
    "fontFamily": "Space Mono"
  }
}
```

### ui.json
```json
{
  "ui": {
    "scale": 1.0,
    "alwaysOnTop": true,
    "nodeIntegration": true,
    "contextIsolation": false,
    "mediaWindow": {
      "visibilityMode": "auto"
    },
    "default_immersive_mode": "on"
  }
}
```

## Testing Hot Reload

Run the test script to verify functionality:

```bash
cd electron_app
node test-hot-reload.js
```

Then edit the config files while the script is running to see real-time change detection.

## Implementation Files

- **`configWatcher.js`** - Main hot reload system
- **`configLoader.js`** - Configuration loading utilities
- **`main.js`** - Initializes hot reload (line ~403)
- **`renderer.js`** - Handles theme/UI updates (lines ~253-260)

## Troubleshooting

If hot reload isn't working:

1. Check that `chokidar` dependency is installed: `npm list chokidar`
2. Verify config files exist in `electron_app/config/`
3. Ensure JSON syntax is valid
4. Check console logs for error messages
5. Run `test-hot-reload.js` to diagnose issues