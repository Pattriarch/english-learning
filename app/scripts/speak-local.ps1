param(
    [Parameter(Mandatory=$true)][string]$InputPath,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [Parameter(Mandatory=$true)][string]$MetadataPath
)
$ErrorActionPreference = 'Stop'
$speechUTF8 = New-Object System.Text.UTF8Encoding($false)
$speechRequest = [IO.File]::ReadAllText($InputPath, $speechUTF8) | ConvertFrom-Json
$speechText = [string]$speechRequest.text
if ($speechRequest.lang -ne 'en-US' -or [string]::IsNullOrWhiteSpace($speechText) -or $speechUTF8.GetByteCount($speechText) -gt 8000 -or $speechText.Contains([string][char]0)) {
    throw 'Invalid local speech request.'
}
Add-Type -AssemblyName System.Speech
$localSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $localVoice = $localSynth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'en-US' } | ForEach-Object { $_.VoiceInfo } | Sort-Object @{Expression={ if ($_.Name -like '*Zira*') { 0 } else { 1 } }}, Name | Select-Object -First 1
    if ($null -eq $localVoice) { throw 'Install an English (United States) Windows speech voice.' }
    $localSynth.SelectVoice($localVoice.Name)
    $localSynth.Rate = 0
    $localSynth.Volume = 100
    $localFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo -ArgumentList 22050, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
    $localSynth.SetOutputToWaveFile($OutputPath, $localFormat)
    # Speak is plain-text. It does not evaluate PowerShell expressions or SSML.
    $localSynth.Speak($speechText)
    $localSynth.SetOutputToNull()
    $localWAV = Get-Item -LiteralPath $OutputPath
    if ($localWAV.Length -le 44 -or $localWAV.Length -gt 33554432) { throw 'Invalid speech output size.' }
    $localMetadata = @{voice=$localVoice.Name;culture=$localVoice.Culture.Name} | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($MetadataPath, $localMetadata, $speechUTF8)
}
finally {
    try { $localSynth.SetOutputToNull() } finally { $localSynth.Dispose() }
}
