# Package market-data-bridge for laptop deployment
# Run from repo root: powershell -ExecutionPolicy Bypass -File deploy/package.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path "$repoRoot\package.json")) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path "$repoRoot\package.json")) {
    $repoRoot = Get-Location
}

$outDir = "$repoRoot\deploy\market-data-bridge"
$zipPath = "$repoRoot\deploy\market-data-bridge.zip"

Write-Host "Repo root: $repoRoot"
Write-Host "Packaging to: $zipPath"

# Clean previous
if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

New-Item -ItemType Directory -Path $outDir | Out-Null

# Copy built backend
Write-Host "Copying build/..."
Copy-Item -Recurse "$repoRoot\build" "$outDir\build"

# Copy frontend static export
if (Test-Path "$repoRoot\frontend\out") {
    Write-Host "Copying frontend/out/..."
    New-Item -ItemType Directory -Path "$outDir\frontend" | Out-Null
    Copy-Item -Recurse "$repoRoot\frontend\out" "$outDir\frontend\out"
}

# Copy package files
Write-Host "Copying package files..."
Copy-Item "$repoRoot\package.json" "$outDir\"
Copy-Item "$repoRoot\package-lock.json" "$outDir\" -ErrorAction SilentlyContinue
Copy-Item "$repoRoot\.env.example" "$outDir\"

# Copy launcher scripts
Copy-Item "$repoRoot\deploy\launch.bat" "$outDir\"
Copy-Item "$repoRoot\deploy\launch-live.bat" "$outDir\"

# Install production deps inside the package
Write-Host "Installing production dependencies..."
Push-Location $outDir
$env:npm_config_loglevel = "error"
& npm install --omit=dev 2>&1 | Where-Object { $_ -notmatch "^npm warn" } | Out-Null
Pop-Location

# Create zip
Write-Host "Creating zip..."
Compress-Archive -Path "$outDir\*" -DestinationPath $zipPath -Force

$size = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Done! $zipPath ($size MB)"
Write-Host "Transfer to laptop, extract, double-click launch.bat"
