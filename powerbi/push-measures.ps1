# Push DAX measures to Power BI Desktop's local SSAS instance
# Uses SqlServer module (Microsoft.AnalysisServices.Tabular)

param(
    [int]$Port = 14448
)

$ErrorActionPreference = "Stop"

# Import SqlServer module which includes AMO/TOM
Import-Module SqlServer -ErrorAction Stop
Write-Host "SqlServer module loaded."

# Load the TOM assembly from the SqlServer module
$sqlModulePath = (Get-Module SqlServer).ModuleBase
$tomDll = Join-Path $sqlModulePath "Microsoft.AnalysisServices.Tabular.dll"

if (-not (Test-Path $tomDll)) {
    # Try alternate location
    $tomDll = Get-ChildItem $sqlModulePath -Recurse -Filter "Microsoft.AnalysisServices.Tabular.dll" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1
}

if (-not $tomDll) {
    Write-Error "Could not find TOM assembly in SqlServer module at $sqlModulePath"
    exit 1
}

Write-Host "TOM assembly: $tomDll"
Add-Type -Path $tomDll

# Also load core
$coreDir = Split-Path $tomDll
$coreDll = Join-Path $coreDir "Microsoft.AnalysisServices.Core.dll"
if (Test-Path $coreDll) { Add-Type -Path $coreDll }

# Connect to the local SSAS instance
$connStr = "Data Source=localhost:$Port"
Write-Host "Connecting to localhost:$Port..."

$server = New-Object Microsoft.AnalysisServices.Tabular.Server
$server.Connect($connStr)

Write-Host "Connected! Server version: $($server.Version)"
Write-Host "Databases: $($server.Databases.Count)"

foreach ($db in $server.Databases) {
    Write-Host "  Database: $($db.Name) (CompatLevel: $($db.CompatibilityLevel))"
    $model = $db.Model
    Write-Host "  Tables: $($model.Tables.Count)"
    foreach ($t in $model.Tables) {
        Write-Host "    Table: $($t.Name) (Measures: $($t.Measures.Count), Columns: $($t.Columns.Count))"
    }
}

if ($server.Databases.Count -eq 0) {
    Write-Host "`nNo databases found. Please load holly_analytics.xlsx in PBI Desktop first."
    $server.Disconnect()
    exit 0
}

$db = $server.Databases[0]
$model = $db.Model

# Find the main data table
$dataTable = $null
foreach ($t in $model.Tables) {
    if ($t.Name -like "*holly*" -or $t.Name -like "*analytics*" -or $t.Name -like "*Sheet*") {
        $dataTable = $t
        break
    }
}
if (-not $dataTable) {
    foreach ($t in $model.Tables) {
        if ($t.Columns.Count -gt 5) { $dataTable = $t; break }
    }
}
if (-not $dataTable) {
    Write-Host "No suitable data table found. Tables:"
    foreach ($t in $model.Tables) { Write-Host "  - $($t.Name) ($($t.Columns.Count) cols)" }
    $server.Disconnect()
    exit 0
}

$tn = $dataTable.Name
Write-Host "`nTarget table: $tn"
Write-Host "Adding measures..."

# ============================================================
# ALL DAX MEASURES
# ============================================================

$measures = @(
    # Core KPIs
    @{ N = "Total Trades"; E = "COUNTROWS('$tn')"; F = "#,0" }
    @{ N = "Win Count"; E = "COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] > 0))"; F = "#,0" }
    @{ N = "Loss Count"; E = "COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] < 0))"; F = "#,0" }
    @{ N = "Scratch Count"; E = "COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] = 0))"; F = "#,0" }
    @{ N = "Win Rate"; E = "DIVIDE(COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] > 0)), COUNTROWS('$tn'), 0)"; F = "0.0%" }
    @{ N = "Loss Rate"; E = "DIVIDE(COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] < 0)), COUNTROWS('$tn'), 0)"; F = "0.0%" }
    @{ N = "Total PnL"; E = "SUM('$tn'[holly_pnl])"; F = "`$#,0" }
    @{ N = "Avg PnL"; E = "AVERAGE('$tn'[holly_pnl])"; F = "`$#,0.00" }
    @{ N = "Gross Profit"; E = "CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[holly_pnl] > 0)"; F = "`$#,0" }
    @{ N = "Gross Loss"; E = "CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[holly_pnl] < 0)"; F = "`$#,0" }
    @{ N = "Profit Factor"; E = "DIVIDE(CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[holly_pnl] > 0), ABS(CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[holly_pnl] < 0)), 0)"; F = "#,0.00" }
    @{ N = "Avg Winner"; E = "CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[holly_pnl] > 0)"; F = "`$#,0.00" }
    @{ N = "Avg Loser"; E = "CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[holly_pnl] < 0)"; F = "`$#,0.00" }
    @{ N = "Win Loss Ratio"; E = "DIVIDE(CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[holly_pnl] > 0), ABS(CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[holly_pnl] < 0)), 0)"; F = "#,0.00" }
    @{ N = "Avg R-Multiple"; E = "AVERAGE('$tn'[r_multiple])"; F = "#,0.00" }
    @{ N = "Median R-Multiple"; E = "MEDIAN('$tn'[r_multiple])"; F = "#,0.00" }
    @{ N = "Avg Hold Minutes"; E = "AVERAGE('$tn'[hold_minutes])"; F = "#,0" }
    @{ N = "Unique Symbols"; E = "DISTINCTCOUNT('$tn'[symbol])"; F = "#,0" }
    @{ N = "Expectancy"; E = "VAR WR = DIVIDE(COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] > 0)), COUNTROWS('$tn'), 0) VAR LR = DIVIDE(COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] < 0)), COUNTROWS('$tn'), 0) VAR AW = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[holly_pnl] > 0) VAR AL = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[holly_pnl] < 0) RETURN (WR * AW) + (LR * AL)"; F = "`$#,0.00" }

    # Risk Metrics
    @{ N = "Avg MFE"; E = "AVERAGE('$tn'[mfe])"; F = "`$#,0.00" }
    @{ N = "Avg MAE"; E = "AVERAGE('$tn'[mae])"; F = "`$#,0.00" }
    @{ N = "Avg Stop Buffer Pct"; E = "AVERAGE('$tn'[stop_buffer_pct])"; F = "0.00%" }
    @{ N = "Max Single Trade Loss"; E = "CALCULATE(MIN('$tn'[holly_pnl]), ALL('$tn'))"; F = "`$#,0" }
    @{ N = "Max Single Trade Win"; E = "CALCULATE(MAX('$tn'[holly_pnl]), ALL('$tn'))"; F = "`$#,0" }

    # Regime Measures
    @{ N = "PnL Uptrend NormalVol"; E = "CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[trend_regime] = ""uptrend"", '$tn'[vol_regime] = ""normal_vol"")"; F = "`$#,0" }
    @{ N = "Trades Uptrend NormalVol"; E = "CALCULATE(COUNTROWS('$tn'), '$tn'[trend_regime] = ""uptrend"", '$tn'[vol_regime] = ""normal_vol"")"; F = "#,0" }
    @{ N = "Win Rate Uptrend NormalVol"; E = "VAR Total = CALCULATE(COUNTROWS('$tn'), '$tn'[trend_regime] = ""uptrend"", '$tn'[vol_regime] = ""normal_vol"") VAR Wins = CALCULATE(COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] > 0)), '$tn'[trend_regime] = ""uptrend"", '$tn'[vol_regime] = ""normal_vol"") RETURN DIVIDE(Wins, Total, 0)"; F = "0.0%" }
    @{ N = "Avg PnL Uptrend NormalVol"; E = "CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[trend_regime] = ""uptrend"", '$tn'[vol_regime] = ""normal_vol"")"; F = "`$#,0.00" }

    # Concentration
    @{ N = "Monthly Unique Symbols"; E = "DISTINCTCOUNT('$tn'[symbol])"; F = "#,0" }
)

$added = 0; $skipped = 0; $errors = 0

foreach ($m in $measures) {
    $name = $m.N
    $existing = $dataTable.Measures | Where-Object { $_.Name -eq $name }
    if ($existing) {
        Write-Host "  SKIP: $name"
        $skipped++
        continue
    }
    try {
        $measure = New-Object Microsoft.AnalysisServices.Tabular.Measure
        $measure.Name = $name
        $measure.Expression = $m.E
        if ($m.F) { $measure.FormatString = $m.F }
        $dataTable.Measures.Add($measure)
        Write-Host "  ADD: $name"
        $added++
    }
    catch {
        Write-Host "  ERR: $name - $($_.Exception.Message)"
        $errors++
    }
}

Write-Host "`nSaving $added measures..."
try {
    $model.SaveChanges()
    Write-Host "SUCCESS! $added added, $skipped skipped, $errors errors."
}
catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) {
        Write-Host "Inner: $($_.Exception.InnerException.Message)"
    }
}

$server.Disconnect()
Write-Host "Done."
