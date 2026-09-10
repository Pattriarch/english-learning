[CmdletBinding()]
param(
    [string]$AppDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')),
    [switch]$ForceStart
)
$ErrorActionPreference = 'Stop'
$asrDirectory = [IO.Path]::GetFullPath((Join-Path $AppDirectory 'data\local-whisper'))
$asrExecutable = Join-Path $asrDirectory 'bin\Release\whisper-server.exe'
$asrModel = Join-Path $asrDirectory 'ggml-base.en.bin'
$asrURL = 'http://127.0.0.1:8080/inference'
if (-not (Test-Path -LiteralPath $asrExecutable) -or -not (Test-Path -LiteralPath $asrModel)) {
    return [pscustomobject]@{status='not-installed';endpoint=$asrURL}
}
if (-not $ForceStart) {
    $asrSettingsPath = Join-Path $AppDirectory 'data\studio\settings.json'
    if (-not (Test-Path -LiteralPath $asrSettingsPath)) { return [pscustomobject]@{status='not-configured'} }
    try { $asrConfiguration = Get-Content -LiteralPath $asrSettingsPath -Raw | ConvertFrom-Json }
    catch { throw 'Cannot read local speech settings.' }
    if ($asrConfiguration.whisperUrl -ne $asrURL) { return [pscustomobject]@{status='different-endpoint'} }
}

# A file lock prevents two clicks on Start-English from spawning competing servers.
$asrLock = $null
for ($asrTry=0; $asrTry -lt 40; $asrTry++) {
    try { $asrLock=[IO.File]::Open((Join-Path $asrDirectory 'start.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); break }
    catch [IO.IOException] { Start-Sleep -Milliseconds 250 }
}
if (-not $asrLock) { throw 'Local speech startup is already in progress. Try again shortly.' }
try {
    $asrListeners = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)
    $asrProcess = $null
    if ($asrListeners.Count) {
        if (@($asrListeners | Where-Object {$_.LocalAddress -ne '127.0.0.1'}).Count) {
            throw 'Port 8080 is used by another service. No process was stopped.'
        }
        $asrOwnerIDs = @($asrListeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($asrOwnerIDs.Count -ne 1) { throw 'Port 8080 has unexpected owners. No process was stopped.' }
        $asrProcess = Get-Process -Id $asrOwnerIDs[0] -ErrorAction Stop
        if ($asrProcess.Path -ne $asrExecutable) { throw 'Port 8080 is used by another service. No process was stopped.' }
    } else {
        $asrExpectedModel = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'
        if ((Get-FileHash -LiteralPath $asrModel -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asrExpectedModel) {
            throw 'The local speech model does not match the verified base.en model.'
        }
        # Relative model/public paths also work when the Windows account name is Cyrillic.
        [IO.Directory]::CreateDirectory((Join-Path $asrDirectory 'public')) | Out-Null
        $asrArguments = @('--host','127.0.0.1','--port','8080','--model','ggml-base.en.bin',
            '--language','en','--threads','6','--no-gpu','--public','public')
        $asrProcess = Start-Process -FilePath $asrExecutable -ArgumentList $asrArguments -WorkingDirectory $asrDirectory `
            -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $asrDirectory 'server.stdout.log') `
            -RedirectStandardError (Join-Path $asrDirectory 'server.stderr.log')
    }
    for ($asrTry=0; $asrTry -lt 60; $asrTry++) {
        $asrProcess.Refresh()
        if ($asrProcess.HasExited) { throw 'The local speech server stopped. See app/data/local-whisper/server.stderr.log.' }
        try {
            $asrHealth=Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 1
            if ($asrHealth.status -eq 'ok') {
                $asrReceipt=[ordered]@{version=1;status='ready';pid=$asrProcess.Id;endpoint=$asrURL;model='base.en';host='127.0.0.1';startedOrCheckedAt=[DateTime]::UtcNow.ToString('o')}
                $asrReceipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $asrDirectory 'server-state.json') -Encoding UTF8
                return [pscustomobject]$asrReceipt
            }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    throw 'Local speech did not become ready within 30 seconds. See app/data/local-whisper/server.stderr.log.'
} finally { $asrLock.Dispose() }
