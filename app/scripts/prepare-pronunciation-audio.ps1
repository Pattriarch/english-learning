# Windows PowerShell 5.1: prepare offline speech samples for browsers without TTS voices.
$ErrorActionPreference = 'Stop'

$pronunciationAppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pronunciationContentPath = Join-Path $pronunciationAppRoot 'content\pronunciation.json'
$pronunciationOutputRoot = [IO.Path]::GetFullPath((Join-Path $pronunciationAppRoot 'studio\assets\pronunciation-audio'))
[IO.Directory]::CreateDirectory($pronunciationOutputRoot) | Out-Null
$pronunciationCatalog = Get-Content -LiteralPath $pronunciationContentPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pronunciationTexts = New-Object 'System.Collections.Generic.SortedSet[string]' ([StringComparer]::Ordinal)

function Add-PronunciationText {
    param([AllowNull()][object]$Text)
    if ($null -eq $Text) { return }
    $sampleText = [string]$Text
    if ([string]::IsNullOrWhiteSpace($sampleText)) { return }
    # Never send IPA, stress annotations, Russian notes, or markup to the voice.
    if ($sampleText -notmatch '^[A-Za-z0-9\s.,!?''":;()\-]+$' -or $sampleText -notmatch '[A-Za-z]') {
        throw "Audio sample is not clean English: $sampleText"
    }
    [void]$pronunciationTexts.Add($sampleText)
}

function Add-PronunciationField {
    param([object]$Item, [string]$AudioField, [string]$FallbackField)
    $audioProperty = $Item.PSObject.Properties[$AudioField]
    if ($null -ne $audioProperty) {
        # Explicit null means the contrast cannot be demonstrated by neutral TTS.
        if ($null -ne $audioProperty.Value) { Add-PronunciationText $audioProperty.Value }
        return
    }
    Add-PronunciationText $Item.$FallbackField
}

foreach ($pronunciationLesson in $pronunciationCatalog.lessons) {
    foreach ($soundGroup in $pronunciationLesson.sounds) {
        foreach ($soundExample in $soundGroup.examples) {
            Add-PronunciationField $soundExample 'audio' 'word'
        }
    }
    foreach ($contrastPair in $pronunciationLesson.contrastPairs) {
        Add-PronunciationText $contrastPair.leftAudio
        Add-PronunciationText $contrastPair.rightAudio
    }
    foreach ($sentenceExample in $pronunciationLesson.examples) {
        Add-PronunciationText $sentenceExample.text
    }
}

Add-Type -AssemblyName System.Speech
$pronunciationSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$pronunciationHash = [Security.Cryptography.SHA256]::Create()
$pronunciationClips = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
$pronunciationUTF8 = New-Object Text.UTF8Encoding($false)
try {
    $availableVoices = @($pronunciationSynth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })
    $chosenVoice = $availableVoices | Where-Object { $_.Culture.Name -eq 'en-US' } | Sort-Object @{Expression={ if ($_.Name -like '*Zira*') { 0 } else { 1 } }}, Name | Select-Object -First 1
    if ($null -eq $chosenVoice) {
        $chosenVoice = $availableVoices | Where-Object { $_.Culture.Name -eq 'en-GB' } | Select-Object -First 1
    }
    if ($null -eq $chosenVoice) { throw 'Install an English Windows speech voice (en-GB or en-US) before preparing pronunciation audio.' }
    $pronunciationSynth.SelectVoice($chosenVoice.Name)
    $pronunciationSynth.Rate = 0
    $pronunciationSynth.Volume = 100

    foreach ($sampleText in $pronunciationTexts) {
        $sampleHash = [BitConverter]::ToString($pronunciationHash.ComputeHash($pronunciationUTF8.GetBytes($sampleText))).Replace('-', '').ToLowerInvariant()
        $sampleFilename = $sampleHash + '.wav'
        $samplePath = Join-Path $pronunciationOutputRoot $sampleFilename
        $sampleStream = [IO.File]::Open($samplePath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $pronunciationSynth.SetOutputToWaveStream($sampleStream)
            $pronunciationSynth.Speak($sampleText)
        }
        finally {
            try { $pronunciationSynth.SetOutputToNull() }
            finally { $sampleStream.Dispose() }
        }
        if ((Get-Item -LiteralPath $samplePath).Length -le 44) { throw "Empty audio sample: $sampleText" }
        $pronunciationClips.Add($sampleText, $sampleFilename)
    }

    $pronunciationManifest = [ordered]@{
        voice = $chosenVoice.Name
        culture = $chosenVoice.Culture.Name
        clips = $pronunciationClips
    }
    $pronunciationManifestPath = Join-Path $pronunciationOutputRoot 'index.json'
    [IO.File]::WriteAllText($pronunciationManifestPath, ($pronunciationManifest | ConvertTo-Json -Depth 5), $pronunciationUTF8)
    Write-Output ("Prepared {0} offline pronunciation samples using {1} ({2})." -f $pronunciationClips.Count, $chosenVoice.Name, $chosenVoice.Culture.Name)
    Write-Output $pronunciationManifestPath
}
finally {
    $pronunciationSynth.Dispose()
    $pronunciationHash.Dispose()
}
