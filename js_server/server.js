process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const si = require("systeminformation");
const fs = require("fs");
const activeWin = require("active-win");
const express = require("express");
const { create, all, string, re } = require("mathjs");
const math = create(all);
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const app = express();
const cheerio = require("cheerio");

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});

// --- 磁碟容量 ---
app.get("/disk", async (req, res) => {
  try {
    const disks = await si.fsSize();
    const drives = ["C:", "D:", "E:"];
    const result = {};
    for (const drive of drives) {
      const disk = disks.find((d) => d.mount.toUpperCase().startsWith(drive));
      result[drive] = disk ? Math.round((disk.used / disk.size) * 100) : "N/A";
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 回收桶容量 ---
app.get("/recyclebin", (req, res) => {
  const psScript = `$shell = New-Object -ComObject Shell.Application; $recycleBin = $shell.Namespace(10); $size = 0; for ($i=0; $i -lt $recycleBin.Items().Count; $i++) { $size += $recycleBin.Items().Item($i).Size }; [math]::Round($size / 1MB)`;
  exec(`pwsh.exe -Command "${psScript}"`, { windowsHide: true }, (err, stdout) => {
    const mb = parseInt(stdout.trim(), 10) || 0;
    res.json({ recyclebinMB: mb });
  });
});

// --- 每日金句 ---
app.get("/dailyquote", async (_, res) => {
  try {
    const r = await fetch("https://api.quotable.io/quotes/random");
    const arr = await r.json();
    const quote = arr[0];
    res.json({ quote: quote.content, author: quote.author });
  } catch (err) {
    console.error("Daily quote fetch error:", err);
    res.status(500).json({ error: "Quote fetch failed" });
  }
});

// --- 自訂前綴指令架構 ---
const customPrefixes = {
  help: async (cmd) => {
    return {
      output: ["Available prefixes: mode, m, bin, eve"],
      success: true,
    };
  },

  mode: async (cmd) => {
    let psCommand;
    let mode;
    switch (cmd) {
      case "silent":
      case "sil":
        psCommand = `try { Start-Process -FilePath "hotkeys/mode1.exe" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
        mode = "silent";
        break;
      case "balanced":
      case "bal":
        psCommand = `try { Start-Process -FilePath "hotkeys/mode2.exe" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
        mode = "balanced";
        break;
      case "turbo":
      case "tur":
        psCommand = `try { Start-Process -FilePath "hotkeys/mode3.exe" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
        mode = "turbo";
        break;
      case "help":
      case "？":
        return {
          output: ["Available commands: silent/sil, balanced/bal, turbo/tur"],
          success: true,
        };
      default:
        return { output: [`Unknown command for mode prefix: ${cmd}`], success: false };
    }

    try {
      await exec(`pwsh.exe -Command "${psCommand}"`, { windowsHide: true });
      return {
        output: [`Power mode change to ${mode}`],
        success: true,
        isChangePowerMode: true,
        mode: string(mode),
      };
    } catch (err) {
      return {
        output: [`Failed to change power mode to ${mode}`],
        success: false,
      };
    }
  },

  m: async (cmd) => {
    let input = "";
    let psCommand;
    let mode;
    switch (cmd) {
      case "p":
        psCommand = `try { Start-Process -FilePath "hotkeys/play_pause.exe" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
        mode = "media played/paused";
        break;
      case "next":
        psCommand = `try { Start-Process -FilePath "hotkeys/next.exe" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
        mode = "media switched to next";
        break;
      case "previous":
      case "prev":
        psCommand = `try { Start-Process -FilePath "hotkeys/previous.exe" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
        mode = "media switched to previous";
        break;
      case "yt":
        input = "shortcuts/yt.lnk";
        psCommand = `try { Start-Process -FilePath "${input}" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
        mode = "media switched to YouTube Music";
        break;
      case "am":
        input = "shortcuts/am.lnk";
        psCommand = `try { Start-Process -FilePath "${input}" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
        mode = "media switched to Apple Music";
        break;
      case "imm":
      case "immersive":
        return {
          output: [`Toggled immersive mode`],
          isToggleImmMode: true,
        };
      case "help":
      case "？":
        return {
          output: ["Available commands: play/p, next, previous/prev, yt, am, immersive/imm"],
          success: true,
        };
      default:
        return { output: [`Unknown command for media prefix: ${cmd}`], success: false };
    }

    try {
      await exec(`pwsh.exe -Command "${psCommand}"`, { windowsHide: true });
      return {
        output: [`${mode}`],
        success: true,
      };
    } catch (err) {
      return {
        output: [`Failed to control media: ${err.message}`],
        success: false,
      };
    }
  },

  bin: async (cmd) => {
    let psCommand;
    let isMakeRecycleBinZero = false;
    let action;
    switch (cmd) {
      case "open":
        psCommand = `Start-Process -FilePath "shell:RecycleBinFolder"`;
        action = "open";
        break;
      case "clean":
        psCommand = `Clear-RecycleBin -Force`;
        action = "clean";
        isMakeRecycleBinZero = true;
        break;
      case "help":
      case "？":
        return {
          output: ["Available commands: open, clean"],
          success: true,
        };
      default:
        return { output: [`Unknown command for bin prefix: ${cmd}`], success: false };
    }

    try {
      const { stdout, stderr } = await exec(`pwsh.exe -Command "${psCommand}"`, { windowsHide: true });
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
      return {
        output: [`${action}ed recycle bin`],
        success: true,
        isMakeRecycleBinZero: isMakeRecycleBinZero,
      };
    } catch (err) {
      console.error("exec error:", err);
      return {
        output: [`Failed to ${action} recycle bin: ${err.message}`],
        success: false,
      };
    }
  },

  eve: async (cmd) => {
    let isAutoFocusOn = true;
    switch (cmd) {
      case "autofocus off":
        isAutoFocusOn = false;
        return {
          output: [`Auto focus off`],
          success: true,
          isAutoFocusOn: isAutoFocusOn,
        };
      case "autofocus on":
        isAutoFocusOn = true;
        return {
          output: [`Auto focus on`],
          success: true,
          isAutoFocusOn: isAutoFocusOn,
        };
      case "clean":
        return {
          output: [`Output cleared`],
          success: true,
          isClearOutput: true,
          isFullClear: false,
        };
      case "clean full":
        return {
          output: [`Full output cleared`],
          success: true,
          isClearOutput: true,
          isFullClear: true,
        };
      case "quote get":
      case "quote copy":
        return {
          output: [``],
          success: true,
          isCopiedQuote: true,
        };
      case "quote change":
        return {
          output: [`Quote changed`],
          success: true,
          isChangeQuote: true,
        };
      case "help":
      case "？":
        return {
          output: ["Available commands: autofocus on/off, clean, clean full, quote copy/get/change"],
          success: true,
        };
      default:
        return { output: [`Unknown command for eve prefix: ${cmd}`], success: false };
    }
  },

  zen: async (cmd) => {
    let psCommand;
    let outputMessage;
    if (cmd && cmd.startsWith("s ")) {
      const searchContent = cmd.slice(2);
      outputMessage = `Searching for: ${searchContent}`;
      psCommand = `try { Start-Process https://www.google.com/search?q=${searchContent} -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
    } else {
      switch (cmd) {
        case null:
        case "":
          outputMessage = `Launched Zen`;
          psCommand = `try { Start-Process https:/about:newtab -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
          break;
        case "help":
        case "？":
          return {
            output: ["Available commands: s <search term>", "<<search term>>, null"],
            success: true,
          };
        default:
          psCommand = `try { Start-Process https://duckduckgo.com/?q=\\${cmd} -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
          outputMessage = `Directing to: ${cmd}`;
      }
    }

    try {
      await exec(`pwsh.exe -Command "${psCommand}"`, { windowsHide: true });
      return {
        output: [`${outputMessage}`],
        success: true,
      };
    } catch (err) {
      return {
        output: [`Zen prefix error: ${cmd}`],
        success: false,
      };
    }
  },
};

// --- 統一終端機 API ---
app.post("/terminal/run", async (req, res) => {
  let input = req.body.input?.trim();

  // 檢查是否有自訂前綴
  const prefixMatch = input.match(/^[/\-](\w+)\s*(.*)$/);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    const cmd = prefixMatch[2].trim();
    if (customPrefixes[prefix]) {
      const result = await customPrefixes[prefix](cmd);
      return res.json(result); // 這裡 result 已經包含 action/value
    } else {
      return res.json({ output: [`Unknown custom prefix: ${prefix}`], success: false });
    }
  }

  // 判斷是否為算式（可支援 ^ 乘方運算）
  const mathExpr = /^[0-9+\-*/^().\s]+$/;
  if (mathExpr.test(input)) {
    try {
      const result = math.evaluate(input);
      res.json({ output: [`Result: ${result}`], success: true });
    } catch (e) {
      res.json({ output: [`Error in calculation: ${e.message}`], success: false });
    }
    return;
  }

  // 無前綴，直接當 Win+R 執行
  const psCommand = `try { Start-Process -FilePath "${input}" -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`;
  exec(`pwsh.exe -Command "${psCommand}"`, { windowsHide: true }, (err, stdout) => {
    if (err) {
      res.json({ output: [`Failed to launch: ${input}`], success: false });
    } else {
      res.json({ output: [`Launched: ${input}`], success: true });
    }
  });
});

// 伺服器啟動前，先切換靜音模式
(async () => {
  try {
    await exec("pwsh.exe -Command \"Start-Process -FilePath 'hotkeys/mode1.exe' -ErrorAction Stop\"");
    console.log("已切換至靜音模式");
  } catch (e) {
    console.error("靜音模式切換失敗", e);
  }
})();

app.listen(12345, () => {
  console.log("API server running at http://localhost:12345");
});
