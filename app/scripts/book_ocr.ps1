param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$utf8 = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
$asyncMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-Operation($Operation, [Type]$ResultType) {
    $task = $asyncMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    $task.Result
}
function Read-Page([string]$Path, [int]$PageNumber) {
    $file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
    $stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $bitmap = $null
    try {
        $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        if ($bitmap.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $bitmap.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { throw 'Rendered page exceeds the OCR engine image limit.' }
        $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $lines = @($result.Lines | ForEach-Object {
            $words = @($_.Words | ForEach-Object { @{text=$_.Text;x=$_.BoundingRect.X;y=$_.BoundingRect.Y;width=$_.BoundingRect.Width;height=$_.BoundingRect.Height} })
            @{text=$_.Text;words=$words}
        })
        return @{page=$PageNumber;text=($lines.text -join "`n");lines=$lines;width=$bitmap.PixelWidth;height=$bitmap.PixelHeight}
    } finally {
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        $stream.Dispose()
    }
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('en-US')))
if ($null -eq $engine) { throw 'English Windows OCR language pack is not installed.' }
$manifest = [IO.File]::ReadAllText([IO.Path]::GetFullPath($ManifestPath), $utf8) | ConvertFrom-Json
$done = 0
foreach ($unit in $manifest.units) {
    $pages = @()
    $issues = @()
    foreach ($page in $unit.renderedPages) {
        try {
            $record = Read-Page $page.path $page.page
            $pages += $record
            if ($record.text.Length -lt 700) { $issues += "Page $($page.page): unusually little OCR text ($($record.text.Length) characters); review source image." }
        } catch {
            $issues += "Page $($page.page): OCR failed: $($_.Exception.Message)"
            $pages += @{page=$page.page;text='';lines=@();error=$_.Exception.Message}
        }
    }
    $result = [ordered]@{
        unitId=$unit.unitId;bookId=$unit.bookId;title=$unit.title;pages=@($unit.startPage,$unit.endPage)
        source='ocr';text=($pages.text -join "`n`n");pageTexts=$pages
        quality=@{engine='Windows.Media.Ocr en-US';confidence=$null;confidenceNote='Windows OCR does not expose recognition confidence. Text needs visual verification, especially phonetic symbols and multi-column exercises.';complete=(@($pages | Where-Object { $_.text.Length -eq 0 }).Count -eq 0);pageCount=$pages.Count;characterCount=($pages.text -join "`n`n").Length;issues=$issues;renderDpi=$manifest.renderDpi;readingOrder='OCR line order, with word bounding boxes preserved for layout reconstruction';visualVerified=$false}
        extractedAt=[DateTime]::UtcNow.ToString('o')
    }
    $json = $result | ConvertTo-Json -Depth 14 -Compress
    $tempPath = "$($unit.outputPath).ocr.tmp"
    [IO.File]::WriteAllText($tempPath, $json, $utf8)
    Move-Item -LiteralPath $tempPath -Destination $unit.outputPath -Force
    $done += 1
    Write-Output "$($manifest.bookId) $done/$($manifest.units.Count) $($unit.unitId): $($result.quality.characterCount) characters, $($issues.Count) issues"
}
