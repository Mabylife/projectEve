setInterval(() => {
  updateDateTime();
}, 1000); // 每秒更新一次

setInterval(() => {
  updateRecycleBin();
  updateDisk();
}, 60000); // 每 1 分鐘更新一次

function updateDateTime() {
  const now = new Date();
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dateStr = `${now.getMonth() + 1}/${now.getDate()} ${weekday[now.getDay()]}`;

  let hour = now.getHours();
  let min = now.getMinutes();
  let ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
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
