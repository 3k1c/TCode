# TCode 無頭版（Windows 原生，只用網頁端）

TCode 的後端直接跑在你的 Windows 上，用瀏覽器操作；代理直接讀寫你電腦上的專案資料夾、直接執行你的建置與測試指令，不需要 Docker，也不需要傳檔案。

## 需求
- **Node.js 22 LTS**（https://nodejs.org）
- **Git for Windows**（https://git-scm.com；提供 git 與 bash，TCode 的 bash 工具需要它）
- 已有的 Pi 設定（`%USERPROFILE%\.pi\agent`）會被直接沿用：登入、skills、extensions 都在。

## 使用
1. 解壓縮到任何資料夾，例如 `C:\tcode-headless`。
2. 雙擊 `start.cmd`。第一次會自動 `npm install`（約一分鐘，不需要編譯）。
3. 視窗會顯示：`access token: ……`（也存在 `%USERPROFILE%\.tcode-headless\web-access.json`）。
4. 瀏覽器開 `http://127.0.0.1:1200/?token=<口令>`，只需要開一次，之後以 cookie 登入。
5. 第一次使用：在設定裡填模型 provider（若已有 Pi 登入則免）。
6. **選專案資料夾**：按「開啟資料夾」時會跳出輸入框，貼上完整路徑，例如 `D:\Projects\MyApp`。（瀏覽器無法開啟伺服器電腦的資料夾視窗，所以改成輸入路徑。）
7. 驗證安裝：另開命令提示字元，`cd` 到此資料夾後執行
   `set TCODE_TOKEN=<口令>` 再 `node smoke.mjs`，全部 PASS 即正常。

## 設定
編輯 `start.cmd` 開頭（把 `rem` 去掉即啟用）：

| 變數 | 用途 |
|---|---|
| `TCODE_PORT` | 埠，預設 1200 |
| `TCODE_TOKEN` | 自訂口令（16 字元以上），不設則自動產生 |
| `PI_CODING_AGENT_DIR` | Pi 資料夾；想與 Pi CLI 分開就改掉 |
| `TCODE_SHELL` | 指定 `bash.exe` 路徑（Git 裝在非標準位置時） |
| `TCODE_BRIDGE_HOSTS` | 透過網域（Cloudflare Tunnel）連線時，填入該網域 |
| `TCODE_SCOPE=lan` | 綁定所有網卡（區網／Tailscale 用）；預設只綁 127.0.0.1 |

## 從手機／外面連回家裡電腦
預設只有本機能連。要遠端用，擇一：
- **Cloudflare Tunnel**：在 Windows 安裝 `cloudflared`，Public hostname 指向 `http://127.0.0.1:1200`，`start.cmd` 設 `TCODE_BRIDGE_HOSTS=你的網域`，並在 Cloudflare Zero Trust 為該網域加 **Access** 保護。
- **Tailscale**：設 `TCODE_SCOPE=lan`，用 Tailscale 位址連線；若用 MagicDNS 名稱，把它加入 `TCODE_BRIDGE_HOSTS`。Windows 防火牆跳出提示時只允許「私人網路」。

## 安全提醒（重要）
- 代理以**你這個 Windows 使用者的權限**執行指令，能讀寫你有權限的所有檔案。建議用專用的 Windows 使用者帳號跑，或至少不要讓它處理含機密的資料夾。
- 口令等於完整控制權：不要外洩；遠端使用務必再加一層 Cloudflare Access 或只走 Tailscale。
- 此版本已移除原版的遠端控制（`service-link`）與遠端設定覆寫（`managed-config`）。

## 常見問題
- 「no bash found」：安裝 Git for Windows，或設定 `TCODE_SHELL`。
- `npm install` 失敗：確認網路可連 `registry.npmjs.org`；公司網路需設 proxy。
- 開不了網頁：確認視窗仍在執行；`start.cmd` 視窗關閉＝伺服器停止。
- 想開機自動啟動：用「工作排程器」建立登入時執行 `start.cmd` 的工作。

## 已知限制
- 瀏覽器拖放檔案無法取得系統路徑：請在訊息裡直接貼檔案路徑，代理會自己讀取。
- 已提供 Android / Apple 主畫面捷徑圖示與 Web Manifest；尚未支援離線 Service Worker、Web Push。瀏覽器更新後若舊捷徑圖示未變，請刪除捷徑後重新加入。
- 此 Windows 版在 Linux 環境開發與單元測試，**尚未在真實 Windows 上完整驗證**；請先跑一次 `smoke.mjs`。

## 更新
- `update.cmd -Check`：只檢查有沒有新版；`update.cmd`：更新到最新版；`-Force`：強制重裝。
- 更新前請先關閉 `start.cmd` 視窗。流程：下載 → SHA-256 驗證 → 備份舊版（`backup\`，保留 3 份）→ 替換 → 用備用埠與暫存資料做冒煙測試 → **失敗自動回復舊版**。
- `update.config.json` 的 `repo` 填你的 GitHub 儲存庫（`你的帳號/TCode`）；私有庫再填 `token`（只需 Releases 讀取權限）。
- 你的 `start.cmd` 設定、`%USERPROFILE%\.tcode-headless` 與 Pi 資料不會被動到。`start.cmd`/`update.ps1` 若有新版，會另存為 `.new` 檔供你比對。
- Release 由 GitHub Actions 每週自動建置（合併上游、測試、安全掃描、冒煙測試都過了才發佈），見 `UPDATING.md`。
