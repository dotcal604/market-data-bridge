@echo off
title Market Data Bridge
cd /d "%~dp0"

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

:: Install deps if needed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install --omit=dev
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

:: Create .env from template if missing
if not exist ".env" (
    echo Creating .env from template...
    copy .env.example .env
    echo.
    echo ============================================
    echo  Edit .env with your API keys before use!
    echo  At minimum set IBKR_PORT for paper/live.
    echo ============================================
    echo.
    notepad .env
    pause
)

:: Start the bridge (paper mode by default)
echo Starting Market Data Bridge on http://localhost:3000 ...
set IBKR_PORT=7497
node build/index.js
pause
