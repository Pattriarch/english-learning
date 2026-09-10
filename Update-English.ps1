# Reviewed update for the local English app. Run only when ready to restart port 8777.
$ErrorActionPreference = 'Stop'
$englishAppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'app'))
$englishBinary = Join-Path $englishAppRoot 'english.exe'
$englishNext = Join-Path $englishAppRoot 'data\english-next.exe'
$englishProgress = Join-Path $englishAppRoot 'data\studio\progress.json'
$englishStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$englishBinaryBackup = Join-Path $englishAppRoot "data\english-before-update-$englishStamp.exe"
$englishProgressBackup = Join-Path $englishAppRoot "data\progress-before-update-$englishStamp.json"

$englishListener = Get-NetTCPConnection -LocalPort 8777 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$englishProcess = $null
if ($englishListener) {
    $englishProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($englishListener.OwningProcess)"
    if ($englishProcess.ExecutablePath -ne $englishBinary) { throw 'Port 8777 belongs to another process; nothing was stopped.' }
    $englishDataFlag = [regex]::Match($englishProcess.CommandLine, '(?:^|\s)--?data(?:=|\s+)(?:"([^"]+)"|(\S+))')
    if ($englishDataFlag.Success) {
        $englishDataValue = if ($englishDataFlag.Groups[1].Success) { $englishDataFlag.Groups[1].Value } else { $englishDataFlag.Groups[2].Value }
        $englishResolvedData = if ([IO.Path]::IsPathRooted($englishDataValue)) { [IO.Path]::GetFullPath($englishDataValue) } else { [IO.Path]::GetFullPath((Join-Path $englishAppRoot $englishDataValue)) }
        if ($englishResolvedData.TrimEnd('\','/') -ne (Join-Path $englishAppRoot 'data\studio')) {
            throw 'The running app uses another profile. Verify its data path before updating.'
        }
    }
}

Push-Location -LiteralPath $englishAppRoot
try {
    & go build -mod=readonly -o $englishNext ./cmd/english
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. The running app was not changed.' }
    Copy-Item -LiteralPath $englishBinary -Destination $englishBinaryBackup
    $englishStarted = $null
    if ($englishProcess) {
        $englishCurrent = Get-CimInstance Win32_Process -Filter "ProcessId=$($englishProcess.ProcessId)"
        if (-not $englishCurrent -or $englishCurrent.CreationDate -ne $englishProcess.CreationDate -or $englishCurrent.ExecutablePath -ne $englishBinary) {
            throw 'The running process changed during the build. Nothing was stopped.'
        }
        $englishProcessHandle = Get-Process -Id $englishProcess.ProcessId -ErrorAction Stop
        Stop-Process -Id $englishProcess.ProcessId -ErrorAction Stop
        $englishProcessHandle.WaitForExit()
    }
    try {
    Copy-Item -LiteralPath $englishProgress -Destination $englishProgressBackup
    $englishHash = (Get-FileHash -LiteralPath $englishProgress -Algorithm SHA256).Hash
    Copy-Item -LiteralPath $englishNext -Destination $englishBinary -Force
    $englishStarted = Start-Process -FilePath $englishBinary -WorkingDirectory $englishAppRoot -ArgumentList @('--addr','127.0.0.1:8777','--data','data/studio') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $englishAppRoot 'english.stdout.log') -RedirectStandardError (Join-Path $englishAppRoot 'english.stderr.log') -PassThru
    $englishReady = $null
    for ($englishTry = 0; $englishTry -lt 12; $englishTry++) {
        try { $englishReady = Invoke-RestMethod -Uri 'http://127.0.0.1:8777/api/bootstrap' -TimeoutSec 2; break }
        catch { Start-Sleep -Milliseconds 500 }
    }
    $englishReader = if ($englishReady) { Invoke-RestMethod -Uri 'http://127.0.0.1:8777/api/library/unit/grammar-intermediate-003' -TimeoutSec 5 } else { $null }
    if (-not $englishReady -or $englishReady.pronunciation.lessons.Count -lt 16 -or -not $englishReader.taskVersions) {
        throw "The update did not pass startup verification. Backups: $englishBinaryBackup and $englishProgressBackup"
    }
    [pscustomobject]@{
        ProcessId = $englishStarted.Id
        PronunciationLessons = $englishReady.pronunciation.lessons.Count
        ProgressUnchanged = ($englishHash -eq (Get-FileHash -LiteralPath $englishProgress -Algorithm SHA256).Hash)
        ProgressBackup = $englishProgressBackup
        VersionedBookChecks = $englishReader.taskVersions
        URL = 'http://127.0.0.1:8777/#/today'
    }
    }
    catch {
        $englishFailure = $_
        if ($englishStarted -and -not $englishStarted.HasExited) { Stop-Process -Id $englishStarted.Id -ErrorAction SilentlyContinue; $englishStarted.WaitForExit() }
        Copy-Item -LiteralPath $englishBinaryBackup -Destination $englishBinary -Force
        Start-Process -FilePath $englishBinary -WorkingDirectory $englishAppRoot -ArgumentList @('--addr','127.0.0.1:8777','--data','data/studio') -WindowStyle Hidden
        throw "Update failed; the previous executable was restored. Progress was not rolled back. $englishFailure"
    }
}
finally { Pop-Location }
