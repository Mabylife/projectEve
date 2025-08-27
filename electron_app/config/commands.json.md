# Project Eve `commands.json` 使用指南（v2 簡化版）

本文件說明如何在 Project Eve 中透過 `commands.json` 配置自訂指令。此版本採用「簡化 schema」：以 prefix + cmds + action 的方式描述一條指令，並由伺服端執行對應動作（內建 function、發送虛擬按鍵、開捷徑、開網址）。Help 內容也會依此 JSON 動態產生。

---

## 檔案位置與重新載入

- 預設位置：`electron_app/config/commands.json`
- 可用環境變數覆蓋：`EVE_CONFIG_DIR`（設定後，commands.json 放在該資料夾）
- 重新載入：
  - 在 App 內修改並儲存後，Electron 會自動呼叫 Python 的 `/reload-commands` 重新載入
  - 也可手動：
    ```powershell
    Invoke-RestMethod -Method POST http://127.0.0.1:54321/reload-commands
    ```
- 記錄檔：如載入失敗或不合規，伺服端會忽略內容；建議開啟伺服端日誌以便除錯

---

## 檔案格式（v2）

- 頂層欄位：

  - `version`: 目前固定為 `2`（必填）
  - `commands`: 指令陣列（必填）

- 每條指令的欄位：
  - `id`（必填）：唯一識別字串（字母/數字/.-\_）
  - `enabled`（選填，預設 true）：停用時設 `false`
  - `name`（選填）：此指令的人類可讀名稱
  - `prefix`（必填）：前綴（例如 `mode`、`m`、`eve`、`bin`）
  - `cmds`（必填）：同義子指令清單（大小寫不敏感，可包含空白，例如 `autofocus on`）
  - `action`（必填）：執行方式之一
    - `function`（內建功能）
    - `send_vk`（發送虛擬按鍵）
    - `open_shortcut`（啟動捷徑檔 .lnk）
    - `open_url`（開啟網址）
  - `output_ok` / `output_fail`（選填）：執行成功/失敗時於 UI console 顯示的訊息（字串或字串陣列）
  - `help`（選填）：此指令的說明文字；用於 `/prefix help` 產生說明行

比對規則：

- 使用者在控制台輸入的格式為：`/prefix cmd` 或 `-prefix cmd`
- prefix 與 cmd 比對不分大小寫
- cmd 會自動「合併多重空白」後比對，例如 `clean   full` 仍可匹配 `cmds: ["clean full"]`
- 只做「完整比對」，不做部分前綴模糊比對（避免歧義）

---

## Help（動態生成）

- 輸入 `/help`、`-help` 或 `help`：
  - 列出所有可用的 `prefix` 與各自指令數量
  - 說明「不加 prefix」時的預設行為（Win+R 啟動與數學運算）
- 輸入 `/{prefix} help`：
  - 列出該 `prefix` 底下所有可用子指令（優先顯示每條的 `help`，否則用 `name`）
- 輸入 `/{prefix}`（沒有子指令）：
  - 等同顯示 `/{prefix} help`

未知情況的回覆：

- 未知 prefix：會提示「Unknown prefix: {prefix}」並列出所有可用 prefix
- prefix 正確但子指令不匹配：會列出該 prefix 的所有可用子指令，便於使用者挑選

---

## Action 類型

### 1) 內建 function（`action.type = "function"`）

用於「需要前端額外旗標 extra/flags」才能觸發 UI 行為的指令。使用者在 `commands.json` 只需選擇 function 名稱即可，伺服端會執行必要的動作並回傳對應 flags。

可用名稱與行為：

- 電源模式
  - `power_silent` → 發送對應鍵組，flags: `{ isChangePowerMode: true, mode: "silent" }`
  - `power_balanced` → flags: `{ isChangePowerMode: true, mode: "balanced" }`
  - `power_turbo` → flags: `{ isChangePowerMode: true, mode: "turbo" }`
- 媒體控制
  - `media_toggle`（播放/暫停）
  - `media_next`
  - `media_prev`
  - `media_stop`
- 視窗/介面旗標
  - `toggle_immersive` → flags: `{ isToggleImmMode: true }`
  - `autofocus_on` → flags: `{ isAutoFocusOn: true }`
  - `autofocus_off` → flags: `{ isAutoFocusOn: false }`
  - `clear_output` → flags: `{ isClearOutput: true, isFullClear: false }`
  - `clear_output_full` → flags: `{ isClearOutput: true, isFullClear: true }`
  - `quote_copy` → flags: `{ isCopiedQuote: true }`
  - `quote_change` → flags: `{ isChangeQuote: true }`
  - `reconnect` → flags: `{ isReconnect: true }`
- 回收筒
  - `open_bin`（開啟回收筒）
  - `clean_bin`（清空回收筒）→ flags: `{ isMakeRecycleBinZero: true }`
- 搜尋
  - `search` (Google搜尋)
  - `auto_dir_search` (自動進入第一個搜尋結果 - 使用DuckDuckGo !bang搜尋)

備註：

- 多數 function 內部會呼叫 `send_vk` 或 PowerShell；使用者不需要知道細節
- UI 端依據 flags 決定後續行為（例如切換沉浸模式、清除輸出、刷新）

---

### 2) 發送虛擬按鍵 `send_vk`

用於送出鍵盤虛擬鍵（VK）事件，支援「組合鍵」或「連續鍵」兩種模式。

可用參數：

- `keys`（必填）：陣列，每個元素為數字或十六進位字串
  - 可混用：`[17, "0x10", "0x7F"]`
  - 會自動轉換 `"0x.."` 為數字
- `mode`（選填，預設 `"combo"`）：
  - `"combo"`：依序按下所有鍵 → 停留 `hold_ms` → 反向全部放開（適合組合鍵）
  - `"sequence"`：每一鍵「按下 → 放開」後再換下一鍵（適合連續點擊）
- `inter_key_delay_ms`（選填，預設 0）：鍵與鍵之間的間隔（毫秒）
- `hold_ms`（選填，預設 50）：`combo` 模式，全部按下後的停留時間（毫秒）

常用虛擬鍵（VK）示例：

- Ctrl: `0x11`（17）
- Shift: `0x10`（16）
- Alt: `0x12`（18）
- 媒體鍵：
  - Play/Pause: `0xB3`
  - Next: `0xB0`
  - Previous: `0xB1`
  - Stop: `0xB2`
- 你的現有電源模式鍵值（範例）：
  - Silent: `0x11, 0x10, 0x12, 0x7F`
  - Balanced: `0x11, 0x10, 0x12, 0x80`
  - Turbo: `0x11, 0x10, 0x12, 0x81`

注意事項：

- 目前簡化實作未處理「EXTENDED」旗標，部分鍵在特定裝置可能需要進階處理（現況多數環境可用）
- `sequence` 模式搭配 `inter_key_delay_ms` 可模擬人為按鍵節奏

---

### 3) 開捷徑 `open_shortcut`

- 參數：`name`（必填）— 捷徑檔名
  - 可省略副檔名，會自動補上 `.lnk`（例如填 `Notion` 等同於 `Notion.lnk`）
- 尋找位置（依序）：
  1. 環境變數 `EVE_SHORTCUTS_DIR`
  2. `{CONFIG_DIR}/shortcuts`
- 安全性限制：
  - 僅允許啟動該資料夾內的 `.lnk` 檔
  - 會阻擋目錄穿越（不能指向上一層）

---

### 4) 開網址 `open_url`

- 參數：`url`（必填）— 直接開啟此 URL
- 實作上使用 PowerShell `Start-Process` 交由預設瀏覽器開啟

---

## 完整示例

```json
{
  "version": 2,
  "commands": [
    {
      "id": "mode.silent",
      "name": "Power: Silent",
      "prefix": "mode",
      "cmds": ["silent", "sil"],
      "action": { "type": "function", "name": "power_silent" },
      "output_ok": "Power mode change to silent",
      "help": "/mode silent | /mode sil"
    },
    {
      "id": "mode.balanced",
      "name": "Power: Balanced",
      "prefix": "mode",
      "cmds": ["balanced", "bal"],
      "action": { "type": "function", "name": "power_balanced" },
      "output_ok": "Power mode change to balanced"
    },
    {
      "id": "m.toggle",
      "name": "Media: Toggle",
      "prefix": "m",
      "cmds": ["p", "toggle"],
      "action": { "type": "function", "name": "media_toggle" },
      "output_ok": "Media toggled"
    },
    {
      "id": "m.next",
      "name": "Media: Next",
      "prefix": "m",
      "cmds": ["next"],
      "action": { "type": "function", "name": "media_next" },
      "output_ok": "Media next"
    },
    {
      "id": "m.custom-vk",
      "name": "Media: Custom VK",
      "prefix": "m",
      "cmds": ["custom"],
      "action": {
        "type": "send_vk",
        "keys": ["0x11", "0x10", "0x41"], // Ctrl+Shift+A
        "mode": "combo",
        "hold_ms": 60
      },
      "output_ok": "Custom key sent"
    },
    {
      "id": "bin.clean",
      "name": "Recycle Bin: Clean",
      "prefix": "bin",
      "cmds": ["clean"],
      "action": { "type": "function", "name": "clean_bin" },
      "output_ok": "cleaned recycle bin"
    },
    {
      "id": "eve.imm",
      "name": "Toggle Immersive",
      "prefix": "m",
      "cmds": ["imm", "immersive"],
      "action": { "type": "function", "name": "toggle_immersive" },
      "output_ok": "Media toggled immersive mode"
    },
    {
      "id": "apps.notion",
      "name": "App: Notion",
      "prefix": "app",
      "cmds": ["notion"],
      "action": { "type": "open_shortcut", "name": "Notion" },
      "output_ok": "Launched: Notion"
    },
    {
      "id": "web.github",
      "name": "Web: GitHub",
      "prefix": "web",
      "cmds": ["github"],
      "action": { "type": "open_url", "url": "https://github.com" },
      "output_ok": "Opened: GitHub"
    }
  ]
}
```

使用方式（輸入示例）：

- `/mode sil`、`/mode balanced`、`/mode turbo`
- `/m p`、`/m next`、`/m imm`
- `/bin clean`、`/bin open`
- `/app notion`
- `/web github`
- `/help`、`/mode help`

---

## 不加 prefix 的行為（預設）

- 若輸入為「數學運算」：會直接計算並顯示結果（允許的字元為數字與 `+ - * / ^ ( ) .` 與空白）
- 否則：視為 Win+R 類行為，嘗試 `Start-Process` 啟動你輸入的字串（例如 `notepad`）

---

## 常見問題與除錯

- 載入失敗或 prefix 全部 Unknown
  - 確認 `version` 為 `2`
  - 確認每條指令具備 `id/prefix/cmds/action`
  - `action.type` 限定為 `"function" | "send_vk" | "open_shortcut" | "open_url"`
  - 修改後有呼叫 `/reload-commands`（App 正常會自動呼叫）
- `/prefix help` 無內容
  - 該 prefix 底下可能沒有啟用的指令（`enabled: false` 會被忽略）
- `send_vk` 沒反應
  - 嘗試加大 `hold_ms` 或在 `sequence` 模式加入 `inter_key_delay_ms`
  - 特定特殊鍵在個別裝置上可能需要進階處理（目前簡化版未加 EXTENDED flag）
- `open_shortcut` 找不到檔案
  - 把 `.lnk` 放到 `EVE_SHORTCUTS_DIR` 或 `{CONFIG_DIR}/shortcuts`
  - 可以省略 `.lnk`，內部會自動補上
  - 僅允許該資料夾中的 `.lnk`，不可跨目錄
- 安全性提醒
  - `open_shortcut` 僅允許 `.lnk`
  - `open_url` 會交由預設瀏覽器開啟指定網址
  - `send_vk` 會直接發送鍵盤事件，請自行評估環境安全性與衝突可能

---

## 小技巧

- 一個 prefix 下可以配置多條指令，透過 `cmds` 放入同義詞，如 `["prev", "previous"]`
- `cmds` 可包含空白以描述片語（例如 `["autofocus on"]`）
- 若要暫時停用某條指令，設置 `"enabled": false` 即可
- `output_ok` 未填時，伺服端會以指令名稱或通用訊息填補

---

如你需要更多預設指令範例或要擴充 `function` 名稱清單，告訴我你的需求，我可以直接提供對應 JSON 區塊。
