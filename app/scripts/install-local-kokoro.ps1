[CmdletBinding()]
param(
    [string]$AppDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')),
    [string]$PythonPath = ''
)
$ErrorActionPreference = 'Stop'
$ttsDirectory = [IO.Path]::GetFullPath((Join-Path $AppDirectory 'data\local-kokoro'))
[IO.Directory]::CreateDirectory($ttsDirectory) | Out-Null
if (-not $PythonPath) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $PythonPath = $bundledPython }
    else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if ($pythonCommand) { $PythonPath = $pythonCommand.Source }
        else { throw 'Install Python 3.12, then run this script with -PythonPath pointing to python.exe.' }
    }
}
$ttsPython = Join-Path $ttsDirectory 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $ttsPython)) {
    & $PythonPath -c 'import sys; assert sys.version_info[:2] == (3, 12), "Use Python 3.12 for this verified installation"'
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required for the verified dependency set.' }
    & $PythonPath -m venv (Join-Path $ttsDirectory 'venv')
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated TTS environment.' }
}
& $ttsPython -m pip install --only-binary=:all: -r (Join-Path $PSScriptRoot 'kokoro-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'TTS dependencies could not be installed.' }
$ttsAssets = @(
    @{name='kokoro-v1.0.onnx';size=325532387;sha256='7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5'},
    @{name='voices-v1.0.bin';size=28214398;sha256='bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'}
)
$oldTTSProgress = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'
try {
    foreach ($asset in $ttsAssets) {
        $asset.url = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/' + $asset.name
        $target = Join-Path $ttsDirectory $asset.name
        if (-not (Test-Path -LiteralPath $target)) {
            $download = $target + '.download-' + [Guid]::NewGuid().ToString('N')
            Invoke-WebRequest -Uri $asset.url -OutFile $download -UseBasicParsing
            if ((Get-Item -LiteralPath $download).Length -ne $asset.size -or
                (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) {
                throw ('Downloaded model does not match the pinned release: ' + $asset.name)
            }
            Move-Item -LiteralPath $download -Destination $target
        }
        if ((Get-Item -LiteralPath $target).Length -ne $asset.size -or
            (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) {
            throw ('Existing model does not match the pinned release: ' + $asset.name)
        }
        Write-Host ('Verified ' + $asset.name)
    }
    Invoke-WebRequest 'https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/LICENSE' -OutFile (Join-Path $ttsDirectory 'LICENSE.kokoro-onnx.txt') -UseBasicParsing
    Invoke-WebRequest 'https://huggingface.co/hexgrad/Kokoro-82M/raw/main/README.md' -OutFile (Join-Path $ttsDirectory 'MODEL-CARD.md') -UseBasicParsing
    @{version=1;model='kokoro-v1.0';runtime='kokoro-onnx 0.6.1';installedAt=[DateTime]::UtcNow.ToString('o');assets=$ttsAssets} |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ttsDirectory 'install-receipt.json') -Encoding utf8
    Write-Host 'Kokoro installed. Start English, then choose a voice in Settings.'
} finally { $ProgressPreference = $oldTTSProgress }
