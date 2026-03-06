# Push Time Intelligence + Statistical Probability measures
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

$measures = @(
    # ============================================================
    # TIME INTELLIGENCE (require Date_Table relationship)
    # ============================================================

    @{ N = "PnL MTD"; E = "CALCULATE([Total PnL], DATESMTD('Date_Table'[Date]))"; F = "`$#,0.00"; D = "Time Intelligence" }
    @{ N = "PnL YTD"; E = "CALCULATE([Total PnL], DATESYTD('Date_Table'[Date]))"; F = "`$#,0.00"; D = "Time Intelligence" }
    @{ N = "PnL Prior Year"; E = "CALCULATE([Total PnL], SAMEPERIODLASTYEAR('Date_Table'[Date]))"; F = "`$#,0.00"; D = "Time Intelligence" }
    @{ N = "PnL YoY Change"; E = "VAR _cur = [Total PnL] VAR _prev = [PnL Prior Year] RETURN IF(_prev, _cur - _prev, BLANK())"; F = "`$#,0.00"; D = "Time Intelligence" }
    @{ N = "PnL YoY Pct"; E = "VAR _cur = [Total PnL] VAR _prev = [PnL Prior Year] RETURN IF(ABS(_prev) > 0, DIVIDE(_cur - _prev, ABS(_prev)), BLANK())"; F = "0.0%"; D = "Time Intelligence" }
    @{ N = "Trades Prior Year"; E = "CALCULATE([Total Trades], SAMEPERIODLASTYEAR('Date_Table'[Date]))"; F = "#,0"; D = "Time Intelligence" }
    @{ N = "Win Rate Prior Year"; E = "CALCULATE([Win Rate], SAMEPERIODLASTYEAR('Date_Table'[Date]))"; F = "0.0%"; D = "Time Intelligence" }
    @{ N = "Win Rate YoY Change"; E = "VAR _cur = [Win Rate] VAR _prev = [Win Rate Prior Year] RETURN IF(_prev, _cur - _prev, BLANK())"; F = "0.0 pp"; D = "Time Intelligence" }
    @{ N = "PnL vs Prior Year Delta"; E = "[PnL YoY Change]"; F = "`$#,0.00"; D = "Time Intelligence" }

    # ============================================================
    # STATISTICAL PROBABILITY — Confidence & Significance
    # ============================================================

    # Win Rate 95% Confidence Interval (Wilson score interval)
    @{ N = "Win Rate CI Lower"; E = "VAR _n = [Total Trades] VAR _p = [Win Rate] VAR _z = 1.96 VAR _denom = 1 + _z*_z/_n VAR _center = _p + _z*_z/(2*_n) VAR _spread = _z * SQRT((_p*(1-_p) + _z*_z/(4*_n))/_n) RETURN IF(_n >= 10, MAX(0, (_center - _spread) / _denom), BLANK())"; F = "0.0%"; D = "Statistical Probability" }
    @{ N = "Win Rate CI Upper"; E = "VAR _n = [Total Trades] VAR _p = [Win Rate] VAR _z = 1.96 VAR _denom = 1 + _z*_z/_n VAR _center = _p + _z*_z/(2*_n) VAR _spread = _z * SQRT((_p*(1-_p) + _z*_z/(4*_n))/_n) RETURN IF(_n >= 10, MIN(1, (_center + _spread) / _denom), BLANK())"; F = "0.0%"; D = "Statistical Probability" }
    @{ N = "Win Rate CI Width"; E = "[Win Rate CI Upper] - [Win Rate CI Lower]"; F = "0.0 pp"; D = "Statistical Probability" }

    # Z-Score: Is win rate significantly different from 50%?
    @{ N = "Win Rate Z Score"; E = "VAR _n = [Total Trades] VAR _p = [Win Rate] RETURN IF(_n >= 10, (_p - 0.5) / SQRT(0.25 / _n), BLANK())"; F = "0.00"; D = "Statistical Probability" }
    # p < 0.05 when |Z| > 1.96
    @{ N = "Win Rate Significant"; E = "IF(ABS([Win Rate Z Score]) > 1.96, ""Yes"", ""No"")"; F = ""; D = "Statistical Probability" }

    # Kelly Criterion — optimal bet fraction
    @{ N = "Kelly Pct"; E = "VAR _wr = [Win Rate] VAR _avgW = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[is_winner] = TRUE()) VAR _avgL = ABS(CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[is_loser] = TRUE())) VAR _payoff = DIVIDE(_avgW, _avgL, 0) RETURN IF([Total Trades] >= 20, _wr - DIVIDE(1 - _wr, _payoff, 0), BLANK())"; F = "0.0%"; D = "Statistical Probability" }
    @{ N = "Half Kelly Pct"; E = "DIVIDE([Kelly Pct], 2, 0)"; F = "0.0%"; D = "Statistical Probability" }

    # Payoff Ratio (avg win / avg loss)
    @{ N = "Payoff Ratio"; E = "VAR _avgW = CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[is_winner] = TRUE()) VAR _avgL = ABS(CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[is_loser] = TRUE())) RETURN DIVIDE(_avgW, _avgL, 0)"; F = "0.00x"; D = "Statistical Probability" }

    # Expected Value with confidence
    @{ N = "EV Per Trade"; E = "[Expectancy]"; F = "`$#,0.00"; D = "Statistical Probability" }
    @{ N = "EV CI Lower"; E = "VAR _ev = [Expectancy] VAR _n = [Total Trades] VAR _sd = STDEV.P('$tn'[holly_pnl]) RETURN IF(_n >= 20, _ev - 1.96 * _sd / SQRT(_n), BLANK())"; F = "`$#,0.00"; D = "Statistical Probability" }
    @{ N = "EV CI Upper"; E = "VAR _ev = [Expectancy] VAR _n = [Total Trades] VAR _sd = STDEV.P('$tn'[holly_pnl]) RETURN IF(_n >= 20, _ev + 1.96 * _sd / SQRT(_n), BLANK())"; F = "`$#,0.00"; D = "Statistical Probability" }

    # Edge Significance — is the strategy edge real?
    @{ N = "T Statistic"; E = "VAR _mean = AVERAGE('$tn'[holly_pnl]) VAR _sd = STDEV.P('$tn'[holly_pnl]) VAR _n = [Total Trades] RETURN IF(_n >= 10 && _sd > 0, _mean / (_sd / SQRT(_n)), BLANK())"; F = "0.00"; D = "Statistical Probability" }
    @{ N = "Edge Significant"; E = "IF(ABS([T Statistic]) > 1.96, ""Significant"", IF(ABS([T Statistic]) > 1.645, ""Marginal"", ""Not Significant""))"; F = ""; D = "Statistical Probability" }

    # Streak probability — probability of seeing N consecutive wins/losses by chance
    @{ N = "Max Consecutive Wins"; E = "VAR _trades = ADDCOLUMNS(SELECTCOLUMNS('$tn', ""@Date"", '$tn'[trade_date], ""@Time"", '$tn'[entry_time], ""@Win"", '$tn'[is_winner]), ""@Idx"", RANKX(ALL('$tn'), '$tn'[trade_date] + '$tn'[entry_time], , ASC, Dense)) VAR _result = MAXX(_trades, VAR _curIdx = [@Idx] VAR _curWin = [@Win] RETURN IF(_curWin = TRUE(), COUNTROWS(FILTER(_trades, [@Idx] <= _curIdx && [@Idx] > _curIdx - 20 && [@Win] = TRUE())), 0)) RETURN _result"; F = "#,0"; D = "Statistical Probability" }

    # Probability of ruin (simplified — assumes fixed bet size)
    @{ N = "Prob of Ruin Pct"; E = "VAR _wr = [Win Rate] VAR _lr = 1 - _wr VAR _ratio = DIVIDE(_lr, _wr, 999) RETURN IF([Total Trades] >= 30 && _wr > 0.5, POWER(_ratio, 10) * 100, IF(_wr <= 0.5, 100, BLANK()))"; F = "0.0%"; D = "Statistical Probability" }

    # Coefficient of Variation (risk per unit return)
    @{ N = "PnL Coeff of Variation"; E = "VAR _mean = AVERAGE('$tn'[holly_pnl]) VAR _sd = STDEV.P('$tn'[holly_pnl]) RETURN IF(ABS(_mean) > 0, _sd / ABS(_mean), BLANK())"; F = "0.00"; D = "Statistical Probability" }

    # Skewness (positive = right tail = good)
    @{ N = "PnL Skewness"; E = "VAR _n = [Total Trades] VAR _mean = AVERAGE('$tn'[holly_pnl]) VAR _sd = STDEV.P('$tn'[holly_pnl]) RETURN IF(_n >= 20 && _sd > 0, (_n / ((_n-1)*(_n-2))) * SUMX('$tn', POWER(('$tn'[holly_pnl] - _mean) / _sd, 3)), BLANK())"; F = "0.00"; D = "Statistical Probability" }

    # Kurtosis (excess kurtosis; >0 = fat tails)
    @{ N = "PnL Kurtosis"; E = "VAR _n = [Total Trades] VAR _mean = AVERAGE('$tn'[holly_pnl]) VAR _sd = STDEV.P('$tn'[holly_pnl]) RETURN IF(_n >= 30 && _sd > 0, ((_n*(_n+1))/((_n-1)*(_n-2)*(_n-3))) * SUMX('$tn', POWER(('$tn'[holly_pnl] - _mean) / _sd, 4)) - (3*POWER(_n-1,2))/((_n-2)*(_n-3)), BLANK())"; F = "0.00"; D = "Statistical Probability" }

    # ============================================================
    # STATISTICAL PROBABILITY — Conditional Formatting
    # ============================================================

    @{ N = "Z Score Color"; E = "VAR _z = ABS([Win Rate Z Score]) RETURN IF(_z > 2.576, ""#00D4AA"", IF(_z > 1.96, ""#69F0AE"", IF(_z > 1.645, ""#FFD700"", ""#FF4444"")))"; F = ""; D = "Statistical Probability" }
    @{ N = "Kelly Color"; E = "IF([Kelly Pct] > 0.15, ""#00D4AA"", IF([Kelly Pct] > 0, ""#FFD700"", ""#FF4444""))"; F = ""; D = "Statistical Probability" }
    @{ N = "T Stat Color"; E = "VAR _t = ABS([T Statistic]) RETURN IF(_t > 2.576, ""#00D4AA"", IF(_t > 1.96, ""#69F0AE"", IF(_t > 1.645, ""#FFD700"", ""#FF4444"")))"; F = ""; D = "Statistical Probability" }

    # ============================================================
    # DISPLAY LABELS for Stats
    # ============================================================

    @{ N = "Win Rate CI Label"; E = "FORMAT([Win Rate CI Lower], ""0.0%"") & "" - "" & FORMAT([Win Rate CI Upper], ""0.0%"") & "" (95% CI)"""; F = ""; D = "Statistical Probability" }
    @{ N = "Edge Verdict"; E = "VAR _sig = [Edge Significant] VAR _kelly = [Kelly Pct] VAR _z = [Win Rate Z Score] RETURN IF(_sig = ""Significant"" && _kelly > 0, ""Real Edge (Kelly "" & FORMAT(_kelly, ""0.0%"") & "")"", IF(_sig = ""Marginal"", ""Possible Edge (needs more data)"", ""No Statistical Edge""))"; F = ""; D = "Statistical Probability" }

    # Stats page title
    @{ N = "Stats Page Title"; E = """Statistical Probability Analysis | "" & FORMAT([Total Trades], ""#,0"") & "" trades | "" & FORMAT([Win Rate], ""0.0%"") & "" WR (95% CI: "" & FORMAT([Win Rate CI Lower], ""0.0%"") & ""-"" & FORMAT([Win Rate CI Upper], ""0.0%"") & "")"""; F = ""; D = "Statistical Probability" }
)

$addedM = 0; $skippedM = 0; $errorM = 0

foreach ($m in $measures) {
    $existing = $t.Measures | Where-Object { $_.Name -eq $m.N }
    if ($existing) {
        Write-Host "  SKIP: $($m.N)"
        $skippedM++
        continue
    }
    try {
        $measure = New-Object Microsoft.AnalysisServices.Tabular.Measure
        $measure.Name = $m.N
        $measure.Expression = $m.E
        if ($m.F -and $m.F -ne "") { $measure.FormatString = $m.F }
        if ($m.D -and $m.D -ne "") { $measure.DisplayFolder = $m.D }
        $t.Measures.Add($measure)
        Write-Host "  ADD: $($m.N)"
        $addedM++
    }
    catch {
        Write-Host "  ERR: $($m.N) - $($_.Exception.Message)"
        $errorM++
    }
}

Write-Host "`nSaving $addedM measures..."
try {
    $model.SaveChanges()
    Write-Host "SUCCESS! $addedM added, $skippedM skipped, $errorM errors."
    Write-Host "Total: $($t.Columns.Count) columns, $($t.Measures.Count) measures"
}
catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Host "Inner: $($_.Exception.InnerException.Message)" }
}

$server.Disconnect()
Write-Host "Done."
