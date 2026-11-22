# @tcode/headless — 無 Electron 的 TCode 伺服器（NAS / Docker 用）

讓 TCode 的後端（Pi SDK）與網頁橋接在純 Node 下執行，不需要桌面環境。

## 與官方桌面版的差異

| 項目 | 做法 |
|---|---|
| `component.exe`（閉源 Go 二進位：PTY / git / shell / 檢查點的底層） | **不使用**。以 `src/local-runner.ts` 淨室重寫（`git.exec`、`shell.run`、`shell.kill`、`pty.*`），純本機子程序，無網路、不寫設定 |
| `service-link`（連 `wss://tce.yqcc.cn/client` 的遠端控制） | **不載入**。打包產物中不含該網域 |
| `managed-config`（遠端 JSON 覆寫 `~/.pi/agent/settings.json`） | **不載入** |
| Electron API | `src/electron-shim.ts` 以 esbuild alias 取代；桌面專屬功能（內建瀏覽器、託盤、自動更新）為停用/拋錯 |
| 網頁存取設定（開關／範圍／重置口令） | 唯讀，由環境變數決定，避免從網頁誤關而被鎖在外面 |
| 內建瀏覽器控制工具 | 停用（對應 skills 也關閉） |

## Windows 原生（只用網頁端）

見 `windows/README-WINDOWS.md`。打包：`npm run build -w packages/desktop`（建議先設 `VITE_TCODE_HEADLESS=1`，讓網頁端的「開啟資料夾」改為輸入路徑）→ `npm run build -w packages/headless` → `node scripts/package-win.mjs`，產出 `dist-win/tcode-headless-win/`。

## 建置與執行（不用 Docker）

```bash
npm ci                                   # 於 repo 根目錄
npm run build -w packages/desktop        # 產生 renderer（out/renderer）
npm run build -w packages/headless       # 產生 packages/headless/dist
cd packages/headless/dist
cp ../docker/runtime-package.json package.json && npm install --omit=dev
TCODE_TOKEN=至少16字元的口令 TCODE_DATA_DIR=./data node server.mjs
```

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `TCODE_TOKEN` | 自動產生並存於 `$TCODE_DATA_DIR/web-access.json`（0600） | 網頁橋接口令，至少 16 字元 |
| `TCODE_PORT` | `1200` | 監聽埠 |
| `TCODE_SCOPE` | `local` | `local` 只綁 127.0.0.1；`lan` 綁所有網卡（Docker 映像預設 `lan`，請只在容器私有網路內暴露） |
| `TCODE_BRIDGE_HOSTS` | 空 | 逗號分隔的額外 Host/Origin 白名單，例如 `pi2.kovami.app` |
| `TCODE_DATA_DIR` | `~/.tcode-headless` | TCode userData（日誌、UI 狀態、web-access.json） |
| `TCODE_APP_ROOT` / `TCODE_RENDERER_DIR` | `dist/` / `dist/renderer` | 資源與 renderer 位置 |
| `TCODE_SHELL` / `TCODE_GIT` | 自動偵測 | bash 與 git 路徑 |
| `TCODE_PRINT_TOKEN=1` | 關 | 啟動時印出口令（預設不印） |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | Pi 的設定、驗證、會話 |

## 驗證

```bash
npm test -w packages/headless            # 16 個單元測試（LocalRunner、真實 PTY）
TCODE_TOKEN=... node scripts/smoke.mjs   # 對運行中的伺服器做端對端冒煙測試（容器內為 /app/smoke.mjs）
```

## 已知限制

- 口令是**單一共用口令**（TCode 原設計），沒有逐裝置金鑰；請務必在前面加 Cloudflare Access。
- 沒有 PWA 安裝、Web Push；手機版介面可用性**尚未實測**（renderer 為桌面版 UI）。
- 未以真實 LLM 金鑰跑過完整代理回合；會話建立、檢查點、PTY、git 已測。
- `LocalRunner` 與原 `component.exe` 行為是依介面與觀察重寫，個別邊角行為（輸出截斷上限、錯誤碼）可能不同。
- 代理擁有容器內 shell：容器**只掛載需要的工作目錄**，不要掛整個 NAS 或含機密的卷。
