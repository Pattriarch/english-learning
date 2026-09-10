$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$imageDirectory = Join-Path $projectPath 'app\data\catalog-verify'
$ocrScript = Join-Path $PSScriptRoot 'ocr.ps1'
$ocrSource = Get-Content -LiteralPath $ocrScript -Raw
$ocrCommand = [ScriptBlock]::Create($ocrSource.Replace('[Console]::WriteLine($line.Text)', 'Write-Output $line.Text'))
$result = @{}
foreach ($imageFile in (Get-ChildItem -LiteralPath $imageDirectory -Filter '*.png')) {
    $lines = @(& $ocrCommand -ImagePath $imageFile.FullName)
    $result[$imageFile.BaseName] = ($lines -join "`n")
}
$outputFile = Join-Path $imageDirectory 'headers.json'
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outputFile -Encoding UTF8
Write-Output "Verified $($result.Count) unit title strips."
