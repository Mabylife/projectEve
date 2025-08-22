#!/usr/bin/env python3
"""
Media Controller for Project Eve
Fixed version with proper mode and media commands
"""

import json
import ctypes
import ctypes.wintypes
from flask import Flask, request, jsonify
import urllib.parse
import subprocess
import sys

app = Flask(__name__)

# Virtual key codes for modes
MODE_MAPS = {
    'silent': [0x11, 0x10, 0x12, 0x7F],
    'sil': [0x11, 0x10, 0x12, 0x7F],
    'balanced': [0x11, 0x10, 0x12, 0x80],
    'bal': [0x11, 0x10, 0x12, 0x80],
    'turbo': [0x11, 0x10, 0x12, 0x81],
    'tur': [0x11, 0x10, 0x12, 0x81]
}

# Media control maps
MEDIA_MAPS = {
    'p': [0xB3],  # Play/Pause
    'toggle': [0xB3]  # Play/Pause toggle
}

def send_vk(vk_codes, mode='combo'):
    """
    Send virtual key codes. Fixed to accept list of key codes.
    Also accepts comma-separated string for robustness.
    """
    try:
        # Handle both list and comma-separated string input
        if isinstance(vk_codes, str):
            vk_codes = [int(code.strip()) for code in vk_codes.split(',')]
        elif not isinstance(vk_codes, list):
            vk_codes = [vk_codes]
        
        if mode == 'combo':
            # Press all keys down
            for vk in vk_codes:
                ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
            
            # Release all keys up
            for vk in reversed(vk_codes):
                ctypes.windll.user32.keybd_event(vk, 0, 2, 0)
        else:
            # Send individual key presses
            for vk in vk_codes:
                ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
                ctypes.windll.user32.keybd_event(vk, 0, 2, 0)
        
        return True
    except Exception as e:
        print(f"send_vk error: {e}")
        return False

def _parse_vk_list(vk_string):
    """
    Parse virtual key list from string. Made robust to handle comma-separated strings.
    """
    try:
        if isinstance(vk_string, str):
            return [int(code.strip()) for code in vk_string.split(',')]
        return vk_string
    except:
        return []

@app.route('/terminal/run', methods=['POST'])
def terminal_run():
    """Handle terminal commands including mode and media controls"""
    try:
        data = request.get_json()
        if not data or 'input' not in data:
            return jsonify({'success': False, 'output': ['Invalid input']})
        
        cmd = data['input'].strip()
        output = []
        success = True
        
        # Handle mode commands - Fixed implementation
        if cmd.startswith('/mode ') or cmd.startswith('-mode '):
            mode_name = cmd.split(' ', 1)[1].strip().lower()
            if mode_name in MODE_MAPS:
                if send_vk(MODE_MAPS[mode_name], mode='combo'):
                    output.append(f"Power mode changed to: {mode_name}")
                    return jsonify({
                        'success': True,
                        'output': output,
                        'isChangePowerMode': True,
                        'mode': mode_name
                    })
                else:
                    output.append(f"Failed to change power mode to: {mode_name}")
                    success = False
            else:
                available_modes = ', '.join(MODE_MAPS.keys())
                output.append(f"Unknown mode: {mode_name}")
                output.append(f"Available modes: {available_modes}")
                success = False
        
        # Handle /m prefix commands - Fixed implementation
        elif cmd.startswith('/m ') or cmd.startswith('-m '):
            media_cmd = cmd.split(' ', 1)[1].strip().lower()
            if media_cmd in MEDIA_MAPS:
                if send_vk(MEDIA_MAPS[media_cmd], mode='single'):
                    output.append(f"Media command executed: {media_cmd}")
                else:
                    output.append(f"Failed to execute media command: {media_cmd}")
                    success = False
            else:
                available_cmds = ', '.join(MEDIA_MAPS.keys())
                output.append(f"Unknown media command: {media_cmd}")
                output.append(f"Available commands: {available_cmds}")
                success = False
        
        # Handle zen search with fixed f-string syntax
        elif cmd.startswith('-zen '):
            query = cmd[5:].strip()
            if query:
                encoded = urllib.parse.quote_plus(query)
                # Fixed: Use proper f-string syntax without backslash
                url = f"https://duckduckgo.com/?q={encoded}&t=h_&ia=web"
                try:
                    subprocess.run(['start', url], shell=True, check=True)
                    output.append(f"Searching DuckDuckGo for: {query}")
                except Exception as e:
                    output.append(f"Failed to open browser: {e}")
                    success = False
            else:
                output.append("Please provide a search query")
                success = False
        
        # Handle help commands
        elif cmd in ['help', '/help', '-help']:
            output.extend([
                "Available commands:",
                "/mode [silent|balanced|turbo] - Change power mode",
                "/m [p|toggle] - Media controls",
                "-zen [query] - Search DuckDuckGo",
                "help - Show this help"
            ])
        
        # Default response for unknown commands
        else:
            output.append(f"Unknown command: {cmd}")
            output.append("Type 'help' for available commands")
            success = False
        
        return jsonify({'success': success, 'output': output})
        
    except Exception as e:
        return jsonify({
            'success': False, 
            'output': [f"Error processing command: {str(e)}"]
        })

@app.route('/media', methods=['GET'])
def get_media():
    """Return mock media status"""
    return jsonify([{
        'title': 'Sample Song',
        'artist': 'Sample Artist',
        'state': '4',  # Playing
        'position': 120,
        'duration': 240,
        'thumbnail': ''
    }])

@app.route('/disk', methods=['GET'])
def get_disk():
    """Return mock disk usage"""
    return jsonify({
        'C:': 45,
        'D:': 67,
        'E:': 23
    })

@app.route('/recyclebin', methods=['GET'])
def get_recyclebin():
    """Return mock recycle bin size"""
    return jsonify({'recyclebinMB': 156})

@app.route('/dailyquote', methods=['GET'])
def get_daily_quote():
    """Return mock daily quote"""
    return jsonify({
        'quote': 'The only way to do great work is to love what you do.',
        'author': 'Steve Jobs'
    })

@app.route('/shutdown', methods=['POST'])
def shutdown():
    """Graceful shutdown endpoint"""
    try:
        import os
        import signal
        
        # Schedule shutdown after response
        def delayed_shutdown():
            import time
            time.sleep(0.5)
            os.kill(os.getpid(), signal.SIGTERM)
        
        import threading
        threading.Thread(target=delayed_shutdown).start()
        
        return jsonify({'success': True, 'message': 'Server shutting down'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    print("Starting Project Eve Media Server...")
    print("Listening on http://localhost:54321")
    try:
        app.run(host='127.0.0.1', port=54321, debug=False)
    except KeyboardInterrupt:
        print("\nServer stopped by user")
    except Exception as e:
        print(f"Server error: {e}")
        sys.exit(1)