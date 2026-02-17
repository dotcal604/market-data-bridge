@echo off
title Market Data Bridge + Tunnel (LIVE)
cd /d "%~dp0\.."

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)

:: Start Cloudflare tunnel in background
where cloudflared >nul 2>&1
if %errorlevel% equ 0 (
    echo Starting Cloudflare tunnel (api.klfh-dot-io.com)...
    start /b cloudflared tunnel run >nul 2>&1
) else (
    echo [WARN] cloudflared not found - tunnel won't start
)

echo Starting Market Data Bridge (LIVE) on http://localhost:3000 ...
echo Tunnel: https://api.klfh-dot-io.com
set IBKR_PORT=7496
node build/index.js
pause
