# Leafor — Windows build script.
# All toolchains, caches and temp files live under D:\D\leafor-toolchain (nothing installed to C:).
# Output: <repo>\release\Leafor\Leafor.exe (portable; app data is stored in LeaforData\ next to it).
param([switch]$SkipInstall)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Tools = "D:\D\leafor-toolchain"
$Logs = Join-Path $Repo "build-logs"
New-Item -ItemType Directory -Force -Path $Tools, $Logs | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Start-Transcript -Path (Join-Path $Logs "build-$Stamp.log") -Force | Out-Null
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Green; Set-Content -Path (Join-Path $Logs "status.txt") -Value "RUNNING: $m" -Encoding utf8 }

try {
  # Redirect every cache / temp location away from the system drive.
  $env:RUSTUP_HOME = "$Tools\rustup"
  $env:CARGO_HOME = "$Tools\cargo"
  $env:TEMP = "$Tools\tmp"; $env:TMP = "$Tools\tmp"
  $env:npm_config_cache = "$Tools\npm-cache"
  $env:npm_config_store_dir = "$Tools\pnpm-store"
  $env:npm_config_state_dir = "$Tools\pnpm-state"
  $env:npm_config_update_notifier = "false"
  $env:PNPM_HOME = "$Tools\pnpm-home"
  $env:XDG_CACHE_HOME = "$Tools\xdg-cache"
  $env:XDG_DATA_HOME = "$Tools\xdg-data"
  $env:XDG_CONFIG_HOME = "$Tools\xdg-config"
  $env:XDG_STATE_HOME = "$Tools\xdg-state"
  $env:CI = "true"
  New-Item -ItemType Directory -Force -Path $env:TEMP, $env:PNPM_HOME | Out-Null

  # ---- Node.js (use installed one, else a portable copy under D:\D)
  Step "Checking Node.js"
  $node = Get-Command node -ErrorAction SilentlyContinue
  $nodeOk = $false
  if ($node) { $v = (& node -v) -replace "v",""; if ([version]$v -ge [version]"20.19.0") { $nodeOk = $true } }
  if (-not $nodeOk) {
    $NodeDir = "$Tools\node"
    if (-not (Test-Path "$NodeDir\node.exe")) {
      Step "Downloading portable Node.js 22 to $NodeDir"
      $ver = "v22.21.1"
      $zip = "$Tools\node.zip"
      Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zip
      Expand-Archive $zip -DestinationPath "$Tools\node-tmp" -Force
      Move-Item "$Tools\node-tmp\node-$ver-win-x64" $NodeDir
      Remove-Item $zip, "$Tools\node-tmp" -Recurse -Force
    }
    $env:Path = "$NodeDir;$env:Path"
  }
  Write-Host ("node " + (& node -v))

  # ---- Rust (rustup in D:\D, no PATH modification)
  Step "Checking Rust toolchain"
  $cargo = "$env:CARGO_HOME\bin\cargo.exe"
  if (-not (Test-Path $cargo)) {
    Step "Installing Rust (stable, MSVC) into $Tools"
    $init = "$Tools\rustup-init.exe"
    Invoke-WebRequest "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $init
    & $init -y --no-modify-path --profile minimal --default-toolchain stable --default-host x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "rustup-init failed ($LASTEXITCODE)" }
  }
  $env:Path = "$env:CARGO_HOME\bin;$env:Path"
  & cargo -V; & rustc -V

  # ---- MSVC build tools (required by the msvc Rust target)
  Step "Checking Visual Studio C++ build tools"
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $vc = $null
  if (Test-Path $vswhere) { $vc = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1 }
  if (-not $vc) { throw "MSVC C++ build tools not found. Install 'Desktop development with C++' in Visual Studio Installer (or Build Tools), then run this script again." }
  Write-Host "MSVC: $vc"

  # ---- JS dependencies (pnpm via npx, store under D:\D)
  Set-Location $Repo
  if (-not $SkipInstall) {
    Step "Installing JavaScript dependencies"
    & npx --yes pnpm@10.28.0 install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed ($LASTEXITCODE)" }
  }

  # ---- Tests
  Step "Running unit tests"
  & npx --yes pnpm@10.28.0 test
  if ($LASTEXITCODE -ne 0) { throw "unit tests failed ($LASTEXITCODE)" }

  # ---- Build (no installer: the bundler would download NSIS/WiX into the system drive)
  Step "Building Leafor (release)"
  & npx --yes pnpm@10.28.0 tauri build --no-bundle
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed ($LASTEXITCODE)" }

  Step "Packaging portable folder"
  $Out = Join-Path $Repo "release\Leafor"
  New-Item -ItemType Directory -Force -Path $Out | Out-Null
  Copy-Item (Join-Path $Repo "src-tauri\target\release\leafor.exe") (Join-Path $Out "Leafor.exe") -Force
  Set-Content -Path (Join-Path $Out "README.txt") -Encoding utf8 -Value @"
Leafor — 本地作品档案馆与创作工作台
双击 Leafor.exe 运行。应用自身的设置、搜索索引与 WebView 缓存保存在同目录的 LeaforData 文件夹中。
你的作品保存在你在应用内选择的作品库文件夹里（Markdown、图片、PDF 与 JSON 文件）。
需要 Microsoft Edge WebView2 运行时（Windows 10/11 通常已自带）。
"@
  Set-Content -Path (Join-Path $Logs "status.txt") -Value "SUCCESS: $Out\Leafor.exe" -Encoding utf8
  Write-Host "`nBuilt: $Out\Leafor.exe" -ForegroundColor Green
}
catch {
  Set-Content -Path (Join-Path $Logs "status.txt") -Value "FAILED: $($_.Exception.Message)" -Encoding utf8
  Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Stop-Transcript | Out-Null
}
