//renderer.js（移除 require，改用 preload 暴露的 window.eve）

function reconnect() {
  updateDateTime();
  updateDisk();
  updateRecyclebin();
  updateDailyQuote();
  updateMediaStatus();
}

document.addEventListener("DOMContentLoaded", () => {
  reconnect();

  // 焦點事件（由主進程觸發）
  window.eve?.onFocusInput(() => {
    const input = document.getElementById("terminalInput");
    if (input) input.focus();
  });

  setInterval(() => {
    updateDateTime();
    updateMediaStatus();
  }, 1000); // 每秒更新一次

  setInterval(() => {
    updateRecyclebin();
    updateDisk();
  }, 60000); // 每 1 分鐘更新一次

  // 終端指令發送/接收
  const inputEl = document.getElementById("terminalInput");
  const outputEl = document.getElementById("terminalOutput");

  if (inputEl && outputEl) {
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        const cmd = inputEl.value.trim();
        if (!cmd) {
          return;
        }
        fetch("http://localhost:54321/terminal/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: cmd }),
        })
          .then((res) => res.json())
          .then((data) => {
            data.output.forEach((line) => {
              const p = document.createElement("p");
              p.className = "small";
              p.textContent = line;
              if (data.success === false) {
                p.style.color = "red";
              }
              outputEl.appendChild(p);
            });
            inputEl.value = "";
            inputEl.focus();
            outputEl.scrollTop = outputEl.scrollHeight;
            if (data.isChangePowerMode) {
              updatePowerMode(data.mode);
            }
            if (data.isMakeRecycleBinZero) {
              updateRecyclebin();
            }
            if (data.isAutoFocusOn != null) {
              autoFocus(data.isAutoFocusOn);
            }
            if (data.isClearOutput != null && data.isClearOutput) {
              outputEl.innerHTML = "";
              if (!data.isFullClear) {
                const p = document.createElement("p");
                p.className = "small";
                p.textContent = "Output cleared";
                outputEl.appendChild(p);
              }
            }
            if (data.isCopiedQuote) {
              const quoteEl = document.getElementById("quote");
              const quoteAuthorEl = document.getElementById("quote-author");
              let currentQuote = quoteEl ? quoteEl.textContent : "";
              let currentQuoteAuthor = quoteAuthorEl ? quoteAuthorEl.textContent : "";
              let outputQuote = `${currentQuote} ${currentQuoteAuthor}`;
              navigator.clipboard.writeText(outputQuote).then(() => {
                const p = document.createElement("p");
                p.className = "small";
                p.textContent = "Quote copied";
                outputEl.appendChild(p);
              });
            }
            if (data.isChangeQuote) {
              updateDailyQuote();
            }
            if (data.isToggleImmMode) {
              toggleImmMode();
            }
            if (data.isReconnect) {
              reconnect();
            }
          })
          .catch((err) => {
            const p = document.createElement("p");
            p.className = "small";
            p.style.color = "red";
            p.style.opacity = "0.5";
            p.textContent = "Fetch error: " + err;
            outputEl.appendChild(p);
            inputEl.value = "";
            inputEl.focus();
          });
      }
    });
  }
});

// 更新日期時間
function updateDateTime() {
  const now = new Date();
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dateStr = `${now.getMonth() + 1}/${now.getDate()} ${weekday[now.getDay()]}`;

  let hour = now.getHours();
  let min = now.getMinutes();
  let ampm = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) {
    hour = 12;
  }
  min = min < 10 ? "0" + min : min;
  const timeStr = `${hour}:${min} ${ampm}`;

  const dateEl = document.getElementById("date");
  if (dateEl) dateEl.textContent = dateStr;
  const timeEl = document.getElementById("time");
  if (timeEl) timeEl.textContent = timeStr;
}

// 更新磁碟容量（每 3 分鐘）
function updateDisk() {
  fetch("http://localhost:54321/disk")
    .then((res) => res.json())
    .then((data) => {
      const diskEl = document.getElementById("c-d-e");
      if (diskEl) diskEl.textContent = `${data["C:"]}%_${data["D:"]}%_${data["E:"]}%`;
    })
    .catch(() => {
      const diskEl = document.getElementById("c-d-e");
      if (diskEl) diskEl.textContent = "Error";
    });
}

// 回收桶容量
function updateRecyclebin() {
  fetch("http://localhost:54321/recyclebin")
    .then((res) => res.json())
    .then((data) => {
      const recyclebinEl = document.getElementById("recyclebin");
      if (recyclebinEl) recyclebinEl.textContent = data.recyclebinMB + " MB";
    });
}

// 每日金句
function updateDailyQuote() {
  fetch("http://localhost:54321/dailyquote")
    .then((res) => res.json())
    .then((data) => {
      const quoteEl = document.getElementById("quote");
      if (quoteEl) quoteEl.textContent = data.quote;
      const quoteAuthorEl = document.getElementById("quote-author");
      if (quoteAuthorEl) quoteAuthorEl.textContent = "— " + data.author;
    });
}

// 媒體狀態
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
    bar += i === progress ? "O" : "-";
  }
  bar += "]";
  return bar;
};
let mediaStatus;
let isImmOn = false;

function updateMediaStatus() {
  const songThumbnails = document.querySelectorAll(".song-thumbnail");
  const songTitles = document.querySelectorAll(".song-title");
  const songAuthors = document.querySelectorAll(".song-author");
  const songTimes = document.querySelectorAll(".song-time");
  const progressBars = document.querySelectorAll(".progress-bar");
  mediaStatus = "stopped"; // 預設為 stopped
  fetch("http://localhost:54321/media")
    .then((res) => res.json())
    .then((mediaArr) => {
      const media = mediaArr[0] || {};
      title = media.title || "--";
      author = media.artist || "--";
      songTitles.forEach((el) => el && (el.textContent = title));
      songAuthors.forEach((el) => el && (el.textContent = author));
      songThumbnails.forEach((el) => {
        if (el) el.src = media.thumbnail || "../assets/defaultThumbnail.svg";
      });
      songTimes.forEach((el) => el && (el.textContent = `${formatSec(media.position)} / ${formatSec(media.duration)}`));
      progressBars.forEach((el) => el && (el.textContent = renderProgressBar(media.position, media.duration)));

      if (!media || !media.state) mediaStatus = "stopped";
      else if (media.state === "4" || media.state === "Playing") mediaStatus = "playing";
      else if (media.state === "5" || media.state === "Paused") mediaStatus = "paused";
      else mediaStatus = "stopped";

      isImmOn = !!media.isImmOn;
      const musicPlayingEl = document.getElementById("music-playing");
      if (musicPlayingEl) musicPlayingEl.textContent = mediaStatus;
      window.eve?.sendVariable({ mediaStatus });
    })
    .catch(() => {
      mediaStatus = "stopped";
      const musicPlayingEl = document.getElementById("music-playing");
      if (musicPlayingEl) musicPlayingEl.textContent = "Error";
      window.eve?.sendVariable({ mediaStatus });
    });
}

//更新電源模式
function updatePowerMode(mode) {
  const powerMode = document.getElementById("power-mode");
  if (powerMode) powerMode.textContent = mode;
}

const terminalInputBlurHandler = function () {
  const input = document.getElementById("terminalInput");
  if (input) input.focus();
};

function autoFocus(isAutoFocusOn) {
  const input = document.getElementById("terminalInput");
  if (!input) return;
  if (isAutoFocusOn) {
    input.addEventListener("blur", terminalInputBlurHandler);
  } else {
    input.removeEventListener("blur", terminalInputBlurHandler);
  }
}
autoFocus(true);

// 更新 immersive 模式
const alphaSection = document.querySelector(".alphaSection");
let savedAlphaSectionInnerHTML;
const immAlphaSectionInnerHTML =
  '<div class="imm">' +
  '  <small class="fetch-status">/ media</small>' +
  "  <div>" +
  '    <img class="song-thumbnail" src="../assets/defaultThumbnail.svg" alt="" />' +
  '    <div class="rightPart">' +
  '      <div><span class="small">Song</span><span class="normal song-title">--</span></div>' +
  '      <div><span class="small">Author</span><span class="normal song-author">-- / --</span></div>' +
  '      <div><span class="small">Time</span><span class="normal song-time">--</span></div>' +
  '      <p class="normal progress-bar">[--------------------]</p>' +
  "    </div>" +
  "  </div>" +
  "</div>";

function isImmActive() {
  const upperPart = document.querySelector(".upperPart");
  return !!(upperPart && upperPart.classList.contains("immOn"));
}

function setImmMode(on) {
  const current = isImmActive();
  if (on === current) return;
  if (typeof toggleImmMode === "function") {
    toggleImmMode();
  } else {
    document.addEventListener("DOMContentLoaded", () => typeof toggleImmMode === "function" && toggleImmMode(), { once: true });
  }
}

// 暴露給其他腳本（如 themeRuntime）使用
window.eveUi = Object.assign({}, window.eveUi, { setImmMode });

// 啟動時由主行程下發 imm:set，一次性套用預設沉浸模式
window.eve?.onImmSet?.((wantOn) => setImmMode(!!wantOn));

function toggleImmMode() {
  const upperPart = document.querySelector(".upperPart");
  if (!upperPart || !alphaSection) return;
  upperPart.classList.toggle("immOn");
  upperPart.classList.toggle("immOff");
  alphaSection.classList.toggle("daily_quote");
  if (upperPart.classList.contains("immOn")) {
    if (!savedAlphaSectionInnerHTML) {
      savedAlphaSectionInnerHTML = alphaSection.innerHTML;
    }
    alphaSection.innerHTML = immAlphaSectionInnerHTML;
    isImmOn = true;
    window.eve?.sendVariable({ mediaStatus, isImmOn });
  } else {
    if (savedAlphaSectionInnerHTML) {
      alphaSection.innerHTML = savedAlphaSectionInnerHTML;
      isImmOn = false;
      window.eve?.sendVariable({ mediaStatus, isImmOn });
    }
  }
}
