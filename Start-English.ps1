$ErrorActionPreference = 'Stop'
$appDirectory = Join-Path $PSScriptRoot 'app'
Set-Location -LiteralPath $appDirectory
$url = 'http://127.0.0.1:8790'
function Connect-LocalWhisper($bootstrap) {
    if ($bootstrap.settings.whisperUrl) { return }
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 2
        if ($health.status -ne 'ok') { return }
        $bootstrap.settings.whisperUrl = 'http://127.0.0.1:8080/inference'
        $body = [Text.Encoding]::UTF8.GetBytes(($bootstrap.settings | ConvertTo-Json -Depth 10))
        Invoke-RestMethod "$url/api/settings" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 5 | Out-Null
    } catch { Write-Warning 'Whisper address could not be saved. Set http://127.0.0.1:8080/inference in Settings.' }
}
try {
    & (Join-Path $appDirectory 'scripts\start-local-kokoro.ps1') -AppDirectory $appDirectory | Out-Null
} catch { Write-Warning "Local speech synthesis could not start: $($_.Exception.Message)" }
try {
    & (Join-Path $appDirectory 'scripts\start-local-whisper.ps1') -AppDirectory $appDirectory | Out-Null
} catch { Write-Warning "Local speech recognition could not start: $($_.Exception.Message)" }
try {
    $existing = Invoke-RestMethod "$url/api/bootstrap" -TimeoutSec 2
    if ($existing.state.version -eq 1) { Connect-LocalWhisper $existing; Start-Process $url; exit 0 }
} catch {}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    if (Test-Path -LiteralPath (Join-Path $appDirectory 'english.exe')) {
        Start-Process -FilePath (Join-Path $appDirectory 'english.exe') -ArgumentList '-addr','127.0.0.1:8790' -WorkingDirectory $appDirectory -WindowStyle Hidden
    } else { throw 'Install Go 1.25+ from https://go.dev/dl/ and run again.' }
} else {
    Write-Host 'Building English...'
    & go build -mod=readonly -o english.exe ./cmd/english
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. See the output above.' }
    Start-Process -FilePath (Join-Path $appDirectory 'english.exe') -ArgumentList '-addr','127.0.0.1:8790' -WorkingDirectory $appDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $appDirectory 'english.stdout.log') -RedirectStandardError (Join-Path $appDirectory 'english.stderr.log')
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $ready = Invoke-RestMethod "$url/api/bootstrap" -TimeoutSec 1
        if ($ready.state.version -eq 1) { Connect-LocalWhisper $ready; Start-Process $url; exit 0 }
    } catch {}
}
throw 'Server did not start. See app/english.stderr.log.'
