document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById("terminalInput");
  const outputEl = document.getElementById("terminalOutput");

  // 監聽 Enter 鍵
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      const cmd = inputEl.value.trim();
      if (!cmd) return;

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
            if (data.success === false) p.style.color = "red";
            outputEl.appendChild(p);
          });
          // 輸入框清空並 focus
          inputEl.value = "";
          inputEl.focus();
          // 滾動到底部
          outputEl.scrollTop = outputEl.scrollHeight;
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
