//script.js
const { ipcRenderer } = require("electron");

ipcRenderer.on("focus-input", () => {
  document.getElementById("terminalInput").focus();
});

setInterval(() => {
  updateDateTime();
  updateMediaStatus();
}, 1000); // 每秒更新一次

setInterval(() => {
  updateRecyclebin();
  updateDisk();
}, 60000); // 每 1 分鐘更新一次

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

  document.getElementById("date").textContent = dateStr;
  document.getElementById("time").textContent = timeStr;
}
updateDateTime();

// 更新磁碟容量（每 3 分鐘）
function updateDisk() {
  fetch("http://localhost:12345/disk")
    .then((res) => res.json())
    .then((data) => {
      document.getElementById("c-d-e").textContent = `${data["C:"]}%_${data["D:"]}%_${data["E:"]}%`;
    })
    .catch((err) => {
      document.getElementById("c-d-e").textContent = "Error";
    });
}
updateDisk();

// 回收桶容量
function updateRecyclebin() {
  fetch("http://localhost:12345/recyclebin")
    .then((res) => res.json())
    .then((data) => {
      document.getElementById("recyclebin").textContent = data.recyclebinMB + " MB";
    });
}
updateRecyclebin();

// 每日金句
function updateDailyQuote() {
  fetch("http://localhost:12345/dailyquote")
    .then((res) => res.json())
    .then((data) => {
      document.getElementById("quote").textContent = data.quote;
      document.getElementById("quote-author").textContent = "— " + data.author;
    });
}
updateDailyQuote();

// 媒體狀態
let mediaStatus = "stopped";
let isImmOn = false;
function updateMediaStatus() {
  mediaStatus = "stopped"; // 預設為 stopped
  fetch("http://localhost:54321/media")
    .then((res) => res.json())
    .then((mediaArr) => {
      // mediaArr is an array, so get the first item
      const media = mediaArr[0];
      if (!media || !media.state) {
        mediaStatus = "stopped";
      } else if (media.state === "4") {
        mediaStatus = "playing";
      } else if (media.state === "5") {
        mediaStatus = "paused";
      } else {
        mediaStatus = "stopped";
      }
      document.getElementById("music-playing").textContent = mediaStatus;
      ipcRenderer.send("send-variable", { mediaStatus, isImmOn });
    })
    .catch((err) => {
      mediaStatus = "stopped";
      document.getElementById("music-playing").textContent = "Error";
      ipcRenderer.send("send-variable", { mediaStatus, isImmOn });
    });
}

// 終端指令發送/接收
document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById("terminalInput");
  const outputEl = document.getElementById("terminalOutput");

  // 監聽 Enter 鍵
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      const cmd = inputEl.value.trim();
      if (!cmd) {
        return;
      }

      // 發送 POST 到 API
      fetch("http://localhost:12345/terminal/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: cmd }),
      })
        .then((res) => res.json())
        .then((data) => {
          // 逐行新增 <p> 到 output 區
          data.output.forEach((line) => {
            const p = document.createElement("p");
            p.className = "small";
            p.textContent = line;
            // 根據成功或失敗決定顏色
            if (data.success === false) {
              p.style.color = "red";
            }
            outputEl.appendChild(p);
          });
          // 輸入框清空並 focus
          inputEl.value = "";
          inputEl.focus();
          // 滾動到底部
          outputEl.scrollTop = outputEl.scrollHeight;
          // 更新電源模式顯示
          if (data.isChangePowerMode) {
            updatePowerMode(data.mode);
          }
          // 清空回收桶
          if (data.isMakeRecycleBinZero) {
            updateRecyclebin();
          }
          // 開關自動聚焦
          if (data.isAutoFocusOn != null) {
            autoFocus(data.isAutoFocusOn);
          }
          // 清理輸出區
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
            let currentQuote = document.getElementById("quote").textContent;
            let currentQuoteAuthor = document.getElementById("quote-author").textContent;
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
});

//更新電源模式
function updatePowerMode(mode) {
  const powerMode = document.getElementById("power-mode");
  powerMode.textContent = mode;
}

const terminalInputBlurHandler = function () {
  document.getElementById("terminalInput").focus();
};

function autoFocus(isAutoFocusOn) {
  const input = document.getElementById("terminalInput");
  if (isAutoFocusOn) {
    input.addEventListener("blur", terminalInputBlurHandler);
  } else {
    input.removeEventListener("blur", terminalInputBlurHandler);
  }
}
autoFocus(true);

const alphaSection = document.querySelector(".alphaSection");
let savedAlphaSectionInnerHTML;
const immAlphaSectionInnerHTML =
  '<div class="imm">' +
  '  <small class="fetch-status">/ media</small>' +
  "  <div>" +
  '    <img class="song-thumbnail" src="assets/defaultThumbnail.svg" alt="" />' +
  '    <div class="rightPart">' +
  '      <div><span class="small">Song</span><span class="normal song-title">--</span></div>' +
  '      <div><span class="small">Author</span><span class="normal song-author">-- / --</span></div>' +
  '      <div><span class="small">Time</span><span class="normal song-time">--</span></div>' +
  '      <p class="normal progress-bar">[--------------------]</p>' +
  "    </div>" +
  "  </div>" +
  "</div>";

function toggleImmMode() {
  const upperPart = document.querySelector(".upperPart");
  upperPart.classList.toggle("immOn");
  upperPart.classList.toggle("immOff");
  alphaSection.classList.toggle("daily_quote");
  if (upperPart.classList.contains("immOn")) {
    if (!savedAlphaSectionInnerHTML) {
      savedAlphaSectionInnerHTML = alphaSection.innerHTML;
    }
    alphaSection.innerHTML = immAlphaSectionInnerHTML;
    isImmOn = true;
    ipcRenderer.send("send-variable", { mediaStatus, isImmOn });
  } else {
    if (savedAlphaSectionInnerHTML) {
      alphaSection.innerHTML = savedAlphaSectionInnerHTML;
      isImmOn = false;
      ipcRenderer.send("send-variable", { mediaStatus, isImmOn });
    }
  }
}
