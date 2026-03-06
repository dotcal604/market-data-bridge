# Configure Date_Table sort-by-columns + create relationships
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

foreach ($tbl in $model.Tables) {
    Write-Host "  $($tbl.Name): $($tbl.Columns.Count) cols, $($tbl.Measures.Count) measures"
}

# ============================================================
# 1. CONFIGURE DATE_TABLE
# ============================================================

$dateT = $model.Tables | Where-Object { $_.Name -eq "Date_Table" }
if (-not $dateT) {
    Write-Host "ERROR: Date_Table not found!"
    $server.Disconnect()
    exit 1
}

Write-Host "`nDate_Table columns:"
foreach ($c in $dateT.Columns) {
    Write-Host "  $($c.Name) [$($c.DataType)]"
}

# Sort-by-column (use individual assignments to avoid array issues)
function Set-SortBy($table, $colName, $sortByName) {
    $col = $table.Columns | Where-Object { $_.Name -eq $colName }
    $sortCol = $table.Columns | Where-Object { $_.Name -eq $sortByName }
    if ($col -and $sortCol) {
        $col.SortByColumn = $sortCol
        Write-Host "  Sort: $colName by $sortByName"
    } else {
        Write-Host "  WARN: $colName or $sortByName not found"
    }
}

Set-SortBy $dateT "MonthName" "Month"
Set-SortBy $dateT "MonthNameShort" "Month"
Set-SortBy $dateT "DayName" "DayOfWeek"
Set-SortBy $dateT "DayNameShort" "DayOfWeek"
Set-SortBy $dateT "MonthYear" "YearMonth"
Set-SortBy $dateT "QuarterLabel" "Quarter"
Set-SortBy $dateT "YearQuarter" "YearMonth"

# Hide utility columns
foreach ($h in @("YearMonth", "DayOfWeek")) {
    $col = $dateT.Columns | Where-Object { $_.Name -eq $h }
    if ($col) { $col.IsHidden = $true; Write-Host "  Hide: $h" }
}

# Mark Date as key
$dateCol = $dateT.Columns | Where-Object { $_.Name -eq "Date" }
if ($dateCol) {
    $dateCol.IsKey = $true
    Write-Host "  Set Date as key"
}

# ============================================================
# 2. CREATE RELATIONSHIPS
# ============================================================

$holly = $model.Tables | Where-Object { $_.Name -eq $tn }
$stratT = $model.Tables | Where-Object { $_.Name -eq "Strategy_Lookup" }

# Date relationship
$hasDateRel = $false
foreach ($r in $model.Relationships) {
    if ($r.FromTable.Name -eq "Date_Table" -or $r.ToTable.Name -eq "Date_Table") {
        $hasDateRel = $true
        break
    }
}

if ($hasDateRel) {
    Write-Host "`n[SKIP] Date relationship exists"
} else {
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
        Write-Host "  ERROR: Date=$($null -ne $fromCol), trade_date=$($null -ne $toCol)"
    }
}

# Strategy relationship
$hasStratRel = $false
foreach ($r in $model.Relationships) {
    if ($r.FromTable.Name -eq "Strategy_Lookup" -or $r.ToTable.Name -eq "Strategy_Lookup") {
        $hasStratRel = $true
        break
    }
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
} else {
    Write-Host "`nWARN: Strategy_Lookup table not found"
}

# ============================================================
# SAVE
# ============================================================

Write-Host "`nSaving..."
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
Write-Host "Done."
