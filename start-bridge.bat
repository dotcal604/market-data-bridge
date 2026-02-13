@echo off
echo Starting Market Data Bridge...

:: Start REST server
start "Market Data Bridge - REST" cmd /k "cd /d C:\Users\dotca\Downloads\Trading\Claude Code - Market API && node build/index.js --mode rest"

:: Wait for server to start
timeout /t 3 /nobreak >nul

:: Start Cloudflare named tunnel (permanent URL: api.klfh-dot-io.com)
start "Market Data Bridge - Tunnel" cmd /k "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run market-bridge

echo.
echo Bridge started!
echo REST API: http://localhost:3000
echo Public URL: https://api.klfh-dot-io.com
echo.
pause
