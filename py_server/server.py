import base64
import asyncio
import contextlib

from quart import Quart, jsonify, request
from quart_cors import cors
from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as MediaManager
from winrt.windows.storage.streams import Buffer, InputStreamOptions, DataReader

HOST = "0.0.0.0"
PORT = 54321

def create_app() -> Quart:
    app = Quart(__name__)
    app = cors(app, allow_origin="*")
    return app

app = create_app()

# ========== 你的原 /media 取得邏輯，做少量清理 ==========
@app.route("/media")
async def get_media():
    result_list = []
    try:
        sessions_manager = await MediaManager.request_async()
        sessions = sessions_manager.get_sessions()
        for session in sessions:
            try:
                info = await session.try_get_media_properties_async()
                playback_info = session.get_playback_info()
                timeline_properties = session.get_timeline_properties()

                # 位置與長度 (100ns tick -> 秒)
                position = getattr(getattr(timeline_properties, "position", None), "duration", None)
                if position is not None:
                    position /= 10_000_000
                duration = getattr(getattr(timeline_properties, "end_time", None), "duration", None)
                if duration is not None:
                    duration /= 10_000_000
                state = getattr(playback_info, "playback_status", None)

                # 縮圖
                thumbnail_b64 = None
                try:
                    thumb_ref = getattr(info, "thumbnail", None)
                    if thumb_ref:
                        stream = await thumb_ref.open_read_async()
                        if stream and stream.size > 0:
                            size = stream.size
                            buffer = Buffer(size)
                            result = await stream.read_async(buffer, size, InputStreamOptions.NONE)
                            try:
                                reader = DataReader.from_buffer(result)
                                bytes_data = bytes(reader.read_bytes(result.length))
                                thumbnail_b64 = "data:image/png;base64," + base64.b64encode(bytes_data).decode("utf-8")
                            except Exception:
                                thumbnail_b64 = None
                            # 釋放
                            with contextlib.suppress(Exception):
                                if hasattr(stream, "close"):
                                    stream.close()
                            with contextlib.suppress(Exception):
                                if hasattr(buffer, "close"):
                                    buffer.close()
                except Exception:
                    thumbnail_b64 = None

                result_list.append({
                    "title": getattr(info, "title", None),
                    "artist": getattr(info, "artist", None),
                    "state": str(state) if state else None,
                    "position": position,
                    "duration": duration,
                    "thumbnail": thumbnail_b64
                })
            except Exception:
                # 忽略單一 session 錯誤
                continue
    except Exception:
        pass
    return jsonify(result_list)

# ========== main 與優雅關閉 ==========
async def main():
    # 這裡新建 event，loop 已存在，不會有 cross-loop 問題
    shutdown_event = asyncio.Event()

    @app.route("/shutdown", methods=["POST"])
    async def shutdown():
        # 可以加簡單 token 驗證： if request.headers.get("X-Auth") != "secret": return jsonify({"ok": False}), 403
        shutdown_event.set()
        return jsonify({"ok": True})

    async def shutdown_trigger():
        # Hypercorn 會 await 這個；當 event set -> server 優雅結束
        await shutdown_event.wait()

    from hypercorn.asyncio import serve
    from hypercorn.config import Config

    config = Config()
    config.bind = [f"{HOST}:{PORT}"]
    # 依需求可調：config.use_reloader = False
    await serve(app, config, shutdown_trigger=shutdown_trigger)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass