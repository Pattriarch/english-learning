$ErrorActionPreference = 'Stop'
$appDirectory = Join-Path $PSScriptRoot 'app'
Set-Location -LiteralPath $appDirectory
$url = 'http://127.0.0.1:8777'
try {
    & (Join-Path $appDirectory 'scripts\start-local-kokoro.ps1') -AppDirectory $appDirectory | Out-Null
} catch { Write-Warning "Local speech synthesis could not start: $($_.Exception.Message)" }
try {
    & (Join-Path $appDirectory 'scripts\start-local-whisper.ps1') -AppDirectory $appDirectory | Out-Null
} catch { Write-Warning "Local speech recognition could not start: $($_.Exception.Message)" }
try {
    $existing = Invoke-RestMethod "$url/api/bootstrap" -TimeoutSec 2
    if ($existing.state.version -eq 1) { Start-Process $url; exit 0 }
} catch {}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    if (Test-Path -LiteralPath (Join-Path $appDirectory 'english.exe')) {
        Start-Process -FilePath (Join-Path $appDirectory 'english.exe') -WorkingDirectory $appDirectory -WindowStyle Hidden
    } else { throw 'Install Go 1.25+ from https://go.dev/dl/ and run again.' }
} else {
    Write-Host 'Building English...'
    & go build -mod=readonly -o english.exe ./cmd/english
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. See the output above.' }
    Start-Process -FilePath (Join-Path $appDirectory 'english.exe') -WorkingDirectory $appDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $appDirectory 'english.stdout.log') -RedirectStandardError (Join-Path $appDirectory 'english.stderr.log')
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $ready = Invoke-RestMethod "$url/api/bootstrap" -TimeoutSec 1
        if ($ready.state.version -eq 1) { Start-Process $url; exit 0 }
    } catch {}
}
throw 'Server did not start. See app/english.stderr.log.'
