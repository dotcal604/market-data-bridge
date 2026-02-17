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

:: Use pm2 if available (auto-restart on crash), fallback to plain node
set IBKR_PORT=7496
where pm2 >nul 2>&1
if %errorlevel% equ 0 (
    echo Starting Market Data Bridge (LIVE) via pm2 (auto-restart enabled)...
    echo Tunnel: https://api.klfh-dot-io.com
    pm2 start ecosystem.config.cjs --env IBKR_PORT=7496
    echo.
    pm2 status
    pause
) else (
    echo Starting Market Data Bridge (LIVE) on http://localhost:3000 ...
    echo Tunnel: https://api.klfh-dot-io.com
    echo [TIP] Install pm2 for auto-restart: npm i -g pm2
    node build/index.js
    pause
)
