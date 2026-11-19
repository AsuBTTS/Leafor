@echo off
rem Double-click to build Leafor. Tools go to D:\D\leafor-toolchain; output to release\Leafor\Leafor.exe
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1" %*
echo.
echo Build finished. See build-logs\ for the full log.
timeout /t 15
