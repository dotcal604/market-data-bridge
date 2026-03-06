# Push advanced measures: Trade Index, Cumulative PnL, Drawdown, Rolling metrics
param([int]$Port = 14448)

$ErrorActionPreference = "Stop"
Import-Module SqlServer -ErrorAction Stop

$sqlModulePath = (Get-Module SqlServer).ModuleBase
$tomDll = Join-Path $sqlModulePath "Microsoft.AnalysisServices.Tabular.dll"
Add-Type -Path $tomDll
$coreDll = Join-Path $sqlModulePath "Microsoft.AnalysisServices.Core.dll"
if (Test-Path $coreDll) { Add-Type -Path $coreDll }

$server = New-Object Microsoft.AnalysisServices.Tabular.Server
$server.Connect("Data Source=localhost:$Port")
Write-Host "Connected to localhost:$Port"

$db = $server.Databases[0]
$model = $db.Model
$t = $model.Tables | Where-Object { $_.Name -eq "holly_analytics" }
$tn = $t.Name
Write-Host "Table: $tn ($($t.Columns.Count) cols, $($t.Measures.Count) measures)"

# ============================================================
# CALCULATED COLUMN: Trade Index (sequential numbering by entry_time)
# ============================================================

$columns = @(
    @{
        N = "Trade Index"
        E = "RANKX(ALL('$tn'), '$tn'[entry_time], , ASC, Dense)"
        T = "Int64"
    }
)

$addedCols = 0; $skippedCols = 0; $errorCols = 0

foreach ($c in $columns) {
    $existing = $t.Columns | Where-Object { $_.Name -eq $c.N }
    if ($existing) {
        Write-Host "  SKIP COL: $($c.N)"
        $skippedCols++
        continue
    }
    try {
        $col = New-Object Microsoft.AnalysisServices.Tabular.CalculatedColumn
        $col.Name = $c.N
        $col.Expression = $c.E
        $col.DataType = [Microsoft.AnalysisServices.Tabular.DataType]::$($c.T)
        $t.Columns.Add($col)
        Write-Host "  ADD COL: $($c.N)"
        $addedCols++
    }
    catch {
        Write-Host "  ERR COL: $($c.N) - $($_.Exception.Message)"
        $errorCols++
    }
}

# ============================================================
# ADVANCED MEASURES
# ============================================================

$measures = @(
    # Equity Curve
    @{
        N = "Cumulative PnL"
        E = "VAR CurrentTime = MAX('$tn'[entry_time]) RETURN CALCULATE(SUM('$tn'[holly_pnl]), FILTER(ALL('$tn'), '$tn'[entry_time] <= CurrentTime))"
        F = "`$#,0"
    }
    @{
        N = "Running Max PnL"
        E = "VAR CurrentIdx = MAX('$tn'[Trade Index]) RETURN MAXX(FILTER(ALL('$tn'), '$tn'[Trade Index] <= CurrentIdx), VAR TradeIdx = '$tn'[Trade Index] RETURN CALCULATE(SUM('$tn'[holly_pnl]), FILTER(ALL('$tn'), '$tn'[Trade Index] <= TradeIdx)))"
        F = "`$#,0"
    }
    @{
        N = "Drawdown"
        E = "[Cumulative PnL] - [Running Max PnL]"
        F = "`$#,0"
    }

    # Max Drawdown
    @{
        N = "Max Drawdown"
        E = "CALCULATE(MIN('$tn'[holly_pnl]), ALLSELECTED('$tn'))"
        F = "`$#,0"
    }

    # Rolling Metrics
    @{
        N = "Rolling 30 Win Rate"
        E = "VAR CurrentIndex = MAX('$tn'[Trade Index]) VAR WindowStart = CurrentIndex - 29 RETURN DIVIDE(CALCULATE(COUNTROWS(FILTER('$tn', '$tn'[holly_pnl] > 0)), FILTER(ALL('$tn'), '$tn'[Trade Index] >= WindowStart && '$tn'[Trade Index] <= CurrentIndex)), CALCULATE(COUNTROWS('$tn'), FILTER(ALL('$tn'), '$tn'[Trade Index] >= WindowStart && '$tn'[Trade Index] <= CurrentIndex)), BLANK())"
        F = "0.0%"
    }
    @{
        N = "Rolling 100 Profit Factor"
        E = "VAR CurrentIndex = MAX('$tn'[Trade Index]) VAR WindowStart = CurrentIndex - 99 VAR WindowProfit = CALCULATE(SUM('$tn'[holly_pnl]), FILTER(ALL('$tn'), '$tn'[Trade Index] >= WindowStart && '$tn'[Trade Index] <= CurrentIndex && '$tn'[holly_pnl] > 0)) VAR WindowLoss = CALCULATE(SUM('$tn'[holly_pnl]), FILTER(ALL('$tn'), '$tn'[Trade Index] >= WindowStart && '$tn'[Trade Index] <= CurrentIndex && '$tn'[holly_pnl] < 0)) RETURN DIVIDE(WindowProfit, ABS(WindowLoss), BLANK())"
        F = "#,0.00"
    }
    @{
        N = "Rolling 50 Avg PnL"
        E = "VAR CurrentIndex = MAX('$tn'[Trade Index]) VAR WindowStart = CurrentIndex - 49 RETURN CALCULATE(AVERAGE('$tn'[holly_pnl]), FILTER(ALL('$tn'), '$tn'[Trade Index] >= WindowStart && '$tn'[Trade Index] <= CurrentIndex))"
        F = "`$#,0.00"
    }

    # Regime PnL Improvement %
    @{
        N = "Regime PnL Improvement Pct"
        E = "VAR FilteredAvg = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[trend_regime] = ""uptrend"", '$tn'[vol_regime] = ""normal_vol"") VAR OverallAvg = CALCULATE(AVERAGE('$tn'[holly_pnl]), ALL('$tn')) RETURN DIVIDE(FilteredAvg - OverallAvg, ABS(OverallAvg), 0)"
        F = "0.0%"
    }

    # Optimization Comparison
    @{
        N = "Holly Default Avg PnL"
        E = "CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[Opt Exit Rule Clean] <> ""No Data"")"
        F = "`$#,0.00"
    }
    @{
        N = "Optimizer Avg PnL"
        E = "CALCULATE(AVERAGE('$tn'[opt_avg_pnl]), '$tn'[Opt Exit Rule Clean] <> ""No Data"")"
        F = "`$#,0.00"
    }
)

$addedM = 0; $skippedM = 0; $errorM = 0

foreach ($m in $measures) {
    $existing = $t.Measures | Where-Object { $_.Name -eq $m.N }
    if ($existing) {
        Write-Host "  SKIP MEAS: $($m.N)"
        $skippedM++
        continue
    }
    try {
        $measure = New-Object Microsoft.AnalysisServices.Tabular.Measure
        $measure.Name = $m.N
        $measure.Expression = $m.E
        if ($m.F -and $m.F -ne "") { $measure.FormatString = $m.F }
        $t.Measures.Add($measure)
        Write-Host "  ADD MEAS: $($m.N)"
        $addedM++
    }
    catch {
        Write-Host "  ERR MEAS: $($m.N) - $($_.Exception.Message)"
        $errorM++
    }
}

# ============================================================
# SAVE
# ============================================================

Write-Host "`nSaving: $addedCols columns, $addedM measures..."
try {
    $model.SaveChanges()
    Write-Host "SUCCESS!"
    Write-Host "  Columns: $addedCols added, $skippedCols skipped, $errorCols errors"
    Write-Host "  Measures: $addedM added, $skippedM skipped, $errorM errors"
    Write-Host "  Total in model: $($t.Columns.Count) columns, $($t.Measures.Count) measures"
}
catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) {
        Write-Host "Inner: $($_.Exception.InnerException.Message)"
    }
}

$server.Disconnect()
Write-Host "Done."
