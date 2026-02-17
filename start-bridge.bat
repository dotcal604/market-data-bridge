@echo off
echo Starting Market Data Bridge...

:: Start REST server from wherever this .bat lives
start "Market Data Bridge - REST" cmd /k "cd /d %~dp0 && node build/index.js --mode rest"

:: Wait for server to start
timeout /t 3 /nobreak >nul

echo.
echo Bridge started!
echo REST API: http://localhost:3000
echo Dashboard: http://localhost:3000
echo.
pause
