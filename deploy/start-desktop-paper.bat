@echo off
title Market Data Bridge + Tunnel (PAPER)
cd /d "%~dp0\.."

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)

:: Use pm2 if available (auto-restart on crash), fallback to plain node
set IBKR_PORT=7497
set REST_PORT=3001
set IBKR_CLIENT_ID=10
set DB_PATH=data/bridge-paper.db
where pm2 >nul 2>&1
if %errorlevel% equ 0 (
    echo Starting Market Data Bridge (PAPER) via pm2 on port 3001...
    echo IBKR port: 7497 (paper TWS/Gateway)
    echo Database: data/bridge-paper.db
    pm2 start ecosystem.config.cjs --only market-bridge-paper
    echo.
    pm2 status
    pause
) else (
    echo Starting Market Data Bridge (PAPER) on http://localhost:3001 ...
    echo IBKR port: 7497 (paper TWS/Gateway)
    echo [TIP] Install pm2 for auto-restart: npm i -g pm2
    node build/index.js
    pause
)
