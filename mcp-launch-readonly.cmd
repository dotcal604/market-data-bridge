@echo off
cd /d "%~dp0"
node build/index.js --mode mcp-readonly %*
