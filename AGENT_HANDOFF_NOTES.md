# Configuration System Fixes - Documentation for Future Agent

## Issues Fixed

### 1. theme.json Not Loading on App Launch ✅ FIXED
**Problem**: Theme configurations weren't being applied when the app started.

**Root Cause**: The configManager was broadcasting theme updates to windows immediately after initialization, but the windows weren't ready to receive IPC messages yet.

**Solution**: 
- Modified `configManager.initialize()` to delay initial config broadcasting
- Added `sendInitialConfigsToWindows()` method that gets called after windows are ready
- Added `did-finish-load` event listeners in main.js to trigger config broadcast once windows have loaded content

**Files Changed**:
- `configManager.js`: Added delayed broadcasting logic
- `main.js`: Added window ready event handlers

### 2. theme.json CSS Variable Bug ✅ FIXED
**Problem**: Theme colors weren't being applied correctly due to CSS variable format mismatch.

**Root Cause**: The `arrToRgb()` function was returning `rgb(255, 0, 0)` format, but CSS variables expected comma-separated values like `255, 0, 0` to work with `rgba(var(--color), opacity)`.

**Solution**: Fixed `arrToRgb()` function in renderer.js to return comma-separated values instead of full RGB strings.

**Files Changed**:
- `renderer.js`: Fixed arrToRgb function (line ~55)

### 3. default_immersive_mode Not Working ✅ FIXED  
**Problem**: The `default_immersive_mode` setting in ui.json didn't affect the initial state of the app.

**Root Cause**: Same as issue #1 - UI configs weren't being sent to renderer at the right time.

**Solution**: The window ready event fix also resolved this issue. The `isInitialLoad` flag in renderer.js ensures default_immersive_mode only applies on startup, not during hot-reload.

**Files Changed**:
- Same as issue #1

### 4. Theme Hot-Reload Consistency ✅ IMPROVED
**Problem**: First theme change worked, but subsequent changes were inconsistent.

**Root Cause**: Potential file watcher timing issues and font size management conflicts.

**Solutions**:
- Added 200ms debouncing to file change detection to handle editors that write files multiple times
- Fixed font size management by separating base font size (theme) from scaling (UI config)
- Updated CSS to use rem units for better scaling consistency

**Files Changed**:
- `configManager.js`: Added debouncing logic
- `renderer.js`: Improved font scaling logic
- `component.css`: Changed to rem units

### 5. Code Cleanup ✅ COMPLETED
**Removed Unused Files**:
- `configLoader.js` - Legacy config loading (replaced by configManager.js)
- `configWatcher.js` - Legacy file watching (replaced by configManager.js)  
- `themeRuntime.js` - Legacy theme runtime (functionality moved to renderer.js)

## Current System Architecture

### Configuration Flow:
1. **App Startup**: configManager loads JSON files from `/config/` directory
2. **Window Creation**: Main process creates windows and waits for them to be ready
3. **Initial Broadcast**: Once windows finish loading content, configs are sent via IPC
4. **Renderer Application**: renderer.js receives configs and applies them to DOM
5. **Hot Reload**: File watchers detect changes and broadcast updates (with debouncing)

### Key Files:
- `configManager.js`: Central config system with file watching
- `renderer.js`: Frontend logic that applies configs to UI
- `main.js`: Main process coordination
- `config/*.json`: Configuration files (theme.json, ui.json, commands.json)

## Testing Done

Created and ran test script (`/tmp/test_config_behavior.js`) that validates:
- CSS variable format fixes
- Default immersive mode logic
- Configuration loading order
- Hot-reload behavior

## Known Working Features

✅ **ui.json**:
- `scale`: Font scaling works correctly
- `alwaysOnTop`: Window always-on-top behavior works
- `mediaWindow.visibilityMode`: Media window visibility works
- `default_immersive_mode`: Now works correctly on app startup

✅ **theme.json**:
- Theme is applied correctly on startup
- Hot-reload should work consistently with debouncing
- CSS variables are properly formatted

## Potential Issues for Future Investigation

### 1. Linux Testing Limitation
The app was tested on Linux where Mica effects don't work. Real testing should be done on Windows to verify:
- Window transparency and effects
- Complete visual theme application
- Font rendering with custom fonts

### 2. File Watcher Edge Cases
If theme hot-reload still has issues, investigate:
- Different text editors (VS Code, Notepad++, etc.) and their file write patterns
- Network drives or special file systems
- Very rapid successive file changes

### 3. Font Loading
The system assumes "Space Mono" font is available. Verify:
- Font file loading from `assets/SpaceMono-Regular.ttf`
- Fallback behavior when font is missing
- Font rendering on different systems

## Configuration Examples

### theme.json
```json
{
  "version": 1,
  "theme": {
    "backgroundColor": [30, 30, 30],
    "backgroundOpacity": 0.85,
    "backdropBlurPx": 25,
    "textColor": [220, 220, 220],
    "mainTextOpacity": 1,
    "secondaryTextOpacity": 0.6,
    "baseFontSizePx": 18,
    "fontFamily": "Space Mono"
  }
}
```

### ui.json
```json
{
  "ui": {
    "scale": 1.2,
    "alwaysOnTop": true,
    "mediaWindow": {
      "visibilityMode": "auto"
    },
    "default_immersive_mode": "on"
  }
}
```

## Notes for Debugging

- Enable dev mode in main.js (`devMode = true`) for developer tools
- Check console logs with prefixes: `[ConfigManager]`, `[EVE][THEME]`, `[EVE][UI]`
- File changes are logged with timing information
- Use the test script in `/tmp/` to validate fixes

## Commands.json Status

**IMPORTANT**: commands.json functionality was explicitly excluded from this work scope as requested. The file watching and loading works, but the command execution system should not be modified.

---

*This documentation was created after fixing the theme and UI configuration issues in Project Eve.*