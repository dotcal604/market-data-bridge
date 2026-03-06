# Push v2 DAX measures to PBI Desktop — enterprise upgrade
# Adds ~40 new measures on top of existing 54
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
# NEW CALCULATED COLUMNS (v2 additions)
# ============================================================

$columns = @(
    @{
        N = "Trade_Outcome"
        E = "IF('$tn'[is_winner], ""Winner"", IF('$tn'[is_loser], ""Loser"", ""Breakeven""))"
        T = "String"
    }
    @{
        N = "PnL_Bucket"
        E = "IF(ISBLANK('$tn'[holly_pnl]), ""No Data"", IF('$tn'[holly_pnl] < -500, ""<-`$500"", IF('$tn'[holly_pnl] < -100, ""-`$500 to -`$100"", IF('$tn'[holly_pnl] < 0, ""-`$100 to `$0"", IF('$tn'[holly_pnl] = 0, ""`$0 (Breakeven)"", IF('$tn'[holly_pnl] <= 100, ""`$0 to `$100"", IF('$tn'[holly_pnl] <= 500, ""`$100 to `$500"", IF('$tn'[holly_pnl] <= 2000, ""`$500 to `$2K"", IF('$tn'[holly_pnl] <= 10000, ""`$2K to `$10K"", "">`$10K"")))))))))"
        T = "String"
    }
    @{
        N = "PnL_Bucket_Sort"
        E = "IF(ISBLANK('$tn'[holly_pnl]), 99, IF('$tn'[holly_pnl] < -500, 1, IF('$tn'[holly_pnl] < -100, 2, IF('$tn'[holly_pnl] < 0, 3, IF('$tn'[holly_pnl] = 0, 4, IF('$tn'[holly_pnl] <= 100, 5, IF('$tn'[holly_pnl] <= 500, 6, IF('$tn'[holly_pnl] <= 2000, 7, IF('$tn'[holly_pnl] <= 10000, 8, 9)))))))))"
        T = "Int64"
    }
    @{
        N = "R_Multiple_Bucket"
        E = "IF(ISBLANK('$tn'[r_multiple]), ""No Data"", IF('$tn'[r_multiple] < -1, ""<-1R"", IF('$tn'[r_multiple] < 0, ""-1R to 0R"", IF('$tn'[r_multiple] <= 1, ""0R to 1R"", IF('$tn'[r_multiple] <= 5, ""1R to 5R"", IF('$tn'[r_multiple] <= 20, ""5R to 20R"", "">20R""))))))"
        T = "String"
    }
    @{
        N = "R_Multiple_Bucket_Sort"
        E = "IF(ISBLANK('$tn'[r_multiple]), 99, IF('$tn'[r_multiple] < -1, 1, IF('$tn'[r_multiple] < 0, 2, IF('$tn'[r_multiple] <= 1, 3, IF('$tn'[r_multiple] <= 5, 4, IF('$tn'[r_multiple] <= 20, 5, 6))))))"
        T = "Int64"
    }
    @{
        N = "Edge_Capture_Pct"
        E = "IF('$tn'[is_winner] && NOT(ISBLANK('$tn'[mfe])) && '$tn'[mfe] > 0 && NOT(ISBLANK('$tn'[pnl_per_share])), ('$tn'[pnl_per_share] / '$tn'[mfe]) * 100, BLANK())"
        T = "Double"
    }
    @{
        N = "Winner_MAE"
        E = "IF('$tn'[is_winner] && NOT(ISBLANK('$tn'[mae])), '$tn'[mae], BLANK())"
        T = "Double"
    }
    @{
        N = "Regime_Combo"
        E = "IF('$tn'[has_regime_data], '$tn'[trend_regime] & "" | "" & '$tn'[vol_regime] & "" | "" & '$tn'[momentum_regime], ""No Regime Data"")"
        T = "String"
    }
    @{
        N = "Has_Regime_Flag"
        E = "IF('$tn'[has_regime_data], ""With Regime Data"", ""No Regime Data"")"
        T = "String"
    }
    @{
        N = "Has_Exit_Rule_Flag"
        E = "IF('$tn'[Opt Exit Rule Clean] <> ""No Data"", ""With Exit Rule"", ""No Exit Rule"")"
        T = "String"
    }
    @{
        N = "Entry_Hour_Label"
        E = "FORMAT('$tn'[entry_hour], ""0"") & "":00 ET"""
        T = "String"
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
# NEW MEASURES (v2 additions — skip if already exists)
# ============================================================

$measures = @(
    # Core Performance (new)
    @{ N = "Winners"; E = "CALCULATE(COUNTROWS('$tn'), '$tn'[is_winner] = TRUE())"; F = "#,0" }
    @{ N = "Losers"; E = "CALCULATE(COUNTROWS('$tn'), '$tn'[is_loser] = TRUE())"; F = "#,0" }
    @{ N = "Breakeven Trades"; E = "[Total Trades] - [Winners] - [Losers]"; F = "#,0" }
    @{ N = "Median PnL"; E = "MEDIAN('$tn'[holly_pnl])"; F = "`$#,0.00" }
    @{ N = "Total Winner PnL"; E = "CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[is_winner] = TRUE())"; F = "`$#,0" }
    @{ N = "Total Loser PnL"; E = "CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[is_loser] = TRUE())"; F = "`$#,0" }
    @{ N = "Best Trade"; E = "MAX('$tn'[holly_pnl])"; F = "`$#,0" }
    @{ N = "Worst Trade"; E = "MIN('$tn'[holly_pnl])"; F = "`$#,0" }
    @{ N = "Median R Multiple"; E = "MEDIAN('$tn'[r_multiple])"; F = "#,0.00" }

    # Advanced Performance
    @{ N = "Sortino Ratio"; E = "VAR _dailyPnL = ADDCOLUMNS(SUMMARIZE('$tn', '$tn'[trade_date]), ""@DayPnL"", CALCULATE(SUM('$tn'[holly_pnl]))) VAR _mean = AVERAGEX(_dailyPnL, [@DayPnL]) VAR _downsideDev = SQRT(DIVIDE(SUMX(_dailyPnL, IF([@DayPnL] < 0, [@DayPnL] ^ 2, 0)), COUNTROWS(FILTER(_dailyPnL, [@DayPnL] < 0)))) RETURN IF(_downsideDev > 0, DIVIDE(_mean, _downsideDev) * SQRT(252), BLANK())"; F = "#,0.00" }
    @{ N = "Edge Score"; E = "VAR _wr = [Win Rate] VAR _avgW = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[is_winner] = TRUE()) VAR _avgL = ABS(CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[is_loser] = TRUE())) RETURN IF(_avgL > 0, _wr * DIVIDE(_avgW, _avgL), BLANK())"; F = "#,0.00" }
    @{ N = "Calmar Ratio"; E = "VAR _maxDD = [Max Drawdown] RETURN IF(_maxDD < 0, DIVIDE([Total PnL], ABS(_maxDD)), BLANK())"; F = "#,0.00" }
    @{ N = "Consistency Score"; E = "VAR _monthlyPnL = ADDCOLUMNS(SUMMARIZE('$tn', '$tn'[trade_year], '$tn'[trade_month]), ""@MonthPnL"", CALCULATE(SUM('$tn'[holly_pnl]))) VAR _profitableMonths = COUNTROWS(FILTER(_monthlyPnL, [@MonthPnL] > 0)) VAR _totalMonths = COUNTROWS(_monthlyPnL) RETURN IF(_totalMonths > 0, DIVIDE(_profitableMonths, _totalMonths), BLANK())"; F = "0.0%" }
    @{ N = "Profitable Days Pct"; E = "VAR _dailyPnL = ADDCOLUMNS(SUMMARIZE('$tn', '$tn'[trade_date]), ""@DayPnL"", CALCULATE(SUM('$tn'[holly_pnl]))) VAR _profDays = COUNTROWS(FILTER(_dailyPnL, [@DayPnL] > 0)) VAR _totalDays = COUNTROWS(_dailyPnL) RETURN IF(_totalDays > 0, DIVIDE(_profDays, _totalDays), BLANK())"; F = "0.0%" }
    @{ N = "Avg Trades Per Day"; E = "VAR _tradingDays = DISTINCTCOUNT('$tn'[trade_date]) RETURN IF(_tradingDays > 0, DIVIDE([Total Trades], _tradingDays), BLANK())"; F = "#,0.0" }

    # Cumulative & Running (new)
    @{ N = "Running Win Rate"; E = "VAR _maxDate = MAX('$tn'[trade_date]) VAR _wins = CALCULATE(COUNTROWS(FILTER('$tn', '$tn'[is_winner] = TRUE())), FILTER(ALLSELECTED('$tn'[trade_date]), '$tn'[trade_date] <= _maxDate)) VAR _total = CALCULATE(COUNTROWS('$tn'), FILTER(ALLSELECTED('$tn'[trade_date]), '$tn'[trade_date] <= _maxDate)) RETURN DIVIDE(_wins, _total)"; F = "0.0%" }
    @{ N = "Running Profit Factor"; E = "VAR _maxDate = MAX('$tn'[trade_date]) VAR _winPnL = CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[is_winner] = TRUE(), FILTER(ALLSELECTED('$tn'[trade_date]), '$tn'[trade_date] <= _maxDate)) VAR _losePnL = CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[is_loser] = TRUE(), FILTER(ALLSELECTED('$tn'[trade_date]), '$tn'[trade_date] <= _maxDate)) RETURN IF(ABS(_losePnL) > 0, DIVIDE(_winPnL, ABS(_losePnL)), BLANK())"; F = "#,0.00" }
    @{ N = "Max Drawdown Amount"; E = "CALCULATE(MIN('$tn'[holly_pnl]), ALLSELECTED('$tn'))"; F = "`$#,0" }

    # MFE / MAE (new)
    @{ N = "Avg Edge Capture Pct"; E = "CALCULATE(AVERAGE('$tn'[Edge_Capture_Pct]), '$tn'[is_winner] = TRUE())"; F = "0.0%" }
    @{ N = "Avg Winner MAE"; E = "CALCULATE(AVERAGE('$tn'[mae]), '$tn'[is_winner] = TRUE())"; F = "`$#,0.00" }
    @{ N = "MFE Captured Ratio"; E = "VAR _totalMFE = CALCULATE(SUM('$tn'[mfe]), '$tn'[is_winner] = TRUE()) VAR _totalPnL = CALCULATE(SUM('$tn'[pnl_per_share]), '$tn'[is_winner] = TRUE()) RETURN IF(_totalMFE > 0, DIVIDE(_totalPnL, _totalMFE), BLANK())"; F = "0.0%" }
    @{ N = "Max Single Trade Win"; E = "CALCULATE(MAX('$tn'[holly_pnl]), ALL('$tn'))"; F = "`$#,0" }
    @{ N = "Max Single Trade Loss"; E = "CALCULATE(MIN('$tn'[holly_pnl]), ALL('$tn'))"; F = "`$#,0" }

    # Regime (new)
    @{ N = "Regime Trades"; E = "CALCULATE([Total Trades], '$tn'[Has_Regime_Flag] = ""With Regime Data"")"; F = "#,0" }
    @{ N = "Regime Win Rate"; E = "CALCULATE([Win Rate], '$tn'[Has_Regime_Flag] = ""With Regime Data"")"; F = "0.0%" }
    @{ N = "Regime PnL"; E = "CALCULATE([Total PnL], '$tn'[Has_Regime_Flag] = ""With Regime Data"")"; F = "`$#,0" }
    @{ N = "Regime Coverage Pct"; E = "DIVIDE(CALCULATE([Total Trades], '$tn'[Has_Regime_Flag] = ""With Regime Data""), [Total Trades])"; F = "0.0%" }

    # Exit Rule (new)
    @{ N = "Exit Rule Trades"; E = "CALCULATE([Total Trades], '$tn'[Has_Exit_Rule_Flag] = ""With Exit Rule"")"; F = "#,0" }
    @{ N = "Avg Opt Sharpe"; E = "AVERAGE('$tn'[opt_sharpe])"; F = "#,0.00" }
    @{ N = "Avg Opt Win Rate"; E = "AVERAGE('$tn'[opt_win_rate])"; F = "0.0%" }
    @{ N = "Avg Opt Profit Factor"; E = "AVERAGE('$tn'[opt_profit_factor])"; F = "#,0.00" }
    @{ N = "Avg Opt Max Drawdown"; E = "AVERAGE('$tn'[opt_max_drawdown])"; F = "`$#,0" }
    @{ N = "Avg Opt PnL"; E = "AVERAGE('$tn'[opt_avg_pnl])"; F = "`$#,0.00" }
    @{ N = "Exit Rule Improvement"; E = "CALCULATE(AVERAGE('$tn'[opt_avg_pnl]), '$tn'[Has_Exit_Rule_Flag] = ""With Exit Rule"") - CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[Has_Exit_Rule_Flag] = ""With Exit Rule"")"; F = "`$#,0.00" }

    # Conditional Formatting (new)
    @{ N = "Sharpe Color"; E = "IF([Sharpe Proxy] >= 2.0, ""#00D4AA"", IF([Sharpe Proxy] >= 1.0, ""#FFD700"", ""#FF4444""))"; F = "" }
    @{ N = "Edge Score Color"; E = "IF([Edge Score] >= 1.5, ""#00D4AA"", IF([Edge Score] >= 1.0, ""#FFD700"", ""#FF4444""))"; F = "" }
    @{ N = "Consistency Color"; E = "IF([Consistency Score] >= 0.60, ""#00D4AA"", IF([Consistency Score] >= 0.45, ""#FFD700"", ""#FF4444""))"; F = "" }

    # Display Formatting (new)
    @{ N = "Sharpe Display"; E = "FORMAT([Sharpe Proxy], ""#,0.00"")"; F = "" }
    @{ N = "Edge Score Display"; E = "FORMAT([Edge Score], ""#,0.00"")"; F = "" }
    @{ N = "Consistency Display"; E = "FORMAT([Consistency Score], ""0.0%"")"; F = "" }

    # Dynamic Titles
    @{ N = "Equity Curve Title"; E = """Cumulative P&L: "" & FORMAT([Total PnL], ""`$#,0"") & "" | Max DD: "" & FORMAT(CALCULATE(MIN('$tn'[holly_pnl]), ALLSELECTED('$tn')), ""`$#,0"") & "" | Trades: "" & FORMAT([Total Trades], ""#,0"")"; F = "" }
    @{ N = "Page Summary Text"; E = "FORMAT([Total Trades], ""#,0"") & "" trades | "" & FORMAT(DISTINCTCOUNT('$tn'[symbol]), ""#,0"") & "" symbols | "" & FORMAT(MIN('$tn'[trade_date]), ""MMM YYYY"") & "" - "" & FORMAT(MAX('$tn'[trade_date]), ""MMM YYYY"")"; F = "" }
    @{ N = "Last Refreshed"; E = """Last refreshed: "" & FORMAT(NOW(), ""MMM DD, YYYY HH:MM"")"; F = "" }
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
