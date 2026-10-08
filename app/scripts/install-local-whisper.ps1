[CmdletBinding()]
param(
    [ValidateSet('auto','cuda','cpu')][string]$Accelerator = 'auto',
    [ValidateSet('small.en-q5_1','base.en')][string]$Model = 'small.en-q5_1',
    [string]$PythonPath = ''
)
$ErrorActionPreference = 'Stop'
if (-not $PythonPath) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $PythonPath = $bundledPython }
    else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pythonCommand) { throw 'Install Python 3.12 and Visual Studio Build Tools (Desktop development with C++). CUDA also requires NVIDIA CUDA Toolkit.' }
        $PythonPath = $pythonCommand.Source
    }
}
& $PythonPath (Join-Path $PSScriptRoot 'local_speech.py') install --engine whisper --accelerator $Accelerator --model $Model
if ($LASTEXITCODE -ne 0) { throw 'Whisper installation failed. See the output above. Existing files and processes were kept.' }
Write-Host 'Whisper installed. Open Start-English.cmd and set http://127.0.0.1:8080/inference in Settings.'
