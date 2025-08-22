from quart_cors import cors
from quart import Quart, jsonify, request
import httpx
import math
import re
import time
import base64
import asyncio
import contextlib
import subprocess
import psutil
import ctypes
import urllib.parse
from ctypes import wintypes

try:
    from winrt.windows.media.control import (
        GlobalSystemMediaTransportControlsSessionManager as MediaManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as
        PlaybackStatus,
    )
    from winrt.windows.storage.streams import Buffer, InputStreamOptions, DataReader
except ImportError:
    MediaManager = None
    PlaybackStatus = None

HOST = "0.0.0.0"
PORT = 54321


def log(msg):
    print(f"[LOG] {msg}")


def create_app() -> Quart:
    app = Quart(__name__)
    app = cors(app, allow_origin="*")
    return app


app = create_app()


def _status_name(status_enum):
    if PlaybackStatus is None:
        return str(status_enum)
    mapping = {
        PlaybackStatus.CLOSED: "Closed",
        PlaybackStatus.OPENED: "Opened",
        PlaybackStatus.CHANGING: "Changing",
        PlaybackStatus.STOPPED: "Stopped",
        PlaybackStatus.PAUSED: "Paused",
        PlaybackStatus.PLAYING: "Playing",
    }
    return mapping.get(status_enum, str(status_enum))


async def _gather_sessions_detail():
    """
    回傳 list: [{idx, statusName, title, rawStatus, score}]
    score 用來排序挑選最佳 session
    """
    details = []
    if MediaManager is None:
        return details
    try:
        mgr = await MediaManager.request_async()
        sessions = mgr.get_sessions()
        for idx, s in enumerate(sessions):
            try:
                info = await s.try_get_media_properties_async()
                playback = s.get_playback_info()
                status_enum = getattr(playback, "playback_status", None)
                title = getattr(info, "title", None)
                # 排序分數：Playing 4 > Paused 3 > Changing 2 > Stopped 1 > 其他 0
                score = 0
                if PlaybackStatus is not None:
                    if status_enum == PlaybackStatus.PLAYING:
                        score = 4
                    elif status_enum == PlaybackStatus.PAUSED:
                        score = 3
                    elif status_enum == PlaybackStatus.CHANGING:
                        score = 2
                    elif status_enum == PlaybackStatus.STOPPED:
                        score = 1
                details.append({
                    "idx":
                    idx,
                    "statusEnum": (int(status_enum) if isinstance(
                        status_enum, int) else str(status_enum)),
                    "statusName":
                    _status_name(status_enum),
                    "title":
                    title,
                    "score":
                    score,
                    "session":
                    s,  # 不序列化，用於後續選擇
                })
            except Exception as e:
                log(f"_gather_sessions_detail: session {idx} error: {e}")
    except Exception as e:
        log(f"_gather_sessions_detail: manager error {e}")
    return details


def open_url(url: str):
    # 確保整體被引號包起來避免空白被拆
    try:
        subprocess.run(["powershell", "-Command", f'Start-Process "{url}"'],
                       timeout=5)
        log(f"Opened URL: {url}")
        return True
    except Exception as e:
        log(f"Open URL error: {e}")
        return False


# 只需要這兩個常數
KEYEVENTF_KEYUP = 0x0002


def _parse_vk_list(args_or_list):
    """
    支援：
    - send_vk(0x11, 0x10, 0x7F)
    - send_vk([0x11, 0x10, 0x7F])
    - send_vk("0x11", "0x10", "0x7F")
    """
    if len(args_or_list) == 1 and isinstance(args_or_list[0], (list, tuple)):
        items = list(args_or_list[0])
    else:
        items = list(args_or_list)
    parsed = []
    for v in items:
        if isinstance(v, str):
            s = v.strip()
            parsed.append(int(s, 16) if s.lower().startswith("0x") else int(s))
        else:
            parsed.append(int(v))
    return parsed


def send_vk(*vk_codes, mode="combo", inter_key_delay_ms=0, hold_ms=50):
    """
    最簡版虛擬鍵輸入：
    - 直接傳虛擬鍵碼即可，例如：send_vk(0x11, 0x10, 0x7F)
    - mode:
      - "combo": 依序按下所有鍵 → 停留 hold_ms → 反向全部放開（組合鍵）
      - "sequence": 每鍵：按下→放開→換下一鍵（連續點擊）
    - inter_key_delay_ms: 鍵與鍵之間的延遲（毫秒）
    - hold_ms: combo 模式，全部按下後的停留時間（毫秒）
    注意：本版本不處理 EXTENDED flag，某些鍵（如媒體鍵、方向鍵）在部分環境可能需要 EXTENDED 才可靠。
    """
    try:
        import time
        import ctypes

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        codes = _parse_vk_list(vk_codes)

        def key_down(vk):
            # 不使用 EXTENDED flag，最簡實作
            user32.keybd_event(vk, 0, 0, 0)

        def key_up(vk):
            user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)

        if not codes:
            return True

        if mode == "sequence":
            for vk in codes:
                key_down(vk)
                if inter_key_delay_ms:
                    time.sleep(inter_key_delay_ms / 1000.0)
                key_up(vk)
                if inter_key_delay_ms:
                    time.sleep(inter_key_delay_ms / 1000.0)
            return True
        else:
            # 預設 combo
            for vk in codes:
                key_down(vk)
                if inter_key_delay_ms:
                    time.sleep(inter_key_delay_ms / 1000.0)
            if hold_ms:
                time.sleep(hold_ms / 1000.0)
            for vk in reversed(codes):
                key_up(vk)
                if inter_key_delay_ms:
                    time.sleep(inter_key_delay_ms / 1000.0)
            return True
    except Exception as e:
        print(f"[LOG] send_vk error: {e}")
        return False


@app.route("/media/debug")
async def media_debug():
    if MediaManager is None:
        return jsonify({"winrt": False, "sessions": []})
    details = await _gather_sessions_detail()
    # 去掉 session 物件不可序列化
    out = []
    for d in details:
        out.append({
            "idx": d["idx"],
            "statusName": d["statusName"],
            "score": d["score"],
            "title": d["title"],
        })
    return jsonify({"winrt": True, "sessions": out})


@app.route("/disk")
async def get_disk():
    drives = ["C:", "D:", "E:"]
    result = {}
    log("Disk API called")
    for drive in drives:
        try:
            usage = psutil.disk_usage(drive + "\\")
            percent = round(usage.used / usage.total * 100)
            result[drive] = percent
        except Exception as e:
            result[drive] = "N/A"
            log(f"Disk error for {drive}: {e}")
    log(f"Disk result: {result}")
    return jsonify(result)


@app.route("/recyclebin")
async def get_recyclebin():
    log("Recyclebin API called")
    ps_script = """
$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.Namespace(10)
$size = 0
for ($i=0; $i -lt $recycleBin.Items().Count; $i++) { $size += $recycleBin.Items().Item($i).Size }
[math]::Round($size / 1MB)
"""
    try:
        result = subprocess.run(
            ["powershell", "-Command", ps_script],
            capture_output=True,
            text=True,
            timeout=6,
        )
        mb = int(result.stdout.strip().splitlines()
                 [-1]) if result.stdout.strip() else 0
    except Exception as e:
        mb = 0
        log(f"Recyclebin error: {e}")
    log(f"Recyclebin MB: {mb}")
    return jsonify({"recyclebinMB": mb})


@app.route("/dailyquote")
async def get_dailyquote():
    log("Dailyquote API called (insecure fetch)")
    try:
        async with httpx.AsyncClient(timeout=5, verify=False) as client:
            resp = await client.get("https://api.quotable.io/quotes/random")
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, list):
                data = data[0] if data else {}
            result = {
                "quote": data.get("content") or data.get("quote")
                or "No quote",
                "author": data.get("author", "Unknown"),
                "insecure": True,
            }
    except Exception as e:
        result = {
            "quote": "Quote fetch failed",
            "author": "ProjectEve",
            "error": str(e),
        }
        log(f"Dailyquote error: {e}")
    log(f"Dailyquote result: {result}")
    return jsonify(result)


@app.route("/media")
async def get_media():
    result_list = []
    if MediaManager is None:
        log("MediaManager not available (winrt not installed)")
        return jsonify([])
    try:
        sessions_manager = await MediaManager.request_async()
        sessions = sessions_manager.get_sessions()
        for session in sessions:
            try:
                info = await session.try_get_media_properties_async()
                playback_info = session.get_playback_info()
                timeline_properties = session.get_timeline_properties()
                position = getattr(
                    getattr(timeline_properties, "position", None), "duration",
                    None)
                if position is not None:
                    position /= 10_000_000
                duration = getattr(
                    getattr(timeline_properties, "end_time", None), "duration",
                    None)
                if duration is not None:
                    duration /= 10_000_000
                state = getattr(playback_info, "playback_status", None)
                thumbnail_b64 = None
                try:
                    thumb_ref = getattr(info, "thumbnail", None)
                    if thumb_ref:
                        stream = await thumb_ref.open_read_async()
                        if stream and stream.size > 0:
                            size = stream.size
                            buffer = Buffer(size)
                            read_result = await stream.read_async(
                                buffer, size, InputStreamOptions.NONE)
                            try:
                                reader = DataReader.from_buffer(read_result)
                                bytes_data = bytes(
                                    reader.read_bytes(read_result.length))
                                thumbnail_b64 = ("data:image/png;base64," +
                                                 base64.b64encode(bytes_data).
                                                 decode("utf-8"))
                            except Exception:
                                thumbnail_b64 = None
                            with contextlib.suppress(Exception):
                                if hasattr(stream, "close"):
                                    stream.close()
                            with contextlib.suppress(Exception):
                                if hasattr(buffer, "close"):
                                    buffer.close()
                except Exception:
                    thumbnail_b64 = None
                res = {
                    "title": getattr(info, "title", None),
                    "artist": getattr(info, "artist", None),
                    "state":
                    _status_name(state) if state is not None else None,
                    "position": position,
                    "duration": duration,
                    "thumbnail": thumbnail_b64,
                }
                result_list.append(res)
            except Exception as e:
                log(f"Media session error: {e}")
                continue
    except Exception as e:
        log(f"Media API error: {e}")
    return jsonify(result_list)


@app.route("/terminal/run", methods=["POST"])
async def terminal_run():
    data = await request.get_json()
    input_cmd = data.get("input", "").strip()
    log(f"Terminal API called: input={input_cmd}")

    prefix_match = re.match(r"^[/-](\w+)\s*(.*)$", input_cmd)
    if prefix_match:
        prefix = prefix_match.group(1)
        cmd = prefix_match.group(2).strip()
        output, extra = [], {}
        success = True

        if prefix == "help":
            output = ["Available prefixes: mode, m, bin, eve, zen"]

        elif prefix == "mode":

            if cmd == "silent" or cmd == "sil":
                ok = send_vk(0x11, 0x10, 0x12, 0x7F, mode="combo")
                if ok:
                    output = [f"Power mode change to silent"]
                    extra = {"isChangePowerMode": True, "mode": "silent"}
            elif cmd == "balanced" or cmd == "bal":
                ok = send_vk(0x11, 0x10, 0x12, 0x80, mode="combo")
                if ok:
                    output = [f"Power mode change to balanced"]
                    extra = {"isChangePowerMode": True, "mode": "balanced"}
            elif cmd == "turbo" or cmd == "tur":
                ok = send_vk(0x11, 0x10, 0x12, 0x81, mode="combo")
                if ok:
                    output = [f"Power mode change to turbo"]
                    extra = {"isChangePowerMode": True, "mode": "turbo"}
                else:
                    output = [f"Unknown mode: {cmd}"]
                    success = False
            elif cmd in ("help", "？"):
                output = [
                    "Available commands: silent/sil, balanced/bal, turbo/tur"
                ]
            else:
                output = [f"Unknown command for mode prefix: {cmd}"]
                success = False

        elif prefix == "m":

            if cmd == "p" or cmd == "toggle":
                ok = send_vk(0xB3)
                if ok:
                    output = [f"Media toggled"]
            elif cmd == "next":
                ok = send_vk(0xB0)
                if ok:
                    output = [f"Media next"]
            elif cmd == "previous" or cmd == "prev":
                ok = send_vk(0xB1)
                if ok:
                    output = [f"Media previous"]
            elif cmd == "stop":
                ok = send_vk(0xB2)
                if ok:
                    output = [f"Media stopped"]
            elif cmd == "imm" or cmd == "immersive":
                output = [f"Media toggled immersive mode"]
                extra = {"isToggleImmMode": True}
            elif cmd in ("help", "？"):
                output = [
                    "Available commands: p/toggle, next, previous/prev, stop, immersive/imm"
                ]
            else:
                output = [f"Unknown command for mode prefix: {cmd}"]
                success = False

        elif prefix == "bin":
            if cmd == "open":
                try:
                    subprocess.run(
                        [
                            "powershell",
                            "-Command",
                            'Start-Process -FilePath "shell:RecycleBinFolder"',
                        ],
                        timeout=4,
                    )
                    output = ["opened recycle bin"]
                except Exception as e:
                    output = [f"Failed to open recycle bin: {e}"]
                    success = False
            elif cmd == "clean":
                try:
                    start = time.time()
                    subprocess.run(
                        ["powershell", "-Command", "Clear-RecycleBin -Force"])
                    elapsed = round(time.time() - start, 2)
                    output = [f"cleaned recycle bin after {elapsed}s"]
                    extra = {"isMakeRecycleBinZero": True}
                except Exception as e:
                    output = [f"Failed to clean recycle bin: {e}"]
                    success = False
            elif cmd in ("help", "？"):
                output = ["Available commands: open, clean"]
            else:
                output = [f"Unknown command for bin prefix: {cmd}"]
                success = False
        elif prefix == "eve":
            if cmd == "autofocus off":
                output = ["Auto focus off"]
                extra = {"isAutoFocusOn": False}
            elif cmd == "autofocus on":
                output = ["Auto focus on"]
                extra = {"isAutoFocusOn": True}
            elif cmd == "clean":
                output = ["Output cleared"]
                extra = {"isClearOutput": True, "isFullClear": False}
            elif cmd == "clean full":
                output = ["Full output cleared"]
                extra = {"isClearOutput": True, "isFullClear": True}
            elif cmd in ("quote get", "quote copy"):
                output = [""]
                extra = {"isCopiedQuote": True}
            elif cmd == "quote change":
                output = ["Quote changed"]
                extra = {"isChangeQuote": True}
            elif cmd in ("reconnect", "rc"):
                output = ["Reconnecting..."]
                extra = {"isReconnect": True}
            elif cmd in ("help", "？"):
                output = [
                    "Available commands: autofocus on/off, clean, clean full, quote copy/get/change"
                ]
            else:
                output = [f"Unknown command for eve prefix: {cmd}"]
                success = False
        elif prefix == "zen":
            if cmd.startswith("s "):
                query = cmd[2:].strip()
                if not query:
                    output = ["No search query"]
                    success = False
                else:
                    encoded = urllib.parse.quote_plus(query)
                    ok = open_url(f"https://www.google.com/search?q={encoded}")
                    output = [f"Searching: {query}"]
                    success = success and ok
            elif cmd in ("help", "？"):
                output = [
                    "Usage:",
                    "-zen s <keywords>",
                    "-zen <keywords>",
                ]
            else:
                query = cmd
                encoded = urllib.parse.quote_plus(query)
                ok = open_url(f"https://duckduckgo.com/?q=\{encoded}")
                output = [f"Searching (Auto direct): {query}"]
                success = success and ok
        else:
            output = [f"Unknown custom prefix: {prefix}"]
            success = False

        result = {"output": output, "success": success}
        result.update(extra)
        log(f"Terminal run result: {result}")
        return jsonify(result)

    math_expr = re.compile(r"^[0-9+\-*/^().\s]+$")
    if math_expr.match(input_cmd) and input_cmd:
        try:
            calc_result = eval(input_cmd, {"__builtins__": None, "math": math})
            result = {"output": [f"Result: {calc_result}"], "success": True}
        except Exception as e:
            result = {
                "output": [f"Error in calculation: {e}"],
                "success": False
            }
        log(f"Terminal math result: {result}")
        return jsonify(result)

    try:
        subprocess.run(
            [
                "powershell", "-Command",
                f'Start-Process -FilePath "{input_cmd}"'
            ],
            timeout=4,
        )
        result = {"output": [f"Launched: {input_cmd}"], "success": True}
    except Exception as e:
        result = {
            "output": [f"Failed to launch: {input_cmd}"],
            "success": False
        }
    log(f"Terminal Win+R result: {result}")
    return jsonify(result)


async def main():
    shutdown_event = asyncio.Event()

    @app.route("/shutdown", methods=["POST"])
    async def shutdown():
        shutdown_event.set()
        log("Shutdown triggered")
        return jsonify({"ok": True})

    async def shutdown_trigger():
        await shutdown_event.wait()

    from hypercorn.asyncio import serve
    from hypercorn.config import Config

    config = Config()
    config.bind = [f"{HOST}:{PORT}"]
    await serve(app, config, shutdown_trigger=shutdown_trigger)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("KeyboardInterrupt, shutting down.")
