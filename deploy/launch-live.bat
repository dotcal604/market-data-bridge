@echo off
title Market Data Bridge (LIVE)
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install --omit=dev
)

if not exist ".env" (
    copy .env.example .env
    echo Edit .env with your API keys first!
    notepad .env
    pause
)

echo Starting Market Data Bridge (LIVE) on http://localhost:3000 ...
set IBKR_PORT=7496
node build/index.js
pause
