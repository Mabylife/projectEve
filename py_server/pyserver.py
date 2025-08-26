# pyserver.py

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
import urllib.parse
import os
import json
import sys
from pathlib import Path
from typing import Optional

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
should_log = False  # 設為 True 可開啟詳細日誌


def log(msg):
    if should_log:
        print(f"[LOG] {msg}")


def create_app() -> Quart:
    app = Quart(__name__)
    app = cors(app, allow_origin="*")
    return app


app = create_app()

# Commands cache (v2 schema)
LOADED_COMMANDS = {"version": 2, "commands": []}
CMD_INDEX = {}  # prefix(lower) -> list[command]


# ---------- 路徑處理 ----------
def _exe_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


def _resolve_config_dir() -> Path:
    # 1) 明確指定：最可靠
    env = os.environ.get("EVE_CONFIG_DIR")
    if env:
        p = Path(env)
        p.mkdir(parents=True, exist_ok=True)
        log(f"CONFIG_DIR from EVE_CONFIG_DIR={p}")
        return p

    # 2) 根據 exe 所在位置嘗試常見結構
    start = _exe_dir()
    candidates = [
        start / "config",  # 與 exe 同層的 config（最常用）
        start.parent / "config",  # 上一層的 config
        start.parent.parent / "config",  # 兩層上的 config（原本假設 exe 在 servers/py/）
    ]
    for c in candidates:
        if c.exists():
            log(f"CONFIG_DIR from candidates hit: {c}")
            return c

    # 3) fallback：在 exe 旁新建 config
    fallback = start / "config"
    fallback.mkdir(parents=True, exist_ok=True)
    log(f"CONFIG_DIR fallback created: {fallback}")
    return fallback


CONFIG_DIR = _resolve_config_dir()
COMMANDS_FILE = CONFIG_DIR / "commands.json"
SHORTCUTS_DIR = CONFIG_DIR.parent / "shortcuts"


# ---------- 媒體工具 ----------
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


def _normalize_media_status(name: str) -> str:
    if not name:
        return "stopped"
    n = name.strip().lower()
    if n.startswith("play"):
        return "playing"
    if n.startswith("pause"):
        return "paused"
    return "stopped"


async def _gather_sessions_detail():
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
                    s,
                })
            except Exception as e:
                log(f"_gather_sessions_detail: session {idx} error: {e}")
    except Exception as e:
        log(f"_gather_sessions_detail: manager error {e}")
    return details


async def _best_media_snapshot():
    details = await _gather_sessions_detail()
    if not details:
        return "stopped", {"title": None, "statusName": None}
    best = sorted(details, key=lambda d: d.get("score", 0), reverse=True)[0]
    norm = _normalize_media_status(best.get("statusName"))
    return norm, {
        "title": best.get("title"),
        "statusName": best.get("statusName")
    }


# ---------- 系統動作 primitive ----------
KEYEVENTF_KEYUP = 0x0002


def _parse_vk_list(args_or_list):
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
    try:
        import time
        import ctypes

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        codes = _parse_vk_list(vk_codes)

        def key_down(vk):
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
        log(f"send_vk error: {e}")
        return False


def _powershell_start_process(target: str, timeout=4) -> bool:
    try:
        subprocess.run(
            ["powershell", "-Command", f'Start-Process -FilePath "{target}"'],
            timeout=timeout)
        return True
    except Exception as e:
        log(f"Start-Process error: {e}")
        return False


def open_url(url: str):
    try:
        ok = _powershell_start_process(url, timeout=5)
        log(f"Opened URL: {url} ok={ok}")
        return ok
    except Exception as e:
        log(f"Open URL error: {e}")
        return False


def open_shortcut(name: str):
    try:
        name = name.strip()
        if not name.lower().endswith(".lnk"):
            name = name + ".lnk"
        base = SHORTCUTS_DIR.resolve()
        path = (base / name).resolve()
        if not str(path).lower().endswith(".lnk"):
            return False
        # 防止目錄穿越
        if base not in path.parents and path != base:
            return False
        if not path.exists():
            return False
        return _powershell_start_process(str(path), timeout=5)
    except Exception as e:
        log(f"open_shortcut error: {e}")
        return False


# ---------- commands.json v2 載入 & 索引 ----------
def _normalize_spaces(s: str) -> str:
    return " ".join((s or "").split())


def _validate_commands_v2(obj) -> bool:
    try:
        if not obj or not isinstance(obj, dict):
            return False
        if int(obj.get("version", 0)) != 2:
            return False
        items = obj.get("commands", [])
        if not isinstance(items, list):
            return False
        for c in items:
            if not isinstance(c, dict):
                return False
            if not c.get("id") or not c.get("prefix") or not c.get(
                    "cmds") or not c.get("action"):
                return False
            if not isinstance(c["cmds"], list) or not c["cmds"]:
                return False
            a = c["action"]
            if not isinstance(a, dict):
                return False
            t = a.get("type")
            if t not in ("function", "send_vk", "open_shortcut", "open_url"):
                return False
            if t == "function" and not a.get("name"):
                return False
            if t == "send_vk" and not a.get("keys"):
                return False
            if t == "open_shortcut" and not a.get("name"):
                return False
            if t == "open_url" and not a.get("url"):
                return False
            # 新增：args_mode 檢查（可省略；省略視為 "none"）
            am = c.get("args_mode", "none")
            if am not in ("none", "free"):
                return False
        return True
    except Exception:
        return False


def _rebuild_cmd_index():
    global CMD_INDEX
    CMD_INDEX = {}
    items = LOADED_COMMANDS.get("commands", [])
    for c in items:
        if c.get("enabled") is False:
            continue
        p = str(c.get("prefix", "")).strip().lower()
        if not p:
            continue
        c["_cmds_norm"] = [
            _normalize_spaces(x).lower() for x in c.get("cmds", [])
        ]
        c["_args_mode"] = c.get("args_mode", "none")
        CMD_INDEX.setdefault(p, []).append(c)


def _load_commands_from_disk():
    global LOADED_COMMANDS
    try:
        if COMMANDS_FILE.exists():
            with open(COMMANDS_FILE, "r", encoding="utf-8") as f:
                obj = json.load(f)
            if _validate_commands_v2(obj):
                LOADED_COMMANDS = obj
                _rebuild_cmd_index()
                log(f"Commands loaded: {sum(len(v) for v in CMD_INDEX.values())} items across {len(CMD_INDEX)} prefixes"
                    )
                return True
            else:
                log("commands.json validation failed (expect version=2)")
                LOADED_COMMANDS = {"version": 2, "commands": []}
                CMD_INDEX.clear()
                return False
        else:
            LOADED_COMMANDS = {"version": 2, "commands": []}
            CMD_INDEX.clear()
            log(f"CONFIG_DIR={CONFIG_DIR}, COMMANDS_FILE={COMMANDS_FILE}, loaded_prefixes={list(CMD_INDEX.keys())}"
                )
            return False
    except Exception as e:
        log(f"load commands error: {e}")
        LOADED_COMMANDS = {"version": 2, "commands": []}
        CMD_INDEX.clear()
        return False


def _list_prefixes():
    return sorted(list(CMD_INDEX.keys()))


def _build_help_all():
    prefixes = _list_prefixes()
    lines = []
    if prefixes:
        lines.append("Available prefixes:")
        for p in prefixes:
            cnt = len(CMD_INDEX.get(p, []))
            lines.append(f"- {p} ({cnt} commands)  try: /{p} help")
    else:
        lines.append("No custom commands configured.")
    # 未加 prefix 行為說明（維持相容：Win+R 啟動 + 支援數學運算）
    lines.append("")
    lines.append("No prefix:")
    lines.append("- Execute as Win+R (Start-Process)")
    lines.append("- Or enter a math expression to calculate")
    return lines


def _build_help_for_prefix(prefix: str):
    p = (prefix or "").strip().lower()
    items = CMD_INDEX.get(p, [])
    if not items:
        return [f"No commands under prefix: {prefix}"]
    lines = [f"Commands for /{p}:"]
    for c in items:
        cmds = " | ".join(c.get("cmds", []))
        desc = c.get("help") or c.get("name") or ""
        lines.append(f"- {cmds}" + (f" — {desc}" if desc else ""))
    return lines


# ---------- HTTP 端點 ----------
@app.route("/media/debug")
async def media_debug():
    if MediaManager is None:
        return jsonify({"winrt": False, "sessions": []})
    details = await _gather_sessions_detail()
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
    for drive in drives:
        try:
            usage = psutil.disk_usage(drive + "\\")
            percent = round(usage.used / usage.total * 100)
            result[drive] = percent
        except Exception as e:
            result[drive] = "N/A"
            log(f"Disk error for {drive}: {e}")
    return jsonify(result)


@app.route("/recyclebin")
async def get_recyclebin():
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
    return jsonify({"recyclebinMB": mb})


@app.route("/dailyquote")
async def get_dailyquote():
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
    return jsonify(result)


@app.route("/media")
async def get_media():
    result_list = []
    if MediaManager is None:
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
                                thumbnail_b64 = "data:image/png;base64," + base64.b64encode(
                                    bytes_data).decode("utf-8")
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
                    "album": getattr(info, "album_title", None),
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


# ---------- 內建 function 對應 ----------
def _run_builtin_function(name: str, arg: Optional[str] = None):
    name = (name or "").strip().lower()
    flags = {}
    ok = False

    if name == "power_silent":
        ok = send_vk(0x11, 0x10, 0x12, 0x7F, mode="combo")
        flags = {"isChangePowerMode": True, "mode": "silent"} if ok else {}
    elif name == "power_balanced":
        ok = send_vk(0x11, 0x10, 0x12, 0x80, mode="combo")
        flags = {"isChangePowerMode": True, "mode": "balanced"} if ok else {}
    elif name == "power_turbo":
        ok = send_vk(0x11, 0x10, 0x12, 0x81, mode="combo")
        flags = {"isChangePowerMode": True, "mode": "turbo"} if ok else {}

    elif name == "media_toggle":
        ok = send_vk(0xB3)
    elif name == "media_next":
        ok = send_vk(0xB0)
    elif name == "media_prev":
        ok = send_vk(0xB1)
    elif name == "media_stop":
        ok = send_vk(0xB2)

    elif name == "toggle_immersive":
        ok = True
        flags = {"isToggleImmMode": True}

    elif name == "open_bin":
        ok = _powershell_start_process("shell:RecycleBinFolder")
    elif name == "clean_bin":
        try:
            start = time.time()
            subprocess.run(
                ["powershell", "-Command", "Clear-RecycleBin -Force"],
                timeout=8)
            ok = True
            flags = {"isMakeRecycleBinZero": True}
            log(f"Recycle bin cleaned in {round(time.time() - start, 2)}s")
        except Exception as e:
            ok = False
            log(f"clean_bin error: {e}")

    elif name == "autofocus_on":
        ok = True
        flags = {"isAutoFocusOn": True}
    elif name == "autofocus_off":
        ok = True
        flags = {"isAutoFocusOn": False}

    elif name == "clear_output":
        ok = True
        flags = {"isClearOutput": True, "isFullClear": False}
    elif name == "clear_output_full":
        ok = True
        flags = {"isClearOutput": True, "isFullClear": True}

    elif name == "quote_copy":
        ok = True
        flags = {"isCopiedQuote": True}
    elif name == "quote_change":
        ok = True
        flags = {"isChangeQuote": True}

    elif name == "reconnect":
        ok = True
        flags = {"isReconnect": True}

    elif name == "search":
        # /{prefix} s <keywords...> → Google
        q = (arg or "").strip()
        if not q:
            return False, flags
        q_enc = urllib.parse.quote_plus(q)
        url = f"https://www.google.com/search?q={q_enc}"
        ok = open_url(url)
        return ok, flags

    elif name == "auto_dir_search":
        # /{prefix} <bang or term> → DuckDuckGo with leading !
        q = (arg or "").strip()
        if not q:
            return False, flags
        if not q.startswith("!"):
            q = "!" + q
        # 保留 ! 不被編碼，其他照常 urlencode（避免空白被吃掉）
        q_enc = urllib.parse.quote_plus(q, safe="!")
        url = f"https://duckduckgo.com/?q={q_enc}"
        ok = open_url(url)
        return ok, flags

    else:
        ok = False

    return ok, flags


def _format_output(val,
                   default_text_ok: str = None,
                   default_text_fail: str = None,
                   ok: bool = True):
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        return [val]
    # 沒提供時，回傳合理預設
    if ok:
        return [default_text_ok or "Done"]
    else:
        return [default_text_fail or "Failed"]


def _match_command_from_json(prefix: str, cmd_text: str):
    p = (prefix or "").strip().lower()
    rest = _normalize_spaces(cmd_text)
    rest_l = rest.lower()
    items = CMD_INDEX.get(p, [])
    for c in items:
        if c.get("_args_mode") == "free":
            for pat in c.get("_cmds_norm", []):
                # 空字串：整段 rest 都當作參數（需有內容）
                if pat == "":
                    if rest:
                        return c, rest
                    continue
                # 以 "pat " 開頭 → 後面整段是參數
                if rest_l.startswith(pat + " ") and len(rest_l) > len(pat) + 1:
                    arg = rest[len(pat) + 1:]  # 保留原大小寫/空白
                    return c, arg
            # 若 args_mode=free 但沒有命中任何 pat，繼續檢查下一條
            continue
        else:
            # 精準比對（大小寫不敏感）
            if rest_l in c.get("_cmds_norm", []):
                return c, None
    return None, None


@app.route("/terminal/run", methods=["POST"])
async def terminal_run():
    data = await request.get_json()
    input_cmd = (data.get("input", "") or "").strip()
    log(f"Terminal API called: input={input_cmd}")

    def _unknown_prefix_response(pfx: str):
        prefixes = _list_prefixes()
        lines = [f"Unknown prefix: {pfx}"]
        if prefixes:
            lines.append("Available prefixes:")
            for p in prefixes:
                cnt = len(CMD_INDEX.get(p, []))
                lines.append(f"- {p} ({cnt} commands)  try: /{p} help")
            lines.append("")
            lines.append("Tip: type /help to see all prefixes.")
        else:
            lines.append("No custom commands configured. Type /help.")
        return {"output": lines, "success": False}

    prefix_match = re.match(r"^[/-](\w+)\s*(.*)$", input_cmd)
    if prefix_match:
        prefix = prefix_match.group(1).strip().lower()
        cmd = (prefix_match.group(2) or "").strip()

        if prefix == "help" and (not cmd or cmd.lower() in ("", "help", "?")):
            return jsonify({"output": _build_help_all(), "success": True})

        if prefix not in CMD_INDEX:
            return jsonify(_unknown_prefix_response(prefix))

        if not cmd or cmd.lower() in ("help", "?"):
            return jsonify({
                "output": _build_help_for_prefix(prefix),
                "success": True
            })

        # 取得命中與參數
        cmd_def, arg = _match_command_from_json(prefix, cmd)
        if cmd_def:
            action = cmd_def.get("action", {})
            t = (action.get("type") or "").lower()
            ok = False
            flags = {}

            if t == "function":
                fname = (action.get("name") or "").lower()
                ok, flags = _run_builtin_function(fname, arg)
                # 針對 search 系列給友善輸出
                if fname in ("search", "auto_dir_search"):
                    if not (arg or "").strip():
                        return jsonify({
                            "output": ["No search query"],
                            "success": False
                        })
                    msg = "Searching: " + arg if fname == "search" else "Searching (Auto direct): " + arg
                    return jsonify({
                        "output": [msg],
                        "success": bool(ok),
                        **flags
                    })

            elif t == "send_vk":
                keys = action.get("keys", [])
                mode = action.get("mode", "combo")
                inter = int(action.get("inter_key_delay_ms", 0) or 0)
                hold = int(action.get("hold_ms", 50) or 50)
                ok = send_vk(keys,
                             mode=mode,
                             inter_key_delay_ms=inter,
                             hold_ms=hold)

            elif t == "open_shortcut":
                ok = open_shortcut(action.get("name", ""))

            elif t == "open_url":
                ok = open_url(action.get("url", ""))

            else:
                ok = False

            output = _format_output(
                cmd_def.get("output_ok" if ok else "output_fail"),
                default_text_ok=cmd_def.get("name") or "Done",
                default_text_fail="Failed",
                ok=ok,
            )
            res = {"output": output, "success": bool(ok)}
            res.update(flags)
            return jsonify(res)

        # prefix 正確但子指令不匹配：列出該 prefix 的所有可用指令
        return jsonify({
            "output": _build_help_for_prefix(prefix),
            "success": False
        })

    # 無 prefix：help / 計算 / Win+R fallback（原樣保留）
    if input_cmd.lower() in ("help", "-help", "/help", "?"):
        return jsonify({"output": _build_help_all(), "success": True})

    math_expr = re.compile(r"^[0-9+\-*/^().\s]+$")
    if math_expr.match(input_cmd) and input_cmd:
        try:
            calc_result = eval(input_cmd, {"__builtins__": None, "math": math})
            return jsonify({
                "output": [f"Result: {calc_result}"],
                "success": True
            })
        except Exception as e:
            return jsonify({
                "output": [f"Error in calculation: {e}"],
                "success": False
            })

    try:
        ok = _powershell_start_process(input_cmd)
        return jsonify({
            "output": [f"Launched: {input_cmd}"]
            if ok else [f"Failed to launch: {input_cmd}"],
            "success":
            ok
        })
    except Exception:
        return jsonify({
            "output": [f"Failed to launch: {input_cmd}"],
            "success": False
        })


# 簡易健康檢查
@app.route("/health")
async def health():
    return jsonify({"ok": True})


# 重新載入 commands
@app.route("/reload-commands", methods=["POST"])
async def reload_commands():
    ok = _load_commands_from_disk()
    return jsonify({"ok": ok})


# ---------- lifecycle ----------
async def main():
    shutdown_event = asyncio.Event()

    @app.route("/shutdown", methods=["POST"])
    async def shutdown():
        shutdown_event.set()
        log("Shutdown triggered")
        return jsonify({"ok": True})

    async def shutdown_trigger():
        await shutdown_event.wait()

    @app.before_serving
    async def _startup():
        try:
            _load_commands_from_disk()
        except Exception as e:
            log(f"load commands at startup error: {e}")
        app.background_tasks = set()
        log("Background tasks started (media polling handled by Main).")

    @app.after_serving
    async def _cleanup():
        for t in getattr(app, "background_tasks", set()):
            t.cancel()
        log("Background tasks cancelled.")

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
