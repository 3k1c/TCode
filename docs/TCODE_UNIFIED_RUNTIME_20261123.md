# TCode 無頭版統一重構（2026-11-23）

## 目標
Pi Agent 管理唯一 Session / 上下文 / Plan。TCode 只處理工具傳輸、程序生命週期及 UI 觀測。保留正式版既有 Chromium、Web Push、文件上載與資料夾管理功能。

## 已確認根因
- Windows LocalRunner 等待 close 才結束；繼承輸出管道的孫程序會令工具長時間停滯。
- Windows taskkill /T 在父程序退出後無法找到孤兒子孫。
- 目前正式版曾強制替換停止逾時的 Pi Session，造成 Extension stale context。
- WebSocket 重連沒有狀態快照；前端曾以輪詢補救。
- 未設定 pipefail 的測試腳本可能錯判成功；這是 AI 腳本使用方式，非應強制更改的工具預設。
- 手機側欄曾在收合狀態下短暫佔用 240px；停止和送出按鈕被擠壓。

## 統一實作
- Bash/Git 依程序 exit 完成；stdout/stderr 最多排空 1.5 秒，不完整輸出有標記。
- 以 PID 和建立時間追蹤 Windows 子孫；取消與逾時清理，正常退出不殺背景服務。
- Bash 最長 60 分鐘、Git 10 分鐘；無輸出僅提示進度，不代表停止。
- TCODE_SHELL_PIPEFAIL=1 可選開啟，預設停用；規則 Skill 要求模型自行檢查退出碼。
- Pi abort 最多等待 15 秒回應；失敗只顯示錯誤，保留 Session，不再強制替換。
- WebSocket hello 主動推送完整 runtime snapshot，前端不再 4 秒輪詢。
- 手機側欄浮動，Stop 與 Follow-up 送出按鈕並列固定 32px。

## 驗證
- Windows LocalRunner：8/8。
- Pi abort + ask_user：6/6。
- Desktop、Headless、Backend 型別檢查通過，正式建置通過。
- 獨立服務 1201：WebSocket 快照正常。
- 360/390/420px 手機視口，停止與送出按鈕沒有重疊或越界。
- 授權檔案上載 201，未授權 403。
- 模組與正式版比對，保留原有上載、Chromium、Web Push。

## 部署原則
先備份現役 server.mjs、renderer、VERSION；確認沒有活躍 Session 後切換。保留 Pi 資料與用戶專案。任何錯誤以備份還原，不切換 Session 或重置用戶工作。
