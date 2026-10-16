@echo off
rem Keep this block ASCII-only. A chcp in the middle of a script makes cmd mis-parse the
rem UTF-8 lines after it, so switch to 65001 first and re-run this file in a new cmd.
if defined WB_UTF8 goto :main
set "WB_UTF8=1"
chcp 65001 >nul
cmd /c ""%~f0" %*"
exit /b %errorlevel%

:main
setlocal
title 開發工作台 · Workbench

rem 雙擊啟動開發工作台：建置前端，啟動 Python gRPC 與 Go，全部就緒後自動開啟 http://localhost:8080。
rem 首次執行會自動安裝套件；已在執行時直接開啟瀏覽器。關閉此視窗即停止所有服務。
rem 實際的啟動流程在 workbench\scripts\dev.mjs（與 make workbench 相同）。

cd /d "%~dp0"
set "URL=http://localhost:8080"

curl -s -f -o nul "%URL%/workbench/v1/dev/config-schemas" && (
    echo 工作台已在執行，開啟瀏覽器 · Already running
    start "" "%URL%"
    exit /b 0
)

set "MISSING="
where python >nul 2>nul || if not exist "ai\.venv\Scripts\python.exe" (
    echo [缺少] Python 3.11 以上：winget install Python.Python.3.12
    set "MISSING=1"
)
where go >nul 2>nul || (
    echo [缺少] Go 1.25 以上：winget install GoLang.Go
    set "MISSING=1"
)
where node >nul 2>nul || (
    echo [缺少] Node.js 22：winget install OpenJS.NodeJS.LTS
    set "MISSING=1"
)
if defined MISSING (
    echo.
    echo 請先安裝上列工具，裝完後重開此視窗 · Install the tools above, then run this again.
    pause
    exit /b 1
)

echo.
echo 啟動工作台，就緒後會自動開啟 %URL%
echo Starting workbench. 關閉此視窗即可停止 · Close this window to stop.
echo.
node workbench\scripts\dev.mjs
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo [錯誤] 工作台啟動失敗 · Failed to start
echo 請把上方訊息提供給組員或 AI 工具。
pause
exit /b 1
