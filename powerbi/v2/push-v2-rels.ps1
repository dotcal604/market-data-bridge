# Fix relationships — FromColumn = many side, ToColumn = one side
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
$dateT = $model.Tables | Where-Object { $_.Name -eq "Date_Table" }
$stratT = $model.Tables | Where-Object { $_.Name -eq "Strategy_Lookup" }

Write-Host "Existing relationships: $($model.Relationships.Count)"

# Remove any failed relationships
$toRemove = @()
foreach ($r in $model.Relationships) {
    if ($r.Name -eq "Date_to_TradeDate" -or $r.Name -eq "Strategy_to_HollyStrategy") {
        $toRemove += $r.Name
    }
}
foreach ($name in $toRemove) {
    $r = $model.Relationships | Where-Object { $_.Name -eq $name }
    if ($r) {
        $model.Relationships.Remove($r)
        Write-Host "  Removed: $name"
    }
}

# Date relationship: holly_analytics[trade_date] (many) -> Date_Table[Date] (one)
Write-Host "`n[CREATE] $tn[trade_date] (M) -> Date_Table[Date] (1)..."
$manyCol = $holly.Columns | Where-Object { $_.Name -eq "trade_date" }
$oneCol = $dateT.Columns | Where-Object { $_.Name -eq "Date" }

if ($manyCol -and $oneCol) {
    $rel = New-Object Microsoft.AnalysisServices.Tabular.SingleColumnRelationship
    $rel.Name = "Date_to_TradeDate"
    $rel.FromColumn = $manyCol
    $rel.ToColumn = $oneCol
    $rel.FromCardinality = [Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality]::Many
    $rel.ToCardinality = [Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality]::One
    $model.Relationships.Add($rel)
    Write-Host "  Added"
} else {
    Write-Host "  ERROR: trade_date=$($null -ne $manyCol), Date=$($null -ne $oneCol)"
}

# Strategy relationship: holly_analytics[strategy] (many) -> Strategy_Lookup[strategy] (one)
Write-Host "`n[CREATE] $tn[strategy] (M) -> Strategy_Lookup[strategy] (1)..."
$manyCol2 = $holly.Columns | Where-Object { $_.Name -eq "strategy" }
$oneCol2 = $stratT.Columns | Where-Object { $_.Name -eq "strategy" }

if ($manyCol2 -and $oneCol2) {
    $rel2 = New-Object Microsoft.AnalysisServices.Tabular.SingleColumnRelationship
    $rel2.Name = "Strategy_to_HollyStrategy"
    $rel2.FromColumn = $manyCol2
    $rel2.ToColumn = $oneCol2
    $rel2.FromCardinality = [Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality]::Many
    $rel2.ToCardinality = [Microsoft.AnalysisServices.Tabular.RelationshipEndCardinality]::One
    $model.Relationships.Add($rel2)
    Write-Host "  Added"
} else {
    Write-Host "  ERROR: strategy cols not found"
}

# Save
Write-Host "`nSaving..."
try {
    $model.SaveChanges()
    Write-Host "SUCCESS!"
    Write-Host "Relationships ($($model.Relationships.Count)):"
    foreach ($r in $model.Relationships) {
        Write-Host "  $($r.FromTable.Name)[$($r.FromColumn.Name)] -> $($r.ToTable.Name)[$($r.ToColumn.Name)]"
    }
    foreach ($tbl in $model.Tables) {
        Write-Host "  $($tbl.Name): $($tbl.Columns.Count) cols, $($tbl.Measures.Count) measures"
    }
} catch {
    Write-Host "SAVE ERROR: $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Host "Inner: $($_.Exception.InnerException.Message)" }
}

$server.Disconnect()
Write-Host "Done."
