@echo off
rem Keep this block ASCII-only. A chcp in the middle of a script makes cmd mis-parse the
rem UTF-8 lines after it, so switch to 65001 first and re-run this file in a new cmd.
if defined SETUP_UTF8 goto :main
set "SETUP_UTF8=1"
chcp 65001 >nul
cmd /c ""%~f0" %*"
exit /b %errorlevel%

:main
setlocal
title 安裝開發環境 · Dev setup

rem 雙擊一次安裝所有開發工具與套件；可重複執行，已裝好的會略過。
rem 實際流程在 scripts\setup-dev.ps1；參數會原樣傳入（例如 -SkipPaddle、-WithDocker）。

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-dev.ps1" %*
set "RC=%errorlevel%"
echo.
pause
exit /b %RC%
