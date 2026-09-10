[CmdletBinding()]
param([string]$AppDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
$ErrorActionPreference = 'Stop'
$ttsDirectory = [IO.Path]::GetFullPath((Join-Path $AppDirectory 'data\local-kokoro'))
$ttsPython = Join-Path $ttsDirectory 'venv\Scripts\python.exe'
$ttsScript = [IO.Path]::GetFullPath((Join-Path $AppDirectory 'scripts\kokoro_server.py'))
$ttsModel = Join-Path $ttsDirectory 'kokoro-v1.0.onnx'
if (-not (Test-Path -LiteralPath $ttsPython) -or -not (Test-Path -LiteralPath $ttsModel)) {
    return [pscustomobject]@{status='not-installed';install='app/scripts/install-local-kokoro.ps1'}
}
$ttsLock = $null
for ($ttsTry=0; $ttsTry -lt 80; $ttsTry++) {
    try { $ttsLock=[IO.File]::Open((Join-Path $ttsDirectory 'start.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); break }
    catch [IO.IOException] { Start-Sleep -Milliseconds 250 }
}
if (-not $ttsLock) { throw 'Kokoro startup is already running. Try again shortly.' }
try {
    $ttsBasePythonJSON = & $ttsPython -c 'import json,sys; print(json.dumps(sys._base_executable))'
    if ($LASTEXITCODE -ne 0) { throw 'The local speech Python environment is unavailable.' }
    $ttsBasePython = $ttsBasePythonJSON | ConvertFrom-Json
    $ttsListeners = @(Get-NetTCPConnection -LocalPort 8880 -State Listen -ErrorAction SilentlyContinue)
    if ($ttsListeners.Count) {
        if (@($ttsListeners | Where-Object {$_.LocalAddress -ne '127.0.0.1'}).Count) { throw 'Port 8880 belongs to another service; no process was stopped.' }
        $ttsOwners = @($ttsListeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($ttsOwners.Count -ne 1) { throw 'Port 8880 has unexpected owners; no process was stopped.' }
        $ttsCurrent = Get-CimInstance Win32_Process -Filter "ProcessId=$($ttsOwners[0])"
        if (($ttsCurrent.ExecutablePath -ne $ttsPython -and $ttsCurrent.ExecutablePath -ne $ttsBasePython) -or
            -not $ttsCurrent.CommandLine.Contains($ttsScript) -or -not $ttsCurrent.CommandLine.Contains($ttsDirectory)) {
            throw 'Port 8880 belongs to another service; no process was stopped.'
        }
    } else {
        $expected = @{'kokoro-v1.0.onnx'='7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5';'voices-v1.0.bin'='bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'}
        foreach ($name in $expected.Keys) {
            if ((Get-FileHash -LiteralPath (Join-Path $ttsDirectory $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected[$name]) {
                throw 'The local speech model differs from the verified release. Run the installer to inspect it.'
            }
        }
        $ttsArguments = @('-X','utf8',('"'+$ttsScript+'"'),'--model-directory',('"'+$ttsDirectory+'"'),'--port','8880','--threads','6')
        $ttsLauncher = Start-Process -FilePath $ttsPython -ArgumentList $ttsArguments -WorkingDirectory $AppDirectory -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $ttsDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $ttsDirectory 'server.stderr.log')
    }
    for ($ttsTry=0; $ttsTry -lt 90; $ttsTry++) {
        if ($ttsLauncher -and $ttsLauncher.HasExited) { throw 'Kokoro stopped during startup. See app/data/local-kokoro/server.stderr.log.' }
        try {
            $ttsHealth = Invoke-RestMethod 'http://127.0.0.1:8880/health' -TimeoutSec 1
            if ($ttsHealth.status -eq 'ok' -and $ttsHealth.engine -eq 'kokoro-onnx' -and $ttsHealth.model -eq 'kokoro-v1.0') {
                $ttsListener = Get-NetTCPConnection -LocalPort 8880 -State Listen | Select-Object -First 1
                $ttsState=[ordered]@{version=1;status='ready';pid=$ttsListener.OwningProcess;endpoint='http://127.0.0.1:8880';model='kokoro-v1.0';host='127.0.0.1';checkedAt=[DateTime]::UtcNow.ToString('o')}
                $ttsState | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ttsDirectory 'server-state.json') -Encoding utf8
                return [pscustomobject]$ttsState
            }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    throw 'Kokoro did not become ready. See app/data/local-kokoro/server.stderr.log.'
} finally { $ttsLock.Dispose() }
