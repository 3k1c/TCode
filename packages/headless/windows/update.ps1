<#
  TCode headless updater (Windows).
  Downloads the latest GitHub Release built by the headless-release workflow, verifies its SHA-256,
  backs up the current install, swaps it in, smoke-tests the new version on a spare port with a throw-away
  data folder, and ROLLS BACK automatically if anything fails.

    update.cmd            update to the latest release
    update.cmd -Check     only report whether an update exists
    update.cmd -Force     reinstall even if already on the latest version

  Config: update.config.json  {"repo":"owner/repo","token":""}   (token only needed for a private repo)
          or env TCODE_UPDATE_REPO / TCODE_UPDATE_TOKEN
  Close the start.cmd window first (the server must not be running).
#>
param(
	[switch]$Check,
	[switch]$Force
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Fail($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host $msg }

# ---------- config ----------
$cfg = @{ repo = ""; token = "" }
if (Test-Path "update.config.json") {
	try {
		$j = Get-Content "update.config.json" -Raw | ConvertFrom-Json
		if ($j.repo) { $cfg.repo = [string]$j.repo }
		if ($j.token) { $cfg.token = [string]$j.token }
	} catch { Fail "update.config.json is not valid JSON" }
}
if ($env:TCODE_UPDATE_REPO) { $cfg.repo = $env:TCODE_UPDATE_REPO }
if ($env:TCODE_UPDATE_TOKEN) { $cfg.token = $env:TCODE_UPDATE_TOKEN }
if (-not $cfg.repo -or $cfg.repo -notmatch '^[\w.-]+/[\w.-]+$') {
	Fail "Set your GitHub repo in update.config.json, e.g. {`"repo`":`"yourname/TCode`"}"
}

$headers = @{ "User-Agent" = "tcode-headless-updater"; "Accept" = "application/vnd.github+json" }
if ($cfg.token) { $headers["Authorization"] = "Bearer $($cfg.token)" }

function Test-Port([int]$p) {
	try {
		$c = New-Object Net.Sockets.TcpClient
		$iar = $c.BeginConnect("127.0.0.1", $p, $null, $null)
		$ok = $iar.AsyncWaitHandle.WaitOne(500)
		if ($ok) { try { $c.EndConnect($iar) } catch { $ok = $false } }
		$c.Close()
		return $ok
	} catch { return $false }
}

function Download($asset, $dest) {
	if ($cfg.token) {
		$h = $headers.Clone(); $h["Accept"] = "application/octet-stream"
		Invoke-WebRequest -Uri $asset.url -Headers $h -OutFile $dest -UseBasicParsing
	} else {
		Invoke-WebRequest -Uri $asset.browser_download_url -Headers @{ "User-Agent" = "tcode-headless-updater" } -OutFile $dest -UseBasicParsing
	}
}

# ---------- what is available ----------
$local = "unknown"
if (Test-Path "VERSION") { $local = (Get-Content "VERSION" -Raw).Trim() }
Info "Installed: $local"
try {
	$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$($cfg.repo)/releases/latest" -Headers $headers
} catch { Fail "Cannot read releases of $($cfg.repo): $($_.Exception.Message)" }
$remote = ([string]$rel.tag_name).TrimStart("v")
Info "Latest:    $remote"
if ($remote -eq $local -and -not $Force) { Info "Already up to date."; exit 0 }
if ($Check) { Info "Update available: $local -> $remote"; exit 10 }

$zipAsset = $rel.assets | Where-Object { $_.name -eq "tcode-headless-win.zip" } | Select-Object -First 1
$metaAsset = $rel.assets | Where-Object { $_.name -eq "latest.json" } | Select-Object -First 1
if (-not $zipAsset -or -not $metaAsset) { Fail "Release $remote is missing tcode-headless-win.zip or latest.json" }

$port = 1200
if ($env:TCODE_PORT) { $port = [int]$env:TCODE_PORT }
if (Test-Port $port) { Fail "TCode is still running on port $port. Close the start.cmd window, then run update again." }

# ---------- download + verify ----------
$work = Join-Path $env:TEMP ("tcode-update-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null
try {
	$zip = Join-Path $work "tcode-headless-win.zip"
	$meta = Join-Path $work "latest.json"
	Info "Downloading..."
	Download $metaAsset $meta
	Download $zipAsset $zip
	$expected = ((Get-Content $meta -Raw | ConvertFrom-Json).sha256).ToString().ToLower()
	$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
	if ($expected -ne $actual) { Fail "SHA-256 mismatch (expected $expected, got $actual). Nothing was changed." }
	Info "SHA-256 ok."

	$ex = Join-Path $work "x"
	Expand-Archive -Path $zip -DestinationPath $ex -Force
	$src = Join-Path $ex "tcode-headless-win"
	if (-not (Test-Path (Join-Path $src "server.mjs"))) { Fail "Archive layout unexpected. Nothing was changed." }

	# ---------- backup ----------
	$items = @("server.mjs", "smoke.mjs", "package.json", "VERSION", "renderer", "resources")
	$bk = Join-Path $root ("backup\" + $local + "-" + (Get-Date -Format "yyyyMMddHHmmss"))
	New-Item -ItemType Directory -Path $bk -Force | Out-Null
	foreach ($i in $items) { if (Test-Path $i) { Copy-Item $i -Destination $bk -Recurse -Force } }
	Info "Backup: $bk"

	function Install-From($from) {
		foreach ($i in $items) {
			$s = Join-Path $from $i
			if (-not (Test-Path $s)) { continue }
			if (Test-Path $i) { Remove-Item $i -Recurse -Force }
			Copy-Item $s -Destination $i -Recurse -Force
		}
		& npm install --omit=dev --no-audit --no-fund
		if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
	}

	# ---------- swap in ----------
	$failed = $null
	try {
		Install-From $src
		Copy-Item (Join-Path $src "README-WINDOWS.md") "README-WINDOWS.md" -Force
		# the running script cannot overwrite itself: keep the new updater beside it
		if (Test-Path (Join-Path $src "update.ps1")) { Copy-Item (Join-Path $src "update.ps1") "update.ps1.new" -Force }
		# keep your start.cmd settings; offer the new one next to it when it changed
		$newStart = Join-Path $src "start.cmd"
		if ((Test-Path $newStart) -and ((Get-FileHash $newStart).Hash -ne (Get-FileHash "start.cmd").Hash)) {
			Copy-Item $newStart "start.cmd.new" -Force
			Info "Note: start.cmd changed upstream; compare with start.cmd.new if you want the new defaults."
		}

		# ---------- smoke test on a spare port, throw-away data ----------
		Info "Testing the new version..."
		$tmpData = Join-Path $work "data"
		$tmpPi = Join-Path $work "pi"
		$testPort = 1297
		$token = [guid]::NewGuid().ToString("N")
		$saved = @{}
		foreach ($k in "TCODE_DATA_DIR", "PI_CODING_AGENT_DIR", "TCODE_PORT", "TCODE_TOKEN", "TCODE_URL", "TCODE_SCOPE", "TCODE_PRINT_TOKEN") { $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process") }
		$env:TCODE_DATA_DIR = $tmpData; $env:PI_CODING_AGENT_DIR = $tmpPi; $env:TCODE_PORT = "$testPort"
		$env:TCODE_TOKEN = $token; $env:TCODE_URL = "http://127.0.0.1:$testPort"; $env:TCODE_SCOPE = "local"; $env:TCODE_PRINT_TOKEN = "0"
		$proc = $null
		try {
			$proc = Start-Process node -ArgumentList "server.mjs" -WorkingDirectory $root -PassThru -WindowStyle Hidden `
				-RedirectStandardOutput (Join-Path $work "server.out.log") -RedirectStandardError (Join-Path $work "server.err.log")
			$up = $false
			for ($n = 0; $n -lt 60; $n++) {
				if ($proc.HasExited) { break }
				if (Test-Port $testPort) { $up = $true; break }
				Start-Sleep -Seconds 1
			}
			if (-not $up) { throw "new version did not start (see $work\server.err.log)" }
			& node smoke.mjs
			if ($LASTEXITCODE -ne 0) { throw "smoke test failed" }
		} finally {
			if ($proc -and -not $proc.HasExited) { try { & taskkill /PID $proc.Id /T /F 2>&1 | Out-Null } catch {} }
			foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], "Process") }
		}
	} catch {
		$failed = $_.Exception.Message
	}

	if ($failed) {
		Write-Host "[ERROR] Update failed: $failed" -ForegroundColor Red
		Write-Host "Rolling back to $local ..." -ForegroundColor Yellow
		Install-From $bk
		Fail "Rolled back to $local. Server logs kept in $work"
	}

	# keep the 3 newest backups
	Get-ChildItem (Join-Path $root "backup") -Directory | Sort-Object Name -Descending | Select-Object -Skip 3 | Remove-Item -Recurse -Force
	Info ""
	Write-Host "Updated $local -> $remote. Start it with start.cmd." -ForegroundColor Green
} finally {
	if (Test-Path $work -PathType Container) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}
