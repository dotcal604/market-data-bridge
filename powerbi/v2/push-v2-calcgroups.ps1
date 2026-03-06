# Push Calculation Groups via TOM (requires compat level >= 1500)
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
Write-Host "Compat: $($db.CompatibilityLevel)"

# ============================================================
# 1. TIME COMPARISON Calculation Group
# ============================================================

$tcName = "Time Comparison"
$existTC = $model.Tables | Where-Object { $_.Name -eq $tcName }

if ($existTC) {
    Write-Host "`n[SKIP] '$tcName' already exists"
} else {
    Write-Host "`n[CREATE] Calculation Group: $tcName..."

    try {
        $tcTable = New-Object Microsoft.AnalysisServices.Tabular.Table
        $tcTable.Name = $tcName
        $tcTable.CalculationGroup = New-Object Microsoft.AnalysisServices.Tabular.CalculationGroup

        # Add the name column
        $tcCol = New-Object Microsoft.AnalysisServices.Tabular.DataColumn
        $tcCol.Name = $tcName
        $tcCol.DataType = [Microsoft.AnalysisServices.Tabular.DataType]::String
        $tcCol.SourceColumn = "Name"
        $tcTable.Columns.Add($tcCol)

        # Add partition with CalculationGroupSource
        $tcPart = New-Object Microsoft.AnalysisServices.Tabular.Partition
        $tcPart.Name = $tcName
        $tcPart.Source = New-Object Microsoft.AnalysisServices.Tabular.CalculationGroupSource
        $tcTable.Partitions.Add($tcPart)

        # Calculation Items
        $items = @(
            @{ Name = "Current Period"; Expr = "SELECTEDMEASURE()"; Ord = 0 }
            @{ Name = "Prior Year"; Expr = "CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date_Table'[Date]))"; Ord = 1 }
            @{ Name = "YoY Change"; Expr = "VAR _current = SELECTEDMEASURE() VAR _prior = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date_Table'[Date])) RETURN IF(_prior, _current - _prior, BLANK())"; Ord = 2 }
            @{ Name = "YoY %"; Expr = "VAR _current = SELECTEDMEASURE() VAR _prior = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date_Table'[Date])) RETURN IF(ABS(_prior) > 0, DIVIDE(_current - _prior, ABS(_prior)), BLANK())"; Ord = 3; Fmt = "0.0%" }
            @{ Name = "YTD"; Expr = "CALCULATE(SELECTEDMEASURE(), DATESYTD('Date_Table'[Date]))"; Ord = 4 }
            @{ Name = "MTD"; Expr = "CALCULATE(SELECTEDMEASURE(), DATESMTD('Date_Table'[Date]))"; Ord = 5 }
        )

        foreach ($item in $items) {
            $ci = New-Object Microsoft.AnalysisServices.Tabular.CalculationItem
            $ci.Name = $item.Name
            $ci.Expression = $item.Expr
            $ci.Ordinal = $item.Ord
            if ($item.Fmt) {
                $ci.FormatStringDefinition = New-Object Microsoft.AnalysisServices.Tabular.FormatStringDefinition
                $ci.FormatStringDefinition.Expression = """$($item.Fmt)"""
            }
            $tcTable.CalculationGroup.CalculationItems.Add($ci)
            Write-Host "  Item: $($item.Name)"
        }

        $model.Tables.Add($tcTable)
        Write-Host "  Calculation group added"
    } catch {
        Write-Host "  ERROR creating $tcName : $($_.Exception.Message)"
    }
}

# ============================================================
# 2. MEASURE SELECTOR Calculation Group
# ============================================================

$msName = "Measure Selector"
$existMS = $model.Tables | Where-Object { $_.Name -eq $msName }

if ($existMS) {
    Write-Host "`n[SKIP] '$msName' already exists"
} else {
    Write-Host "`n[CREATE] Calculation Group: $msName..."

    try {
        $msTable = New-Object Microsoft.AnalysisServices.Tabular.Table
        $msTable.Name = $msName
        $msTable.CalculationGroup = New-Object Microsoft.AnalysisServices.Tabular.CalculationGroup

        $msCol = New-Object Microsoft.AnalysisServices.Tabular.DataColumn
        $msCol.Name = $msName
        $msCol.DataType = [Microsoft.AnalysisServices.Tabular.DataType]::String
        $msCol.SourceColumn = "Name"
        $msTable.Columns.Add($msCol)

        $msPart = New-Object Microsoft.AnalysisServices.Tabular.Partition
        $msPart.Name = $msName
        $msPart.Source = New-Object Microsoft.AnalysisServices.Tabular.CalculationGroupSource
        $msTable.Partitions.Add($msPart)

        $msItems = @(
            @{ Name = "Total PnL"; Expr = "SELECTEDMEASURE()"; Ord = 0; Fmt = "`$#,0.00" }
            @{ Name = "Avg PnL"; Expr = "SELECTEDMEASURE()"; Ord = 1; Fmt = "`$#,0.00" }
            @{ Name = "Win Rate"; Expr = "SELECTEDMEASURE()"; Ord = 2; Fmt = "0.0%" }
            @{ Name = "Profit Factor"; Expr = "SELECTEDMEASURE()"; Ord = 3; Fmt = "#,0.00" }
            @{ Name = "Sharpe Ratio"; Expr = "SELECTEDMEASURE()"; Ord = 4; Fmt = "0.00" }
            @{ Name = "Avg R Multiple"; Expr = "SELECTEDMEASURE()"; Ord = 5; Fmt = "0.00" }
            @{ Name = "Total Trades"; Expr = "SELECTEDMEASURE()"; Ord = 6; Fmt = "#,0" }
            @{ Name = "Expectancy"; Expr = "SELECTEDMEASURE()"; Ord = 7; Fmt = "`$#,0.00" }
            @{ Name = "Edge Score"; Expr = "SELECTEDMEASURE()"; Ord = 8; Fmt = "0.00" }
            @{ Name = "Consistency"; Expr = "SELECTEDMEASURE()"; Ord = 9; Fmt = "0.0%" }
            @{ Name = "Kelly %"; Expr = "SELECTEDMEASURE()"; Ord = 10; Fmt = "0.0%" }
        )

        foreach ($item in $msItems) {
            $ci = New-Object Microsoft.AnalysisServices.Tabular.CalculationItem
            $ci.Name = $item.Name
            $ci.Expression = $item.Expr
            $ci.Ordinal = $item.Ord
            if ($item.Fmt) {
                $ci.FormatStringDefinition = New-Object Microsoft.AnalysisServices.Tabular.FormatStringDefinition
                $fmtStr = $item.Fmt -replace '`', ''
                $ci.FormatStringDefinition.Expression = """$fmtStr"""
            }
            $msTable.CalculationGroup.CalculationItems.Add($ci)
            Write-Host "  Item: $($item.Name)"
        }

        $model.Tables.Add($msTable)
        Write-Host "  Calculation group added"
    } catch {
        Write-Host "  ERROR creating $msName : $($_.Exception.Message)"
    }
}

# ============================================================
# SAVE
# ============================================================

Write-Host "`nSaving..."
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
