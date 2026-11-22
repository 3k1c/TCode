# 自動更新流程

```
上游 TCode ──(每週/手動)──► GitHub Actions: headless-release
                              1 合併上游到 headless-nas      衝突 → 中止並開 issue
                              2 npm ci + 建置
                              3 單元測試
                              4 安全掃描                     出現新外連網域/遠端控制程式碼 → 中止並開 issue
                              5 真實伺服器冒煙測試           失敗 → 中止並開 issue
                              6 打包 + SHA-256               全部通過才推送分支、發佈 Release
                                   │
              ┌────────────────────┴────────────────────┐
         Windows: update.cmd                      NAS: docker/update.sh
         下載 Release → 驗證 → 備份 →             git ff 拉分支 → 重建映像 → 健康檢查 →
         替換 → 冒煙測試 → 失敗自動回復            冒煙測試 → 失敗自動回復
```

## 一次性設定
1. 把本專案推到**你自己的 GitHub 儲存庫**（fork），分支 `headless-nas`。
2. 讓 `.github/workflows/headless-release.yml` 也存在於 fork 的**預設分支**（排程只會從預設分支執行），並在 Settings → Actions 啟用工作流程。
3. 在 Actions 頁面手動執行一次 `headless-release`（Run workflow，勾選 `force_release`）產生第一個 Release。
4. Windows：`update.config.json` 的 `repo` 填 `你的帳號/儲存庫`（CI 打包的壓縮包會自動帶入）。NAS：`docker/update.sh` 加入工作排程。

## 在自己的機器上跑同一條流程
```bash
UPSTREAM_URL=https://github.com/liassy-ai/TCode.git packages/headless/scripts/release.sh
STEPS=build,test,scan,smoke,package packages/headless/scripts/release.sh   # 不合併上游
```
結束碼：2 合併衝突、3 安全掃描未過、4 測試/冒煙未過。GitHub Actions 使用一次性工作目錄；只有全部成功才推送分支，因此失敗不會覆寫已發布分支。手動本機合併須在一次性 clone 中設定 `TCODE_ALLOW_LOCAL_MERGE=1`。
NAS 更新失敗會回復先前的 Docker 映像，不使用 `git reset --hard`；原始碼工作目錄保留較新提交以供排錯。

## 這套流程不會做的事
- **不會自動升級 Pi**：Pi 版本跟著 TCode 上游鎖定（目前 1.4.0）。上游升級時才會跟著變，Release 說明會列出 Pi 版本。
- **不會在你不知情時改動執行中的伺服器**：Windows 版要你執行 `update.cmd`（伺服器必須已關閉）；NAS 版只有你排程 `update.sh` 才會自動更新。
- **安全掃描是啟發式的**：只攔「新外連網域」「已知遠端控制程式碼」。新網域加入 `scripts/egress-allowlist.txt` 前請先看過上游改了什麼。
- Windows 更新腳本（`update.ps1`）與 GitHub Actions 工作流程**尚未在真實環境執行過**，請第一次手動跑並看輸出。
