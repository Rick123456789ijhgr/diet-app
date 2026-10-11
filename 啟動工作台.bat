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
title 開發工作台 Workbench

rem 雙擊啟動開發工作台：首次執行會自動建立 ai\.venv 並安裝套件。
rem 已在執行時直接開啟瀏覽器；關閉此視窗即停止工作台。

cd /d "%~dp0ai"
set "PY=.venv\Scripts\python.exe"
set "URL=http://localhost:8501"

curl -s -o nul "%URL%/_stcore/health" && (
    echo 工作台已在執行，開啟瀏覽器 · Already running
    start "" "%URL%"
    exit /b 0
)

if not exist "%PY%" (
    echo [首次執行] 建立虛擬環境 · Creating virtual environment
    python -m venv .venv || goto :fail
)

"%PY%" -c "import streamlit, cv2, dietai" 2>nul || (
    echo [安裝] 安裝工作台所需套件，約需數分鐘 · Installing dependencies
    "%PY%" -m pip install -e ".[dev,vision,workbench]" || goto :fail
)

echo.
echo 工作台啟動中，瀏覽器會自動開啟 %URL%
echo Starting workbench. 關閉此視窗即可停止 · Close this window to stop.
echo.
"%PY%" -m streamlit run workbench\streamlit_app.py --server.headless false
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo [錯誤] 工作台啟動失敗 · Failed to start
echo 請確認已安裝 Python 3.11 以上，並把上方訊息提供給組員或 AI 工具。
pause
exit /b 1
