#!/usr/bin/env node
/**
 * Test script to verify JSON hot reload functionality
 * Run with: node test-hot-reload.js
 */

const path = require('path');
const fs = require('fs/promises');

async function testJsonHotReload() {
  console.log('🧪 Testing JSON Hot Reload Functionality\n');

  try {
    const { setupConfigHotReload, loadAllConfigs } = require('./configWatcher');
    
    console.log('📂 Loading initial configurations...');
    const initialConfigs = await loadAllConfigs();
    console.log('✅ Initial theme version:', initialConfigs.theme?.version);
    console.log('✅ Initial UI scale:', initialConfigs.ui?.ui?.scale);
    console.log();

    let changeCount = 0;
    
    console.log('🔥 Setting up hot reload watcher...');
    const hotReload = await setupConfigHotReload(() => [], {
      onThemeChange: (theme) => {
        changeCount++;
        console.log(`🎨 Theme change detected (#${changeCount}):`, {
          backgroundColor: theme.theme?.backgroundColor,
          textColor: theme.theme?.textColor,
          fontFamily: theme.theme?.fontFamily
        });
      },
      onUiChange: (ui) => {
        changeCount++;
        console.log(`🖥️  UI change detected (#${changeCount}):`, {
          scale: ui.ui?.scale,
          immersiveMode: ui.ui?.default_immersive_mode,
          alwaysOnTop: ui.ui?.alwaysOnTop
        });
      }
    });

    console.log('✅ Hot reload watcher is active and monitoring files');
    console.log();
    console.log('📝 Instructions for testing:');
    console.log('1. Edit electron_app/config/theme.json - change backgroundColor, textColor, etc.');
    console.log('2. Edit electron_app/config/ui.json - change scale, default_immersive_mode, etc.');
    console.log('3. Save the files and watch this console for change notifications');
    console.log();
    console.log('Press Ctrl+C to stop monitoring...\n');

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping hot reload watcher...');
      hotReload.close();
      console.log(`📊 Total changes detected: ${changeCount}`);
      console.log('✅ Test completed successfully!');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  testJsonHotReload();
}

module.exports = { testJsonHotReload };