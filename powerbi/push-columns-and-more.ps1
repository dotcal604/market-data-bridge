# Push calculated columns + additional measures to PBI Desktop
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
# CALCULATED COLUMNS
# ============================================================

$columns = @(
    @{
        N = "Quality Tier"
        E = "IF(ISBLANK('$tn'[r_multiple]), ""6-No Data"", IF('$tn'[r_multiple] > 2, ""1-Elite (R>2)"", IF('$tn'[r_multiple] > 1, ""2-Good (1<R<=2)"", IF('$tn'[r_multiple] > 0, ""3-Marginal (0<R<=1)"", IF('$tn'[r_multiple] > -1, ""4-Bad (-1<R<=0)"", ""5-Terrible (R<-1)"")))))"
        T = "String"
    }
    @{
        N = "Day Name"
        E = "SWITCH('$tn'[trade_dow], 0, ""Mon"", 1, ""Tue"", 2, ""Wed"", 3, ""Thu"", 4, ""Fri"", ""Other"")"
        T = "String"
    }
    @{
        N = "Day Sort"
        E = "'$tn'[trade_dow]"
        T = "Int64"
    }
    @{
        N = "Trade Result"
        E = "IF('$tn'[holly_pnl] > 0, ""Win"", IF('$tn'[holly_pnl] < 0, ""Loss"", ""Scratch""))"
        T = "String"
    }
    @{
        N = "Year-Quarter"
        E = "FORMAT('$tn'[trade_date], ""YYYY"") & ""-Q"" & FORMAT(QUARTER('$tn'[trade_date]), ""0"")"
        T = "String"
    }
    @{
        N = "Year-Month"
        E = "FORMAT('$tn'[trade_date], ""YYYY-MM"")"
        T = "String"
    }
    @{
        N = "Month Name"
        E = "FORMAT('$tn'[trade_date], ""MMM"")"
        T = "String"
    }
    @{
        N = "Month Sort"
        E = "MONTH('$tn'[trade_date])"
        T = "Int64"
    }
    @{
        N = "Left on Table"
        E = "IF(NOT(ISBLANK('$tn'[mfe])) && NOT(ISBLANK('$tn'[holly_pnl])), '$tn'[mfe] - '$tn'[holly_pnl], BLANK())"
        T = "Double"
    }
    @{
        N = "Trend Regime Clean"
        E = "IF(ISBLANK('$tn'[trend_regime]), ""No Data"", '$tn'[trend_regime])"
        T = "String"
    }
    @{
        N = "Vol Regime Clean"
        E = "IF(ISBLANK('$tn'[vol_regime]), ""No Data"", '$tn'[vol_regime])"
        T = "String"
    }
    @{
        N = "Momentum Regime Clean"
        E = "IF(ISBLANK('$tn'[momentum_regime]), ""No Data"", '$tn'[momentum_regime])"
        T = "String"
    }
    @{
        N = "Opt Exit Rule Clean"
        E = "IF(ISBLANK('$tn'[opt_exit_rule]), ""No Data"", '$tn'[opt_exit_rule])"
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
# ADDITIONAL MEASURES (that reference new columns or are complex)
# ============================================================

$measures = @(
    @{ N = "Avg Left on Table"; E = "AVERAGE('$tn'[Left on Table])"; F = "`$#,0.00" }
    @{ N = "Sharpe Proxy"; E = "VAR AvgDaily = AVERAGEX(VALUES('$tn'[trade_date]), CALCULATE(SUM('$tn'[holly_pnl]))) VAR StdDaily = STDEVX.S(VALUES('$tn'[trade_date]), CALCULATE(SUM('$tn'[holly_pnl]))) RETURN DIVIDE(AvgDaily, StdDaily, 0) * SQRT(252)"; F = "#,0.00" }
    @{ N = "Top 10 Symbol PnL Pct"; E = "VAR Top10 = TOPN(10, ADDCOLUMNS(VALUES('$tn'[symbol]), ""@PnL"", CALCULATE(SUM('$tn'[holly_pnl]))), [@PnL], DESC) VAR Top10Total = SUMX(Top10, [@PnL]) VAR GrandTotal = CALCULATE(SUM('$tn'[holly_pnl]), ALL('$tn')) RETURN DIVIDE(Top10Total, GrandTotal, 0)"; F = "0.0%" }
    @{ N = "Regime Improvement Text"; E = "VAR FilteredAvg = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[trend_regime] = ""uptrend"", '$tn'[vol_regime] = ""normal_vol"") VAR OverallAvg = CALCULATE(AVERAGE('$tn'[holly_pnl]), ALL('$tn')) VAR Pct = DIVIDE(FilteredAvg - OverallAvg, ABS(OverallAvg), 0) * 100 RETURN ""Regime filter (uptrend + normal_vol): Avg PnL "" & FORMAT(FilteredAvg, ""$#,0.00"") & "" vs Overall "" & FORMAT(OverallAvg, ""$#,0.00"") & "" ("" & FORMAT(Pct, ""#,0.0"") & ""% improvement)"""; F = "" }

    # Display measures
    @{ N = "Win Rate Display"; E = "FORMAT([Win Rate], ""0.0%"")"; F = "" }
    @{ N = "Total PnL Display"; E = "FORMAT([Total PnL], ""$#,0"")"; F = "" }
    @{ N = "Avg PnL Display"; E = "FORMAT([Avg PnL], ""$#,0.00"")"; F = "" }
    @{ N = "Profit Factor Display"; E = "FORMAT([Profit Factor], ""#,0.00"")"; F = "" }
    @{ N = "Avg R Display"; E = "FORMAT([Avg R-Multiple], ""#,0.00"")"; F = "" }
    @{ N = "Hold Time Display"; E = "FORMAT([Avg Hold Minutes], ""#,0"") & "" min"""; F = "" }
    @{ N = "Total Trades Display"; E = "FORMAT([Total Trades], ""#,0"")"; F = "" }

    # Color measures for conditional formatting
    @{ N = "PnL Color"; E = "IF([Total PnL] >= 0, ""#00E676"", ""#FF5252"")"; F = "" }
    @{ N = "Win Rate Color"; E = "IF([Win Rate] >= 0.55, ""#00E676"", IF([Win Rate] >= 0.45, ""#FFD740"", ""#FF5252""))"; F = "" }
    @{ N = "Profit Factor Color"; E = "IF([Profit Factor] >= 1.5, ""#00E676"", IF([Profit Factor] >= 1.0, ""#FFD740"", ""#FF5252""))"; F = "" }
    @{ N = "R Multiple Color"; E = "IF([Avg R-Multiple] >= 1, ""#00E676"", IF([Avg R-Multiple] >= 0, ""#FFD740"", ""#FF5252""))"; F = "" }
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
