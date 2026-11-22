# 在 UGREEN NAS（DXP6800 Plus，x86-64）部署

1. 在 NAS 上取得此 repo（含 `packages/headless`），SSH 進入 `packages/headless/docker`。
2. `cp .env.example .env`，填入：
   - `TCODE_TOKEN`：`openssl rand -base64 32`
   - `TCODE_PUBLIC_HOST`：例如 `pi2.kovami.app`
   - `TUNNEL_TOKEN`：Cloudflare Zero Trust → Tunnels 建立後取得
   - `PUID/PGID`：`id <使用者>` 的結果（需對資料夾有寫入權）
   - `DATA_ROOT`、`WORKSPACES`：NAS 上實際路徑（先 `mkdir -p` 並 chown）
3. `docker compose up -d --build`（首次 build 需數分鐘；node-pty 在映像內編譯）。
4. Cloudflare Zero Trust：Public hostname `<TCODE_PUBLIC_HOST>` → `http://tcode:1200`；
   再建立 **Access application** 保護該主機名（Email OTP 或你的 IdP）。
5. 開啟 `https://<host>/?token=<TCODE_TOKEN>` 一次，之後以 cookie 登入。
6. 首次使用在 UI 設定模型 provider 的 API key（存於 `DATA_ROOT/home/.pi/agent/`）。

## 安全設計
- 應用埠**不發佈到主機**，只有同一 compose 網路內的 cloudflared 能連到。
- 容器唯讀根檔案系統、`cap_drop: ALL`、`no-new-privileges`、非 root、PID/記憶體上限。
- 不含任何對 `tce.yqcc.cn` 的連線；無遠端控制、無遠端設定覆寫。
- 代理可在容器內執行任意指令並讀寫 `WORKSPACES`：只掛載專案目錄。

## 驗證
部署後在 NAS 上執行端對端冒煙測試（容器內已有口令環境變數）：

```bash
docker compose exec tcode node /app/smoke.mjs
```
