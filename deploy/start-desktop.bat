@echo off
title Market Data Bridge + Tunnel
cd /d "%~dp0\.."

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
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
    echo Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
)

:: Use pm2 if available (auto-restart on crash), fallback to plain node
set IBKR_PORT=7497
where pm2 >nul 2>&1
if %errorlevel% equ 0 (
    echo Starting Market Data Bridge via pm2 (auto-restart enabled)...
    echo Tunnel: https://api.klfh-dot-io.com
    pm2 start ecosystem.config.cjs
    echo.
    echo Bridge is running in background. Useful commands:
    echo   pm2 logs market-bridge   (tail logs)
    echo   pm2 status               (check status)
    echo   pm2 restart market-bridge (manual restart)
    echo   pm2 stop market-bridge    (stop)
    echo.
    pm2 status
    pause
) else (
    echo Starting Market Data Bridge on http://localhost:3000 ...
    echo Tunnel: https://api.klfh-dot-io.com
    echo [TIP] Install pm2 for auto-restart: npm i -g pm2
    node build/index.js
    pause
)
