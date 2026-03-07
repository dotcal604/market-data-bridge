$deckPath = 'C:\Users\dotca\source\market-data-bridge\analytics\holly_exit\output\reports\trade_mapping\case_studies_deck.pptx'
$outDir = 'C:\Users\dotca\source\market-data-bridge\analytics\holly_exit\output\reports\trade_mapping\slide_images'

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$ppt = New-Object -ComObject PowerPoint.Application
$pres = $ppt.Presentations.Open($deckPath, $true, $false, $false)
$pres.Export($outDir, 'jpg')
$pres.Close()
$ppt.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
Write-Output 'Export complete'
Get-ChildItem $outDir -Filter '*.jpg' | Select-Object Name
