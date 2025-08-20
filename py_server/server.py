import base64
from quart import Quart, jsonify
from quart_cors import cors
from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as MediaManager
from winrt.windows.storage.streams import Buffer, InputStreamOptions, DataReader

app = Quart(__name__)
app = cors(app, allow_origin="*")

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
                position = getattr(getattr(timeline_properties, "position", None), "duration", None)
                if position is not None:
                    position /= 10_000_000
                duration = getattr(getattr(timeline_properties, "end_time", None), "duration", None)
                if duration is not None:
                    duration /= 10_000_000
                state = getattr(playback_info, "playback_status", None)

                thumbnail_b64 = None
                try:
                    if getattr(info, "thumbnail", None):
                        stream_ref = info.thumbnail
                        stream = await stream_ref.open_read_async()
                        if stream is not None and stream.size > 0:
                            size = stream.size
                            buffer = Buffer(size)
                            result = await stream.read_async(buffer, size, InputStreamOptions.NONE)
                            # DataReader 要 try/except 包住
                            try:
                                reader = DataReader.from_buffer(result)
                                bytes_data = bytes(reader.read_bytes(result.length))
                                thumbnail_b64 = "data:image/png;base64," + base64.b64encode(bytes_data).decode('utf-8')
                            except Exception:
                                thumbnail_b64 = None
                            # 釋放 stream/buffer (如果有 close/dispose 方法)
                            if hasattr(stream, "close"):
                                stream.close()
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
                continue
        if result_list:
            return jsonify(result_list)
    except Exception:
        pass
    return jsonify([])

if __name__ == "__main__":
    import hypercorn.asyncio
    import hypercorn.config
    import asyncio
    config = hypercorn.config.Config()
    config.bind = ["0.0.0.0:54321"]
    asyncio.run(hypercorn.asyncio.serve(app, config))