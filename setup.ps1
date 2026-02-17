# ── Market Data Bridge — Laptop Setup Script ────────────────────────────
# Run in PowerShell: .\setup.ps1
# This checks prerequisites, clones the repo, installs deps, and creates .env

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/dotcal604/market-data-bridge.git"
$InstallDir = "$env:USERPROFILE\source\market-data-bridge"

Write-Host ""
Write-Host "=== Market Data Bridge Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check prerequisites ─────────────────────────────────────────

Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow

# Node.js
$nodeVersion = $null
try { $nodeVersion = (node -v 2>$null) } catch {}
if ($nodeVersion) {
    $major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($major -ge 18) {
        Write-Host "  Node.js $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "  Node.js $nodeVersion is too old. Need 18+." -ForegroundColor Red
        Write-Host "  Download: https://nodejs.org" -ForegroundColor Gray
        exit 1
    }
} else {
    Write-Host "  Node.js not found." -ForegroundColor Red
    Write-Host "  Download: https://nodejs.org (LTS recommended)" -ForegroundColor Gray
    Write-Host ""
    $install = Read-Host "  Install Node.js via winget? (y/n)"
    if ($install -eq 'y') {
        winget install OpenJS.NodeJS.LTS
        Write-Host "  Node.js installed. Restart PowerShell and run this script again." -ForegroundColor Yellow
        exit 0
    }
    exit 1
}

# Git
$gitVersion = $null
try { $gitVersion = (git --version 2>$null) } catch {}
if ($gitVersion) {
    Write-Host "  $gitVersion" -ForegroundColor Green
} else {
    Write-Host "  Git not found." -ForegroundColor Red
    Write-Host "  Download: https://git-scm.com/download/win" -ForegroundColor Gray
    Write-Host ""
    $install = Read-Host "  Install Git via winget? (y/n)"
    if ($install -eq 'y') {
        winget install Git.Git
        Write-Host "  Git installed. Restart PowerShell and run this script again." -ForegroundColor Yellow
        exit 0
    }
    exit 1
}

# npm
try {
    $npmVersion = (npm -v 2>$null)
    Write-Host "  npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "  npm not found (should come with Node.js)" -ForegroundColor Red
    exit 1
}

Write-Host ""

# ── Step 2: Clone or update repo ────────────────────────────────────────

Write-Host "[2/6] Setting up repository..." -ForegroundColor Yellow

if (Test-Path "$InstallDir\.git") {
    Write-Host "  Repo already exists at $InstallDir" -ForegroundColor Green
    Set-Location $InstallDir
    Write-Host "  Pulling latest..." -ForegroundColor Gray
    git pull origin main
} else {
    Write-Host "  Cloning to $InstallDir..." -ForegroundColor Gray
    # Ensure parent directory exists
    $parentDir = Split-Path $InstallDir -Parent
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
    git clone $RepoUrl $InstallDir
    Set-Location $InstallDir
}

Write-Host ""

# ── Step 3: Install dependencies ────────────────────────────────────────

Write-Host "[3/6] Installing backend dependencies..." -ForegroundColor Yellow
npm install
Write-Host ""

Write-Host "[4/6] Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location "$InstallDir\frontend"
npm install
Set-Location $InstallDir
Write-Host ""

# ── Step 4: Build TypeScript ────────────────────────────────────────────

Write-Host "[5/6] Building TypeScript..." -ForegroundColor Yellow
npm run build
Write-Host ""

# ── Step 5: Create .env if missing ──────────────────────────────────────

Write-Host "[6/6] Configuring environment..." -ForegroundColor Yellow

if (Test-Path "$InstallDir\.env") {
    Write-Host "  .env already exists — skipping" -ForegroundColor Green
} else {
    Copy-Item "$InstallDir\.env.example" "$InstallDir\.env"
    Write-Host "  Created .env from .env.example" -ForegroundColor Green
    Write-Host ""
    Write-Host "  You need to add your API keys to .env:" -ForegroundColor Yellow
    Write-Host "    notepad $InstallDir\.env" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Required keys for eval engine:" -ForegroundColor Gray
    Write-Host "    ANTHROPIC_API_KEY  — console.anthropic.com" -ForegroundColor Gray
    Write-Host "    OPENAI_API_KEY     — platform.openai.com" -ForegroundColor Gray
    Write-Host "    GOOGLE_AI_API_KEY  — aistudio.google.com" -ForegroundColor Gray
}

Write-Host ""

# ── Done ─────────────────────────────────────────────────────────────────

Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Start TWS or IB Gateway (paper: port 7497)" -ForegroundColor White
Write-Host "     - Edit > Global Config > API > Settings" -ForegroundColor Gray
Write-Host "     - Check 'Enable ActiveX and Socket Clients'" -ForegroundColor Gray
Write-Host "     - Check 'Allow connections from localhost only'" -ForegroundColor Gray
Write-Host "     - Socket port: 7497 (paper) or 7496 (live)" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Add API keys to .env (if using eval engine)" -ForegroundColor White
Write-Host "     notepad $InstallDir\.env" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. Start the bridge:" -ForegroundColor White
Write-Host "     cd $InstallDir" -ForegroundColor Gray
Write-Host "     npm run start:paper     # paper trading" -ForegroundColor Gray
Write-Host "     npm run dev:paper       # dev mode (hot reload + frontend)" -ForegroundColor Gray
Write-Host ""
Write-Host "  4. Open dashboard:" -ForegroundColor White
Write-Host "     http://localhost:3000" -ForegroundColor Gray
Write-Host ""
