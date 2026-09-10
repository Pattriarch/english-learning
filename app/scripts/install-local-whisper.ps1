[CmdletBinding()]
param([string]$AppDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
$ErrorActionPreference = 'Stop'
$asrInstallDirectory = [IO.Path]::GetFullPath((Join-Path $AppDirectory 'data\local-whisper'))
[IO.Directory]::CreateDirectory($asrInstallDirectory) | Out-Null
$asrAssets = @(
    @{name='whisper-bin-x64.zip';url='https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip';size=8361840;sha256='c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d'},
    @{name='ggml-base.en.bin';url='https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';size=147964211;sha256='a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'}
)
$asrOldProgressPreference = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'
try {
    foreach ($asrAsset in $asrAssets) {
        $asrTarget = Join-Path $asrInstallDirectory $asrAsset.name
        if (-not (Test-Path -LiteralPath $asrTarget)) {
            $asrDownload = $asrTarget + '.download-' + [Guid]::NewGuid().ToString('N')
            Invoke-WebRequest -Uri $asrAsset.url -OutFile $asrDownload -UseBasicParsing
            if ((Get-Item -LiteralPath $asrDownload).Length -ne $asrAsset.size -or
                (Get-FileHash -LiteralPath $asrDownload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asrAsset.sha256) {
                throw ('Downloaded asset failed verification: ' + $asrAsset.name)
            }
            Move-Item -LiteralPath $asrDownload -Destination $asrTarget
        }
        if ((Get-Item -LiteralPath $asrTarget).Length -ne $asrAsset.size -or
            (Get-FileHash -LiteralPath $asrTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asrAsset.sha256) {
            throw ('Existing asset differs from the pinned official file: ' + $asrAsset.name)
        }
        Write-Host ('Verified ' + $asrAsset.name)
    }
    $asrBin = Join-Path $asrInstallDirectory 'bin'
    $asrServer = Join-Path $asrBin 'Release\whisper-server.exe'
    if (-not (Test-Path -LiteralPath $asrServer)) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $asrZip = [IO.Compression.ZipFile]::OpenRead((Join-Path $asrInstallDirectory 'whisper-bin-x64.zip'))
        try {
            $asrPrefix = [IO.Path]::GetFullPath($asrBin).TrimEnd('\') + '\'
            foreach ($asrEntry in $asrZip.Entries) {
                $asrDestination = [IO.Path]::GetFullPath((Join-Path $asrBin $asrEntry.FullName))
                if (-not $asrDestination.StartsWith($asrPrefix,[StringComparison]::OrdinalIgnoreCase)) {
                    throw 'The archive contains an unexpected path.'
                }
            }
        } finally { $asrZip.Dispose() }
        Expand-Archive -LiteralPath (Join-Path $asrInstallDirectory 'whisper-bin-x64.zip') -DestinationPath $asrBin -Force
    }
    if (-not (Test-Path -LiteralPath $asrServer)) { throw 'The verified release did not contain whisper-server.exe.' }
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/b4938/LICENSE' `
        -OutFile (Join-Path $asrInstallDirectory 'LICENSE.whisper.cpp.txt') -UseBasicParsing
    Invoke-WebRequest -Uri 'https://huggingface.co/ggerganov/whisper.cpp/raw/main/README.md' `
        -OutFile (Join-Path $asrInstallDirectory 'MODEL-CARD.md') -UseBasicParsing
    @{version=1;release='b4938';license='MIT';installedAt=[DateTime]::UtcNow.ToString('o');assets=$asrAssets} |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $asrInstallDirectory 'install-receipt.json') -Encoding UTF8
    Write-Host 'Installed local English ASR. Start with app/scripts/start-local-whisper.ps1 -ForceStart.'
    Write-Host 'App setting: http://127.0.0.1:8080/inference'
} finally { $ProgressPreference = $asrOldProgressPreference }
