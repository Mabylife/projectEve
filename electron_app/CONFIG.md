# Configuration System Documentation

This document explains the JSON configuration files used in Project Eve.

## ui.json

Controls the user interface behavior and window settings.

```json
{
  "ui": {
    "scale": 1.0,
    "alwaysOnTop": true,
    "mediaWindow": {
      "visibilityMode": "auto"
    },
    "default_immersive_mode": "off"
  }
}
```

### Settings

- **scale**: Controls the zoom level of the entire interface (0.5 to 3.0)
  - `1.0` = normal size
  - `1.2` = 20% larger
  - `0.8` = 20% smaller
  - Affects both window size and content scaling

- **alwaysOnTop**: Whether windows stay above other applications
  - `true` = windows stay on top
  - `false` = windows can be covered by other apps
  - Hot-reloadable: changes apply immediately

- **mediaWindow.visibilityMode**: Controls when the media window is shown
  - `"auto"` = show only when media is playing/paused
  - `"always"` = always show the media window
  - `"never"` = never show the media window

- **default_immersive_mode**: Initial state of immersive mode when app starts
  - `"off"` = start with normal quote view
  - `"on"` = start with immersive media view
  - Only applies on first launch, not during hot reload

## theme.json

Controls the visual appearance and styling.

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
    "baseFontSizePx": 16,
    "fontFamily": "Space Mono"
  }
}
```

### Settings

- **backgroundColor**: RGB color array for background [R, G, B]
  - Example: `[0, 0, 0]` = black, `[255, 255, 255]` = white

- **backgroundOpacity**: Transparency of the background (0.0 to 1.0)
  - `0.0` = fully transparent
  - `1.0` = fully opaque

- **backdropBlurPx**: Blur effect strength in pixels
  - Higher values = more blur

- **textColor**: RGB color array for text [R, G, B]

- **mainTextOpacity**: Opacity for primary text (0.0 to 1.0)

- **secondaryTextOpacity**: Opacity for secondary/label text (0.0 to 1.0)

- **baseFontSizePx**: Base font size in pixels
  - All text scales relative to this value

- **fontFamily**: Font family name
  - Built-in options: "Space Mono", "Arial", "Helvetica", etc.

## Hot Reload

Both configuration files support hot reload - changes are applied immediately when you save the file while the application is running.

**Exception**: `default_immersive_mode` only applies on app startup, not during hot reload.

## File Locations

- Development: `electron_app/config/`
- Packaged app: `%APPDATA%/project-eve/config/` (Windows)

## Troubleshooting

If configurations aren't applying:

1. Check the console logs for configuration errors
2. Verify JSON syntax is valid
3. Ensure file paths are correct
4. Try restarting the application
5. Check that config files have proper read permissions