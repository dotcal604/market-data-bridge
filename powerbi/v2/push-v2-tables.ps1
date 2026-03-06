# Push Date_Table, Strategy_Lookup as calculated tables + create relationships
param([int]$Port = 14448)

$ErrorActionPreference = "Stop"
Import-Module SqlServer -ErrorAction Stop

$sqlModulePath = (Get-Module SqlServer).ModuleBase
$tomDll = Join-Path $sqlModulePath "Microsoft.AnalysisServices.Tabular.dll"
Add-Type -Path $tomDll
$coreDll = Join-Path $sqlModulePath "Microsoft.AnalysisServices.Core.dll"
if (Test-Path $coreDll) { Add-Type -Path $coreDll }

$server = New-Object Microsoft.AnalysisServices.Tabular.Server
try {
    $server.Connect("Data Source=localhost:$Port")
} catch {
    Write-Host "Cannot connect to localhost:$Port - is PBI Desktop running?"
    exit 1
}
Write-Host "Connected to localhost:$Port"

$db = $server.Databases[0]
$model = $db.Model
$tn = "holly_analytics"
Write-Host "DB: $($db.Name) | Compat: $($db.CompatibilityLevel)"
Write-Host "Tables: $(($model.Tables | ForEach-Object { $_.Name }) -join ', ')"

$holly = $model.Tables | Where-Object { $_.Name -eq $tn }
if (-not $holly) { Write-Host "ERROR: '$tn' not found!"; $server.Disconnect(); exit 1 }

# ============================================================
# 1. DATE_TABLE (Calculated Table)
# ============================================================

$dateTableName = "Date_Table"
$existDT = $model.Tables | Where-Object { $_.Name -eq $dateTableName }

if ($existDT) {
    Write-Host "`n[SKIP] $dateTableName already exists ($($existDT.Columns.Count) cols)"
} else {
    Write-Host "`n[CREATE] $dateTableName..."

    $dt = New-Object Microsoft.AnalysisServices.Tabular.Table
    $dt.Name = $dateTableName
    $dt.Description = "Date dimension for time intelligence"

    $p = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $p.Name = $dateTableName
    $src = New-Object Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource
    $src.Expression = @"
VAR _dates = CALENDAR(DATE(2016,1,1), DATE(2026,12,31))
RETURN
ADDCOLUMNS(
    _dates,
    "Year", YEAR([Date]),
    "Quarter", QUARTER([Date]),
    "QuarterLabel", "Q" & FORMAT(QUARTER([Date]), "0"),
    "Month", MONTH([Date]),
    "MonthName", FORMAT([Date], "MMMM"),
    "MonthNameShort", FORMAT([Date], "MMM"),
    "MonthYear", FORMAT([Date], "MMM YYYY"),
    "YearMonth", YEAR([Date]) * 100 + MONTH([Date]),
    "YearQuarter", "Q" & FORMAT(QUARTER([Date]), "0") & " " & FORMAT(YEAR([Date]), "0000"),
    "WeekOfYear", WEEKNUM([Date], 2),
    "DayOfWeek", WEEKDAY([Date], 2),
    "DayName", FORMAT([Date], "dddd"),
    "DayNameShort", FORMAT([Date], "ddd"),
    "DayOfMonth", DAY([Date]),
    "IsWeekday", IF(WEEKDAY([Date], 2) <= 5, TRUE(), FALSE())
)
"@
    $p.Source = $src
    $dt.Partitions.Add($p)
    $model.Tables.Add($dt)
    Write-Host "  Added to model (will materialize on save)"
}

# ============================================================
# 2. STRATEGY_LOOKUP (Calculated Table)
# ============================================================

$stratTableName = "Strategy_Lookup"
$existST = $model.Tables | Where-Object { $_.Name -eq $stratTableName }

if ($existST) {
    Write-Host "`n[SKIP] $stratTableName already exists ($($existST.Columns.Count) cols)"
} else {
    Write-Host "`n[CREATE] $stratTableName..."

    $st = New-Object Microsoft.AnalysisServices.Tabular.Table
    $st.Name = $stratTableName
    $st.Description = "Strategy dimension for filtering"

    $p2 = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $p2.Name = $stratTableName
    $src2 = New-Object Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource
    $src2.Expression = "DISTINCT('$tn'[strategy])"
    $p2.Source = $src2
    $st.Partitions.Add($p2)
    $model.Tables.Add($st)
    Write-Host "  Added to model (will materialize on save)"
}

# ============================================================
# SAVE — materialize tables
# ============================================================

Write-Host "`nSaving tables..."
try {
    $model.SaveChanges()
    Write-Host "TABLES SAVED!"
} catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) {
        Write-Host "Inner: $($_.Exception.InnerException.Message)"
    }
    $server.Disconnect()
    exit 1
}

# Re-read model
$db = $server.Databases[0]
$model = $db.Model

foreach ($tbl in $model.Tables) {
    $colNames = ($tbl.Columns | ForEach-Object { $_.Name }) -join ", "
    Write-Host "  $($tbl.Name): $($tbl.Columns.Count) cols — $colNames"
}

# ============================================================
# 3. CONFIGURE DATE_TABLE (sort-by-column, mark as date table)
# ============================================================

$dateT = $model.Tables | Where-Object { $_.Name -eq "Date_Table" }
if ($dateT -and $dateT.Columns.Count -gt 1) {
    Write-Host "`nConfiguring Date_Table..."

    # Sort-by-column pairs
    $sortPairs = @(
        @("MonthName", "Month"),
        @("MonthNameShort", "Month"),
        @("DayName", "DayOfWeek"),
        @("DayNameShort", "DayOfWeek"),
        @("MonthYear", "YearMonth"),
        @("QuarterLabel", "Quarter"),
        @("YearQuarter", "YearMonth")
    )

    foreach ($pair in $sortPairs) {
        $col = $dateT.Columns | Where-Object { $_.Name -eq $pair[0] }
        $sortCol = $dateT.Columns | Where-Object { $_.Name -eq $pair[1] }
        if ($col -and $sortCol) {
            $col.SortByColumn = $sortCol
            Write-Host "  Sort: $($pair[0]) by $($pair[1])"
        } else {
            Write-Host "  WARN: Cannot sort $($pair[0]) - col or sortCol not found"
        }
    }

    # Hide sort-only columns
    foreach ($h in @("YearMonth", "DayOfWeek")) {
        $col = $dateT.Columns | Where-Object { $_.Name -eq $h }
        if ($col) { $col.IsHidden = $true; Write-Host "  Hide: $h" }
    }

    # Mark Date as key
    $dateCol = $dateT.Columns | Where-Object { $_.Name -eq "Date" }
    if ($dateCol) {
        $dateCol.IsKey = $true
        Write-Host "  Set Date as key column"
    }
} else {
    Write-Host "`nWARN: Date_Table has no columns — check DAX expression"
}

# ============================================================
# 4. CREATE RELATIONSHIPS
# ============================================================

$holly = $model.Tables | Where-Object { $_.Name -eq $tn }
$dateT = $model.Tables | Where-Object { $_.Name -eq "Date_Table" }
$stratT = $model.Tables | Where-Object { $_.Name -eq "Strategy_Lookup" }

# --- Date relationship ---
$hasDateRel = $model.Relationships | Where-Object {
    ($_.FromTable.Name -eq "Date_Table" -and $_.ToTable.Name -eq $tn) -or
    ($_.FromTable.Name -eq $tn -and $_.ToTable.Name -eq "Date_Table")
}

if ($hasDateRel) {
    Write-Host "`n[SKIP] Date relationship exists"
} elseif ($dateT) {
    Write-Host "`n[CREATE] Date_Table[Date] -> $tn[trade_date]..."
    $fromCol = $dateT.Columns | Where-Object { $_.Name -eq "Date" }
    $toCol = $holly.Columns | Where-Object { $_.Name -eq "trade_date" }

    if ($fromCol -and $toCol) {
        $rel = New-Object Microsoft.AnalysisServices.Tabular.SingleColumnRelationship
        $rel.Name = "Date_to_TradeDate"
        $rel.FromColumn = $fromCol
        $rel.ToColumn = $toCol
        $rel.FromCardinality = [Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality]::One
        $rel.ToCardinality = [Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality]::Many
        $model.Relationships.Add($rel)
        Write-Host "  Added"
    } else {
        Write-Host "  ERROR: Date=$($fromCol -ne $null), trade_date=$($toCol -ne $null)"
    }
}

# --- Strategy relationship ---
$hasStratRel = $model.Relationships | Where-Object {
    ($_.FromTable.Name -eq "Strategy_Lookup" -and $_.ToTable.Name -eq $tn) -or
    ($_.FromTable.Name -eq $tn -and $_.ToTable.Name -eq "Strategy_Lookup")
}

if ($hasStratRel) {
    Write-Host "`n[SKIP] Strategy relationship exists"
} elseif ($stratT) {
    Write-Host "`n[CREATE] Strategy_Lookup[strategy] -> $tn[strategy]..."
    $fromCol2 = $stratT.Columns | Where-Object { $_.Name -eq "strategy" }
    $toCol2 = $holly.Columns | Where-Object { $_.Name -eq "strategy" }

    if ($fromCol2 -and $toCol2) {
        $rel2 = New-Object Microsoft.AnalysisServices.Tabular.SingleColumnRelationship
        $rel2.Name = "Strategy_to_HollyStrategy"
        $rel2.FromColumn = $fromCol2
        $rel2.ToColumn = $toCol2
        $rel2.FromCardinality = [Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality]::One
        $rel2.ToCardinality = [Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality]::Many
        $model.Relationships.Add($rel2)
        Write-Host "  Added"
    } else {
        Write-Host "  ERROR: strategy cols not found"
    }
}

# ============================================================
# FINAL SAVE
# ============================================================

Write-Host "`nFinal save..."
try {
    $model.SaveChanges()
    Write-Host "SUCCESS!"
    Write-Host "`nRelationships ($($model.Relationships.Count)):"
    foreach ($r in $model.Relationships) {
        Write-Host "  $($r.FromTable.Name)[$($r.FromColumn.Name)] -> $($r.ToTable.Name)[$($r.ToColumn.Name)]"
    }
    Write-Host "`nModel summary:"
    foreach ($tbl in $model.Tables) {
        Write-Host "  $($tbl.Name): $($tbl.Columns.Count) cols, $($tbl.Measures.Count) measures"
    }
} catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Host "Inner: $($_.Exception.InnerException.Message)" }
}

$server.Disconnect()
Write-Host "`nDone."
