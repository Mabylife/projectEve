const formatSec = (sec) => (typeof sec === "number" && !isNaN(sec) ? sec.toFixed(0) : "--");
let title;
let author;

const renderProgressBar = (position, duration, totalBars = 20) => {
  if (typeof position !== "number" || typeof duration !== "number" || duration === 0) {
    return "[--------------------]";
  }
  const progress = Math.floor((position / duration) * totalBars);
  let bar = "[";
  for (let i = 0; i < totalBars; i++) {
    if (i === progress) {
      bar += "O";
    } else {
      bar += "-";
    }
  }
  bar += "]";
  return bar;
};

setInterval(() => {
  const songThumbnails = document.querySelectorAll(".song-thumbnail");
  const songTitles = document.querySelectorAll(".song-title");
  const songAuthors = document.querySelectorAll(".song-author");
  const songTimes = document.querySelectorAll(".song-time");
  const progressBar = document.querySelector(".progress-bar");

  fetch("http://localhost:54321/media")
    .then((res) => res.json())
    .then((mediaArr) => {
      const media = mediaArr[0] || {};
      title = media.title || "--";
      author = media.artist || "--";
      // 更新你的 DOM
      songTitles.forEach((titleElem) => (titleElem.textContent = title));
      songAuthors.forEach((authorElem) => (authorElem.textContent = author));
      songThumbnails.forEach((thumbnailElem) => (thumbnailElem.src = media.thumbnail || "assets/defaultThumbnail.svg")); // 預設縮圖
      songTimes.forEach((timeElem) => (timeElem.textContent = `${formatSec(media.position)} / ${formatSec(media.duration)}`));
      progressBar.textContent = renderProgressBar(media.position, media.duration);
    });
}, 1000);
