# Push Field Parameters + What-If Parameter as calculated tables
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
$tn = "holly_analytics"
$holly = $model.Tables | Where-Object { $_.Name -eq $tn }
Write-Host "Model: $($model.Tables.Count) tables, holly has $($holly.Measures.Count) measures"

# ============================================================
# 1. WHAT-IF PARAMETER: Min Stop Buffer
# ============================================================

$whName = "Min Stop Buffer"
$existWH = $model.Tables | Where-Object { $_.Name -eq $whName }

if ($existWH) {
    Write-Host "`n[SKIP] '$whName' already exists"
} else {
    Write-Host "`n[CREATE] What-If: $whName (0 to 3, step 0.05)..."

    $whTable = New-Object Microsoft.AnalysisServices.Tabular.Table
    $whTable.Name = $whName
    $whTable.Description = "What-If parameter for minimum stop buffer filter"

    $whPart = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $whPart.Name = $whName
    $whSrc = New-Object Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource
    $whSrc.Expression = @"
GENERATESERIES(0, 3, 0.05)
"@
    $whPart.Source = $whSrc
    $whTable.Partitions.Add($whPart)
    $model.Tables.Add($whTable)
    Write-Host "  Table added"
}

# ============================================================
# 2. PERFORMANCE METRIC FIELD PARAMETER
# ============================================================

$pmName = "Performance Metric"
$existPM = $model.Tables | Where-Object { $_.Name -eq $pmName }

if ($existPM) {
    Write-Host "`n[SKIP] '$pmName' already exists"
} else {
    Write-Host "`n[CREATE] Field Parameter: $pmName..."

    $pmTable = New-Object Microsoft.AnalysisServices.Tabular.Table
    $pmTable.Name = $pmName

    $pmPart = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $pmPart.Name = $pmName
    $pmSrc = New-Object Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource
    $pmSrc.Expression = @"
{
    ("Total PnL", NAMEOF('$tn'[Total PnL]), 0),
    ("Avg PnL", NAMEOF('$tn'[Avg PnL]), 1),
    ("Win Rate", NAMEOF('$tn'[Win Rate]), 2),
    ("Profit Factor", NAMEOF('$tn'[Profit Factor]), 3),
    ("Sharpe Ratio", NAMEOF('$tn'[Sharpe Ratio]), 4),
    ("Avg R Multiple", NAMEOF('$tn'[Avg R Multiple]), 5),
    ("Total Trades", NAMEOF('$tn'[Total Trades]), 6),
    ("Expectancy", NAMEOF('$tn'[Expectancy]), 7),
    ("Edge Score", NAMEOF('$tn'[Edge Score]), 8),
    ("Consistency Score", NAMEOF('$tn'[Consistency Score]), 9),
    ("Kelly Pct", NAMEOF('$tn'[Kelly Pct]), 10)
}
"@
    $pmPart.Source = $pmSrc
    $pmTable.Partitions.Add($pmPart)
    $model.Tables.Add($pmTable)
    Write-Host "  Table added"
}

# ============================================================
# 3. TIME DIMENSION FIELD PARAMETER
# ============================================================

$tdName = "Time Dimension"
$existTD = $model.Tables | Where-Object { $_.Name -eq $tdName }

if ($existTD) {
    Write-Host "`n[SKIP] '$tdName' already exists"
} else {
    Write-Host "`n[CREATE] Field Parameter: $tdName..."

    $tdTable = New-Object Microsoft.AnalysisServices.Tabular.Table
    $tdTable.Name = $tdName

    $tdPart = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $tdPart.Name = $tdName
    $tdSrc = New-Object Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource
    $tdSrc.Expression = @"
{
    ("Year", NAMEOF('$tn'[trade_year]), 0),
    ("Month", NAMEOF('Date_Table'[MonthNameShort]), 1),
    ("Day of Week", NAMEOF('Date_Table'[DayNameShort]), 2),
    ("Hour", NAMEOF('$tn'[Entry_Hour_Label]), 3),
    ("Month-Year", NAMEOF('Date_Table'[MonthYear]), 4),
    ("Quarter", NAMEOF('Date_Table'[YearQuarter]), 5)
}
"@
    $tdPart.Source = $tdSrc
    $tdTable.Partitions.Add($tdPart)
    $model.Tables.Add($tdTable)
    Write-Host "  Table added"
}

# ============================================================
# 4. CATEGORY DIMENSION FIELD PARAMETER
# ============================================================

$cdName = "Category Dimension"
$existCD = $model.Tables | Where-Object { $_.Name -eq $cdName }

if ($existCD) {
    Write-Host "`n[SKIP] '$cdName' already exists"
} else {
    Write-Host "`n[CREATE] Field Parameter: $cdName..."

    $cdTable = New-Object Microsoft.AnalysisServices.Tabular.Table
    $cdTable.Name = $cdName

    $cdPart = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $cdPart.Name = $cdName
    $cdSrc = New-Object Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource
    $cdSrc.Expression = @"
{
    ("Strategy", NAMEOF('$tn'[strategy]), 0),
    ("Direction", NAMEOF('$tn'[direction]), 1),
    ("Trend Regime", NAMEOF('$tn'[trend_regime]), 2),
    ("Vol Regime", NAMEOF('$tn'[vol_regime]), 3),
    ("Momentum Regime", NAMEOF('$tn'[momentum_regime]), 4),
    ("Exit Rule", NAMEOF('$tn'[opt_exit_rule]), 5),
    ("Outcome", NAMEOF('$tn'[Trade_Outcome]), 6),
    ("Symbol", NAMEOF('$tn'[symbol]), 7),
    ("Regime Combo", NAMEOF('$tn'[Regime_Combo]), 8)
}
"@
    $cdPart.Source = $cdSrc
    $cdTable.Partitions.Add($cdPart)
    $model.Tables.Add($cdTable)
    Write-Host "  Table added"
}

# ============================================================
# SAVE TABLES
# ============================================================

Write-Host "`nSaving tables..."
try {
    $model.SaveChanges()
    Write-Host "TABLES SAVED!"
    foreach ($tbl in $model.Tables) {
        Write-Host "  $($tbl.Name): $($tbl.Columns.Count) cols, $($tbl.Measures.Count) measures"
    }
} catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Host "Inner: $($_.Exception.InnerException.Message)" }
    $server.Disconnect()
    exit 1
}

# Re-read
$db = $server.Databases[0]
$model = $db.Model

# ============================================================
# 5. ADD WHAT-IF MEASURE
# ============================================================

$whTable = $model.Tables | Where-Object { $_.Name -eq "Min Stop Buffer" }
if ($whTable) {
    # Find the value column (GENERATESERIES creates a "Value" column)
    Write-Host "`nWhat-If columns: $(($whTable.Columns | ForEach-Object { $_.Name }) -join ', ')"

    $valColName = ($whTable.Columns | Where-Object { $_.Name -ne "RowNumber-2662979B-1795-4F74-8F37-6A1BA8059B61" } | Select-Object -First 1).Name
    Write-Host "Value column: $valColName"

    $existMeas = $whTable.Measures | Where-Object { $_.Name -eq "Min Stop Buffer Value" }
    if (-not $existMeas) {
        $m = New-Object Microsoft.AnalysisServices.Tabular.Measure
        $m.Name = "Min Stop Buffer Value"
        $m.Expression = "SELECTEDVALUE('Min Stop Buffer'[$valColName], 0)"
        $m.FormatString = "0.00"
        $whTable.Measures.Add($m)
        Write-Host "  ADD measure: Min Stop Buffer Value"
    }
}

# ============================================================
# 6. ADD FIELD PARAMETER ANNOTATIONS
# ============================================================

$paramTables = @("Performance Metric", "Time Dimension", "Category Dimension")
foreach ($pName in $paramTables) {
    $pTable = $model.Tables | Where-Object { $_.Name -eq $pName }
    if ($pTable) {
        # Add ParameterMetadata annotation
        $existAnnot = $pTable.Annotations | Where-Object { $_.Name -eq "PBI_NavigationStepName" }
        if (-not $existAnnot) {
            $annot = New-Object Microsoft.AnalysisServices.Tabular.Annotation
            $annot.Name = "PBI_NavigationStepName"
            $annot.Value = "Navigation"
            $pTable.Annotations.Add($annot)
            Write-Host "  Annotation: $pName -> PBI_NavigationStepName"
        }

        # ParameterMetadata annotation for field parameter
        $existPM = $pTable.Annotations | Where-Object { $_.Name -eq "ParameterMetadata" }
        if (-not $existPM) {
            $pmAnnot = New-Object Microsoft.AnalysisServices.Tabular.Annotation
            $pmAnnot.Name = "ParameterMetadata"
            $pmAnnot.Value = '{"version":3,"kind":2}'
            $pTable.Annotations.Add($pmAnnot)
            Write-Host "  Annotation: $pName -> ParameterMetadata"
        }

        # Set sort-by-column for the display column
        $cols = $pTable.Columns | Where-Object { $_.Name -ne "RowNumber-2662979B-1795-4F74-8F37-6A1BA8059B61" }
        Write-Host "  $pName columns: $(($cols | ForEach-Object { $_.Name }) -join ', ')"
    }
}

# ============================================================
# 7. UPDATE WHAT-IF FILTERED MEASURES TO USE DYNAMIC VALUE
# ============================================================

$hollyT = $model.Tables | Where-Object { $_.Name -eq $tn }

# Update filtered measures to use the What-If slider value
$dynamicMeasures = @(
    @{ N = "WhatIf Filtered Trades"; E = "VAR _minBuf = [Min Stop Buffer Value] RETURN CALCULATE(COUNTROWS('$tn'), '$tn'[stop_buffer_pct] >= _minBuf)"; F = "#,0"; D = "What-If Analysis" }
    @{ N = "WhatIf Win Rate"; E = "VAR _minBuf = [Min Stop Buffer Value] VAR _filtered = FILTER('$tn', '$tn'[stop_buffer_pct] >= _minBuf) VAR _wins = COUNTROWS(FILTER(_filtered, '$tn'[is_winner] = TRUE())) VAR _total = COUNTROWS(_filtered) RETURN DIVIDE(_wins, _total)"; F = "0.0%"; D = "What-If Analysis" }
    @{ N = "WhatIf Avg PnL"; E = "VAR _minBuf = [Min Stop Buffer Value] RETURN CALCULATE(AVERAGE('$tn'[holly_pnl]), '$tn'[stop_buffer_pct] >= _minBuf)"; F = "`$#,0.00"; D = "What-If Analysis" }
    @{ N = "WhatIf Profit Factor"; E = "VAR _minBuf = [Min Stop Buffer Value] VAR _winPnL = CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[is_winner] = TRUE(), '$tn'[stop_buffer_pct] >= _minBuf) VAR _losePnL = CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[is_loser] = TRUE(), '$tn'[stop_buffer_pct] >= _minBuf) RETURN IF(ABS(_losePnL) > 0, DIVIDE(_winPnL, ABS(_losePnL)), BLANK())"; F = "#,0.00"; D = "What-If Analysis" }
    @{ N = "WhatIf Total PnL"; E = "VAR _minBuf = [Min Stop Buffer Value] RETURN CALCULATE(SUM('$tn'[holly_pnl]), '$tn'[stop_buffer_pct] >= _minBuf)"; F = "`$#,0.00"; D = "What-If Analysis" }
    @{ N = "WhatIf Trades Excluded"; E = "[Total Trades] - [WhatIf Filtered Trades]"; F = "#,0"; D = "What-If Analysis" }
    @{ N = "WhatIf Pct Excluded"; E = "DIVIDE([WhatIf Trades Excluded], [Total Trades])"; F = "0.0%"; D = "What-If Analysis" }
)

$addedM = 0; $skippedM = 0

foreach ($m in $dynamicMeasures) {
    $existing = $hollyT.Measures | Where-Object { $_.Name -eq $m.N }
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
        $hollyT.Measures.Add($measure)
        Write-Host "  ADD: $($m.N)"
        $addedM++
    } catch {
        Write-Host "  ERR: $($m.N) - $($_.Exception.Message)"
    }
}

# ============================================================
# FINAL SAVE
# ============================================================

Write-Host "`nFinal save ($addedM new measures)..."
try {
    $model.SaveChanges()
    Write-Host "SUCCESS!"
    foreach ($tbl in $model.Tables) {
        Write-Host "  $($tbl.Name): $($tbl.Columns.Count) cols, $($tbl.Measures.Count) measures"
    }
} catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Host "Inner: $($_.Exception.InnerException.Message)" }
}

$server.Disconnect()
Write-Host "Done."
