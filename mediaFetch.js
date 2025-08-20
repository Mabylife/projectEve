const songThumbnail = document.getElementById("song-thumbnail");
const songTitle = document.getElementById("song-title");
const songAuthor = document.getElementById("song-author");
const songTime = document.getElementById("song-time");
const fetchStatus = document.getElementById("fetch-status");
const mediaCard = document.getElementById("mediaCard");

const formatSec = (sec) => (typeof sec === "number" && !isNaN(sec) ? sec.toFixed(0) : "--");
let title;
let author;

setInterval(() => {
  fetch("http://localhost:54321/media")
    .then((res) => res.json())
    .then((mediaArr) => {
      const media = mediaArr[0];
      title = media.title || "--";
      author = media.artist || "--";
      // 更新你的 DOM
      fetchStatus.textContent = "/ media - fetched";
      songTitle.textContent = title;
      songAuthor.textContent = author;
      songThumbnail.src = media.thumbnail || "assets/defaultThumbnail.svg"; // 預設縮圖
      songTime.textContent = `${formatSec(media.position)} / ${formatSec(media.duration)}`;
    });
}, 1000);
