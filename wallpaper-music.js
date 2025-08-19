const albumCoverArt = document.getElementById("song-thumbnail");
const trackTitle = document.getElementById("song-title");
const artist = document.getElementById("song-author");
const musicPlaying = document.getElementById("music-playing");
const songTime = document.getElementById("song-time");
const mediaCard = document.getElementById("mediaCard");
let contentType;

musicPlaying.textContent = "False";

// 歌名/作者/封面/顏色（同原本）
function wallpaperMediaPropertiesListener(event) {
  trackTitle.textContent = event.title || "";
  artist.textContent = (event.artist || "").split(" ")[0];
  contentType = event.contentType || "unknown";
}

function wallpaperMediaThumbnailListener(event) {
  let thumb = event.thumbnail || "assets/songImage.jpg";
  const ytMatch = thumb.match(/img\.youtube\.com\/vi\/([^\/]+)\/hqdefault\.jpg/);
  if (ytMatch) {
    thumb = `https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`;
  }
  albumCoverArt.src = thumb;
}

// 播放狀態
function wallpaperMediaPlaybackListener(event) {
  // 依照官方常數判斷
  if (event.state === window.wallpaperMediaIntegration.PLAYBACK_PLAYING && contentType === "music") {
    musicPlaying.textContent = "True";
    mediaCard.style.opacity = "1";
  } else if (event.state === window.wallpaperMediaIntegration.PLAYBACK_PAUSED && contentType === "music") {
    musicPlaying.textContent = "Paused";
  } else if (event.state === window.wallpaperMediaIntegration.PLAYBACK_STOPPED && contentType === "music") {
    musicPlaying.textContent = "False";
    mediaCard.style.opacity = "0";
  } else {
    musicPlaying.textContent = "";
  }
}

// 時間
function wallpaperMediaTimelineListener(event) {
  // event.position: 秒, event.duration: 秒
  if (typeof event.position === "number" && typeof event.duration === "number" && event.duration > 0) {
    const format = (sec) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s < 10 ? "0" : ""}${s}`;
    };
    songTime.textContent = `${format(event.position)} / ${format(event.duration)}`;
  } else {
    songTime.textContent = "--:-- / --:--";
  }
}

// 註冊所有監聽器
window.wallpaperRegisterMediaPropertiesListener(wallpaperMediaPropertiesListener);
window.wallpaperRegisterMediaThumbnailListener(wallpaperMediaThumbnailListener);
window.wallpaperRegisterMediaPlaybackListener(wallpaperMediaPlaybackListener);
window.wallpaperRegisterMediaTimelineListener(wallpaperMediaTimelineListener);
