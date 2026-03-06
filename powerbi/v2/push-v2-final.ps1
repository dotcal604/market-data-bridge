# Push final batch of v2 measures — display, dynamic titles, what-if
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
# REMAINING MEASURES (that don't need Date_Table)
# ============================================================

$measures = @(
    # Advanced Performance — remaining
    @{ N = "Expectancy"; E = "VAR _wr = [Win Rate] VAR _lr = [Loss Rate] VAR _avgW = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[is_winner] = TRUE()) VAR _avgL = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[is_loser] = TRUE()) RETURN IF([Total Trades] > 0, (_wr * _avgW) + (_lr * _avgL), BLANK())"; F = "`$#,0.00" }

    # What-If measures (these compute inline, no What-If table needed)
    @{ N = "Filtered Total Trades"; E = "CALCULATE(COUNTROWS('$tn'), '$tn'[stop_buffer_pct] >= 0.35)"; F = "#,0" }
    @{ N = "Filtered Win Rate 035"; E = "VAR _filtered = FILTER('$tn', '$tn'[stop_buffer_pct] >= 0.35) VAR _wins = COUNTROWS(FILTER(_filtered, '$tn'[is_winner] = TRUE())) VAR _total = COUNTROWS(_filtered) RETURN DIVIDE(_wins, _total)"; F = "0.0%" }
    @{ N = "Filtered Avg PnL 035"; E = "CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[stop_buffer_pct] >= 0.35)"; F = "`$#,0.00" }
    @{ N = "Filtered PF 035"; E = "VAR _winPnL = CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[is_winner] = TRUE(), '$tn'[stop_buffer_pct] >= 0.35) VAR _losePnL = CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[is_loser] = TRUE(), '$tn'[stop_buffer_pct] >= 0.35) RETURN IF(ABS(_losePnL) > 0, DIVIDE(_winPnL, ABS(_losePnL)), BLANK())"; F = "#,0.00" }

    # Strategy concentration
    @{ N = "Top 5 Strategy PnL Pct"; E = "VAR _top5 = TOPN(5, ADDCOLUMNS(VALUES('$tn'[strategy]), ""@PnL"", CALCULATE(SUM('$tn'[holly_pnl]))), [@PnL], DESC) VAR _top5Total = SUMX(_top5, [@PnL]) VAR _grandTotal = CALCULATE(SUM('$tn'[holly_pnl]), ALL('$tn')) RETURN DIVIDE(_top5Total, _grandTotal, 0)"; F = "0.0%" }

    # Avg PnL per direction
    @{ N = "Avg PnL Long"; E = "CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[direction] = ""Long"")"; F = "`$#,0.00" }
    @{ N = "Avg PnL Short"; E = "CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[direction] = ""Short"")"; F = "`$#,0.00" }
    @{ N = "Win Rate Long"; E = "CALCULATE([Win Rate], '$tn'[direction] = ""Long"")"; F = "0.0%" }
    @{ N = "Win Rate Short"; E = "CALCULATE([Win Rate], '$tn'[direction] = ""Short"")"; F = "0.0%" }

    # Strategy Scorecard title (dynamic)
    @{ N = "Strategy Scorecard Title"; E = "VAR _count = DISTINCTCOUNT('$tn'[strategy]) RETURN FORMAT(_count, ""#,0"") & "" Strategies Analyzed | "" & FORMAT([Total Trades], ""#,0"") & "" Total Trades"""; F = "" }
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

Write-Host "`nSaving $addedM measures..."
try {
    $model.SaveChanges()
    Write-Host "SUCCESS! $addedM added, $skippedM skipped, $errorM errors."
    Write-Host "Total in model: $($t.Columns.Count) columns, $($t.Measures.Count) measures"
}
catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) {
        Write-Host "Inner: $($_.Exception.InnerException.Message)"
    }
}

$server.Disconnect()
Write-Host "Done."
