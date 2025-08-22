# Project Eve - Configuration System

This branch implements a config-driven UI hot reload system with secure IPC communication.

## Features Implemented

### 1. Config-driven UI Hot Reload
- **Config Files**: `config/theme.json` and `config/ui.json` with default values
- **File Watching**: Uses chokidar to watch for config file changes with debounced updates
- **Validation**: Basic validation for config structure before applying changes
- **Path Handling**: 
  - Dev mode: reads from project root `config/`
  - Packaged: reads from `userData/config` (creates defaults if missing)

### 2. Electron Main as Central Hub
- **Config Loading**: Main process loads and validates configurations on startup
- **IPC Channels**: 
  - `theme:update` - broadcasts theme changes to all windows
  - `ui:update` - broadcasts UI configuration changes
  - `config:error` - broadcasts configuration errors
- **Initial Push**: Sends config to windows after `did-finish-load`

### 3. Secure Renderer Communication
- **Preload Script**: `preload.js` with `contextIsolation: true` and `nodeIntegration: false`
- **API Exposure**: Minimal IPC APIs via `window.electronAPI`
- **Theme Application**: CSS variables for theme properties
- **UI Application**: Root font-size for scaling, body opacity for window transparency

### 4. Python Backend Fixes
- **Fixed `/mode` commands**: Now use proper dictionaries instead of sets
- **Fixed `/m` commands**: Media control mapping with list-based VK codes
- **Fixed DuckDuckGo search**: Corrected f-string syntax (removed backslash)
- **Robust `send_vk`**: Accepts both lists and comma-separated strings

## Usage

### Hot Reload Testing
1. Start the Electron app: `npm start` (in `electron_app/`)
2. Edit `config/theme.json` or `config/ui.json`
3. Changes are automatically applied without restart

### Theme Configuration (`config/theme.json`)
```json
{
  "primaryColor": "#3b82f6",
  "backgroundColor": "#0f172a",
  "textColor": "#f8fafc",
  ...
}
```

### UI Configuration (`config/ui.json`)
```json
{
  "scale": 1.0,
  "windowOpacity": 0.95,
  "enableAnimations": true,
  ...
}
```

### Fixed Commands
- `/mode silent|balanced|turbo` - Change power mode
- `/m p|toggle` - Media controls
- `-zen query` - DuckDuckGo search

## Technical Details

### Config System Architecture
1. **Main Process**: Loads configs, watches files, validates, broadcasts via IPC
2. **Renderer Process**: Receives IPC updates, applies CSS variables and UI changes
3. **Preload**: Secure bridge between main and renderer processes

### File Watching
- Uses chokidar for cross-platform file watching
- 300ms debounce to prevent rapid fire updates
- Automatic error handling and logging

### CSS Variables
All theme properties are applied as CSS custom properties:
- `--primary-color`, `--background-color`, etc.
- Applied to `:root` for global availability
- Used throughout CSS for consistent theming

## Migration Notes
- Renderer no longer directly reads files or calls Python for theme/UI
- Existing media/data fetching left in place with TODO comments for future migration
- All IPC communication goes through secure preload script