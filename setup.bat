@echo off
title Market Data Bridge — Setup
cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║       Market Data Bridge — First-Time Setup      ║
echo   ╚══════════════════════════════════════════════════╝
echo.

:: ── 1. Node.js ───────────────────────────────────────────────────────
echo [1/7] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo        [MISSING] Node.js not found.
    echo        Opening download page...
    start https://nodejs.org/
    echo        Install Node.js 22+, then re-run this script.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo        [OK] Node.js %NODE_VER%

:: ── 2. Backend dependencies ──────────────────────────────────────────
echo [2/7] Backend dependencies...
if exist "node_modules" (
    echo        [OK] node_modules exists
) else (
    echo        Installing...
    call npm install
    if %errorlevel% neq 0 (
        echo        [ERROR] npm install failed
        pause
        exit /b 1
    )
    echo        [OK] Installed
)

:: ── 3. Frontend dependencies ─────────────────────────────────────────
echo [3/7] Frontend dependencies...
if exist "frontend\node_modules" (
    echo        [OK] frontend/node_modules exists
) else (
    echo        Installing...
    pushd frontend
    call npm install
    popd
    if %errorlevel% neq 0 (
        echo        [ERROR] frontend npm install failed
        pause
        exit /b 1
    )
    echo        [OK] Installed
)

:: ── 4. Environment file ──────────────────────────────────────────────
echo [4/7] Environment file...
if exist ".env" (
    echo        [OK] .env exists
) else (
    copy .env.example .env >nul
    echo        [CREATED] .env from template
    echo.
    echo        ════════════════════════════════════════════
    echo         Edit your .env now. At minimum:
    echo           - IBKR_PORT (7497 paper / 7496 live)
    echo           - API keys if you want the eval engine
    echo         Save and close Notepad to continue.
    echo        ════════════════════════════════════════════
    echo.
    notepad .env
)

:: ── 5. TypeScript build ──────────────────────────────────────────────
echo [5/7] Building TypeScript...
call npm run build
if %errorlevel% neq 0 (
    echo        [ERROR] Build failed
    pause
    exit /b 1
)
echo        [OK] build/ directory ready

:: ── 6. Data directory ────────────────────────────────────────────────
echo [6/7] Data directory...
if not exist "data" mkdir data
if exist "data\weights.json" (
    echo        [OK] data/ exists with weights.json
) else (
    echo        [OK] data/ created (weights.json will be generated on first run)
)

:: ── 7. Verify ────────────────────────────────────────────────────────
echo [7/7] Verification...
node -e "require('./build/config.js')" >nul 2>&1
if %errorlevel% equ 0 (
    echo        [OK] Config loads successfully
) else (
    echo        [WARN] Config check skipped (may need .env edits)
)

:: ── Done ─────────────────────────────────────────────────────────────
echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║              Setup complete!                     ║
echo   ╠══════════════════════════════════════════════════╣
echo   ║  To start:                                      ║
echo   ║    Paper trading:  double-click start.bat        ║
echo   ║    Live trading:   double-click start-live.bat   ║
echo   ║                                                  ║
echo   ║  Optional:                                       ║
echo   ║    Start TWS/Gateway for IBKR real-time data     ║
echo   ║    Without TWS, quotes fall back to Yahoo        ║
echo   ╚══════════════════════════════════════════════════╝
echo.
pause
