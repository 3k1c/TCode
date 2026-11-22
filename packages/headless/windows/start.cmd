@echo off
setlocal
cd /d "%~dp0"
title TCode headless

rem ===== Settings (edit here) =====
if not defined TCODE_PORT set TCODE_PORT=1200
if not defined TCODE_DATA_DIR set TCODE_DATA_DIR=%USERPROFILE%\.tcode-headless
rem Token: leave unset to auto-generate once (stored in %TCODE_DATA_DIR%\web-access.json), or set your own (16+ chars):
rem set TCODE_TOKEN=change-me-to-a-long-random-string
rem Pi data folder. Default is your normal %USERPROFILE%\.pi\agent (shares login/skills/sessions with Pi CLI on this PC).
rem set PI_CODING_AGENT_DIR=%USERPROFILE%\.tcode-headless\pi-agent
rem Remote access through Cloudflare Tunnel: allow the public host name:
rem set TCODE_BRIDGE_HOSTS=pi2.kovami.app
rem Listen on all network interfaces (LAN / Tailscale). Default is 127.0.0.1 only:
rem set TCODE_SCOPE=lan
rem Custom Git Bash location:
rem set TCODE_SHELL=C:\Program Files\Git\bin\bash.exe
set TCODE_PRINT_TOKEN=1

where node >/dev/null 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 22 LTS from https://nodejs.org
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=22?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js 22 or newer is required.
  node -v
  pause
  exit /b 1
)
where git >/dev/null 2>nul
if errorlevel 1 echo [WARN] git not found in PATH. Install Git for Windows (it also provides bash, which TCode needs).

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Starting TCode headless on http://127.0.0.1:%TCODE_PORT%  (Ctrl+C to stop)
node server.mjs
echo.
echo Server stopped.
pause
