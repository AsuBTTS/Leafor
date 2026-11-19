@echo off
rem Publish this folder to https://github.com/AsuBTTS/Leafor as one commit on top of the existing "Initial commit".
rem Uses your own git + saved GitHub login (e.g. from GitHub Desktop / Git Credential Manager).
chcp 65001 >nul
cd /d "%~dp0..\.."
where git >nul 2>&1 || (echo git not found. Install Git for Windows or use GitHub Desktop. & pause & exit /b 1)
if not exist ".git" (
  git init -b main || goto :fail
  git remote add origin https://github.com/AsuBTTS/Leafor.git || goto :fail
)
git fetch origin main || goto :fail
git reset --mixed origin/main || goto :fail
git add -A || goto :fail
git commit -F scripts\windows\commit-message.txt || goto :fail
git push -u origin main || goto :fail
echo.
echo Done: https://github.com/AsuBTTS/Leafor
pause
exit /b 0
:fail
echo.
echo Something went wrong (see the message above). Nothing is lost; you can run this again.
pause
exit /b 1
