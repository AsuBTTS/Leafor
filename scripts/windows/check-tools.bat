@echo off
rem Leafor: report which build tools exist on this PC. Read-only; writes only build-logs\tools.log.
chcp 65001 >nul
set ROOT=%~dp0..\..
if not exist "%ROOT%\build-logs" mkdir "%ROOT%\build-logs"
set LOG=%ROOT%\build-logs\tools.log
echo === Leafor toolchain check %DATE% %TIME% === > "%LOG%"
for %%T in (node npm rustc cargo rustup git) do (
  echo --- where %%T --- >> "%LOG%"
  where %%T >> "%LOG%" 2>&1
)
echo --- node -v --- >> "%LOG%"
node -v >> "%LOG%" 2>&1
echo --- D:\D\leafor-toolchain --- >> "%LOG%"
dir /b "D:\D\leafor-toolchain" >> "%LOG%" 2>&1
echo --- vswhere VC tools --- >> "%LOG%"
"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath >> "%LOG%" 2>&1
echo --- vswhere all --- >> "%LOG%"
"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -products * -property displayName >> "%LOG%" 2>&1
echo --- Windows SDK --- >> "%LOG%"
dir /b "%ProgramFiles(x86)%\Windows Kits\10\Lib" >> "%LOG%" 2>&1
echo --- WebView2 --- >> "%LOG%"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >> "%LOG%" 2>&1
echo --- Song fonts --- >> "%LOG%"
dir /b C:\Windows\Fonts\simsun* >> "%LOG%" 2>&1
echo --- proxy --- >> "%LOG%"
set HTTP >> "%LOG%" 2>&1
netsh winhttp show proxy >> "%LOG%" 2>&1
echo === done === >> "%LOG%"
