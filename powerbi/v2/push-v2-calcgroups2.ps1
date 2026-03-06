# Push Calculation Groups — fix: unique precedence
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
Write-Host "Connected | Compat: $($server.Databases[0].CompatibilityLevel)"

$db = $server.Databases[0]
$model = $db.Model

# Required for calculation groups
if (-not $model.DiscourageImplicitMeasures) {
    $model.DiscourageImplicitMeasures = $true
    Write-Host "Set DiscourageImplicitMeasures = true"
}

# ---- Time Comparison (precedence = 10) ----

$tcName = "Time Comparison"
$existTC = $model.Tables | Where-Object { $_.Name -eq $tcName }
if ($existTC) { Write-Host "[SKIP] $tcName" }
else {
    Write-Host "[CREATE] $tcName..."

    $tcT = New-Object Microsoft.AnalysisServices.Tabular.Table
    $tcT.Name = $tcName
    $tcT.CalculationGroup = New-Object Microsoft.AnalysisServices.Tabular.CalculationGroup
    $tcT.CalculationGroup.Precedence = 10

    $tcCol = New-Object Microsoft.AnalysisServices.Tabular.DataColumn
    $tcCol.Name = $tcName; $tcCol.DataType = [Microsoft.AnalysisServices.Tabular.DataType]::String; $tcCol.SourceColumn = "Name"
    $tcT.Columns.Add($tcCol)

    $tcP = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $tcP.Name = $tcName; $tcP.Source = New-Object Microsoft.AnalysisServices.Tabular.CalculationGroupSource
    $tcT.Partitions.Add($tcP)

    $tcItems = @(
        @{ N = "Current Period"; E = "SELECTEDMEASURE()"; O = 0 }
        @{ N = "Prior Year"; E = "CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date_Table'[Date]))"; O = 1 }
        @{ N = "YoY Change"; E = "VAR _cur = SELECTEDMEASURE() VAR _prev = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date_Table'[Date])) RETURN IF(_prev, _cur - _prev, BLANK())"; O = 2 }
        @{ N = "YoY %"; E = "VAR _cur = SELECTEDMEASURE() VAR _prev = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date_Table'[Date])) RETURN IF(ABS(_prev) > 0, DIVIDE(_cur - _prev, ABS(_prev)), BLANK())"; O = 3 }
        @{ N = "YTD"; E = "CALCULATE(SELECTEDMEASURE(), DATESYTD('Date_Table'[Date]))"; O = 4 }
        @{ N = "MTD"; E = "CALCULATE(SELECTEDMEASURE(), DATESMTD('Date_Table'[Date]))"; O = 5 }
    )

    foreach ($i in $tcItems) {
        $ci = New-Object Microsoft.AnalysisServices.Tabular.CalculationItem
        $ci.Name = $i.N; $ci.Expression = $i.E; $ci.Ordinal = $i.O
        $tcT.CalculationGroup.CalculationItems.Add($ci)
        Write-Host "  + $($i.N)"
    }
    $model.Tables.Add($tcT)
}

# ---- Measure Selector (precedence = 20) ----

$msName = "Measure Selector"
$existMS = $model.Tables | Where-Object { $_.Name -eq $msName }
if ($existMS) { Write-Host "[SKIP] $msName" }
else {
    Write-Host "[CREATE] $msName..."

    $msT = New-Object Microsoft.AnalysisServices.Tabular.Table
    $msT.Name = $msName
    $msT.CalculationGroup = New-Object Microsoft.AnalysisServices.Tabular.CalculationGroup
    $msT.CalculationGroup.Precedence = 20

    $msCol = New-Object Microsoft.AnalysisServices.Tabular.DataColumn
    $msCol.Name = $msName; $msCol.DataType = [Microsoft.AnalysisServices.Tabular.DataType]::String; $msCol.SourceColumn = "Name"
    $msT.Columns.Add($msCol)

    $msP = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $msP.Name = $msName; $msP.Source = New-Object Microsoft.AnalysisServices.Tabular.CalculationGroupSource
    $msT.Partitions.Add($msP)

    $msItems = @(
        @{ N = "Total PnL"; E = "SELECTEDMEASURE()"; O = 0 }
        @{ N = "Avg PnL"; E = "SELECTEDMEASURE()"; O = 1 }
        @{ N = "Win Rate"; E = "SELECTEDMEASURE()"; O = 2 }
        @{ N = "Profit Factor"; E = "SELECTEDMEASURE()"; O = 3 }
        @{ N = "Sharpe Ratio"; E = "SELECTEDMEASURE()"; O = 4 }
        @{ N = "Avg R Multiple"; E = "SELECTEDMEASURE()"; O = 5 }
        @{ N = "Total Trades"; E = "SELECTEDMEASURE()"; O = 6 }
        @{ N = "Expectancy"; E = "SELECTEDMEASURE()"; O = 7 }
        @{ N = "Edge Score"; E = "SELECTEDMEASURE()"; O = 8 }
        @{ N = "Consistency"; E = "SELECTEDMEASURE()"; O = 9 }
        @{ N = "Kelly %"; E = "SELECTEDMEASURE()"; O = 10 }
    )

    foreach ($i in $msItems) {
        $ci = New-Object Microsoft.AnalysisServices.Tabular.CalculationItem
        $ci.Name = $i.N; $ci.Expression = $i.E; $ci.Ordinal = $i.O
        $msT.CalculationGroup.CalculationItems.Add($ci)
        Write-Host "  + $($i.N)"
    }
    $model.Tables.Add($msT)
}

# ---- Save ----
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
