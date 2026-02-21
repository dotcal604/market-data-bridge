@echo off
title Market Data Bridge — Starting...
cd /d "%~dp0"

:: ── Preflight ────────────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

:: ── Dependencies ─────────────────────────────────────────────────────
if not exist "node_modules" (
    echo Installing backend dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    pushd frontend
    call npm install
    popd
    if %errorlevel% neq 0 (
        echo [ERROR] frontend npm install failed
        pause
        exit /b 1
    )
)

:: ── Environment ──────────────────────────────────────────────────────
if not exist ".env" (
    echo Creating .env from template...
    copy .env.example .env >nul
    echo.
    echo ========================================================
    echo   First-time setup: .env created from template.
    echo   Edit API keys (IBKR, Anthropic, OpenAI, Google) now.
    echo   Save and close Notepad to continue.
    echo ========================================================
    echo.
    notepad .env
)

:: ── Build ────────────────────────────────────────────────────────────
if not exist "build" (
    echo Building TypeScript...
    call npm run build
    if %errorlevel% neq 0 (
        echo [ERROR] TypeScript build failed
        pause
        exit /b 1
    )
)

:: ── Launch ───────────────────────────────────────────────────────────
title Market Data Bridge — Paper Trading
cls

echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║         Market Data Bridge  v3.0.0              ║
echo   ║         Paper Trading (port 7497)               ║
echo   ╠══════════════════════════════════════════════════╣
echo   ║  API:        http://localhost:3000               ║
echo   ║  Dashboard:  http://localhost:3001               ║
echo   ║  Health:     http://localhost:3000/api/status    ║
echo   ╠══════════════════════════════════════════════════╣
echo   ║  Close this window to stop the backend.         ║
echo   ╚══════════════════════════════════════════════════╝
echo.

:: Start frontend in a separate window
start "Market Data Bridge — Dashboard" cmd /k "cd /d "%~dp0\frontend" && npm run dev -- -p 3001"

:: Open dashboard in browser after a short delay
start /b cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:3001"

:: Start backend in this window (blocking — Ctrl+C to stop)
set IBKR_PORT=7497
node build/index.js
