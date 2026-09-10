# Windows PowerShell 5.1: local English example audio for browsers without voices.
[CmdletBinding()]
param([switch]$Watch, [int]$PollSeconds = 20)
$ErrorActionPreference = 'Stop'

$bookAppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bookLessonsRoot = Join-Path $bookAppRoot 'content\book-lessons'
$bookAudioRoot = Join-Path $bookAppRoot 'studio\book-audio'
$bookDataRoot = Join-Path $bookAppRoot 'data'
$bookBatchPath = Join-Path $bookDataRoot 'book-build-status.json'
$bookAudioStatusPath = Join-Path $bookDataRoot 'book-audio-status.json'
$bookAudioErrorPath = Join-Path $bookDataRoot 'book-audio-errors.jsonl'
$bookUTF8 = New-Object Text.UTF8Encoding($false)
[IO.Directory]::CreateDirectory($bookAudioRoot) | Out-Null
[IO.Directory]::CreateDirectory($bookDataRoot) | Out-Null

function Write-BookAtomicText {
    param([string]$Path, [string]$Text)
    $bookTemp = $Path + '.tmp-' + $PID + '-' + [Guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($bookTemp, $Text, $bookUTF8)
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($bookTemp, $Path, [NullString]::Value) }
    else { [IO.File]::Move($bookTemp, $Path) }
}

function Write-BookAudioError {
    param([string]$UnitId, [string]$Message)
    $record = @{ at = [DateTime]::UtcNow.ToString('o'); unitId = $UnitId; error = $Message }
    [IO.File]::AppendAllText($bookAudioErrorPath, (($record | ConvertTo-Json -Compress) + [Environment]::NewLine), $bookUTF8)
}

function Test-BookWave {
    param([string]$Path)
    if (-not [IO.File]::Exists($Path)) { return $false }
    $bookWaveStream = $null
    try {
        $bookWaveStream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        if ($bookWaveStream.Length -le 44) { return $false }
        $bookHeader = New-Object byte[] 12
        if ($bookWaveStream.Read($bookHeader, 0, 12) -ne 12) { return $false }
        return ([Text.Encoding]::ASCII.GetString($bookHeader, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($bookHeader, 8, 4) -eq 'WAVE')
    }
    catch { return $false }
    finally { if ($null -ne $bookWaveStream) { $bookWaveStream.Dispose() } }
}

function Convert-BookSpeechText {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { throw 'Empty English example.' }
    $spoken = $Text.Normalize([Text.NormalizationForm]::FormKC)
    foreach ($number in @(0x2018, 0x2019, 0x201B, 0x02BC)) { $spoken = $spoken.Replace([char]$number, [char]0x27) }
    foreach ($number in @(0x201C, 0x201D, 0x201E)) { $spoken = $spoken.Replace([char]$number, [char]0x22) }
    foreach ($number in @(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212)) { $spoken = $spoken.Replace([char]$number, [char]0x2D) }
    $spoken = $spoken.Replace([string][char]0x2026, '...')
    # Cafe/cafe-with-acute and accented names are English text too. Remove only
    # combining accents; Russian/Greek/IPA base letters still fail validation.
    $bookAsciiBuilder = New-Object Text.StringBuilder
    foreach ($bookChar in $spoken.Normalize([Text.NormalizationForm]::FormD).ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($bookChar) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$bookAsciiBuilder.Append($bookChar) }
    }
    $spoken = $bookAsciiBuilder.ToString()
    # Currency and percentage symbols are ordinary English examples, not IPA.
    # Keep the exact numeric value and scale before naming its currency.
    $bookCurrencySymbols = '$' + [char]0xA3 + [char]0x20AC
    $bookCurrencyPattern = '([' + [regex]::Escape($bookCurrencySymbols) + '])\s*(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(thousand|million|billion|trillion))?(?![\dA-Za-z]|,\d|\.\d)'
    $spoken = [regex]::Replace($spoken, $bookCurrencyPattern, {
        param($bookMatch)
        $bookAmount = $bookMatch.Groups[2].Value
        $bookScale = $bookMatch.Groups[3].Value
        $bookUnit = switch ([int][char]$bookMatch.Groups[1].Value) { 0x24 { 'dollar' }; 0xA3 { 'pound' }; 0x20AC { 'euro' } }
        [decimal]$bookAmountValue = 0
        $bookSingular = [decimal]::TryParse($bookAmount, [Globalization.NumberStyles]::Number, [Globalization.CultureInfo]::InvariantCulture, [ref]$bookAmountValue) -and $bookAmountValue -eq 1 -and -not $bookScale
        if (-not $bookSingular) { $bookUnit += 's' }
        if ($bookScale) { return $bookAmount + ' ' + $bookScale + ' ' + $bookUnit }
        return $bookAmount + ' ' + $bookUnit
    })
    $spoken = [regex]::Replace($spoken, '(?<=\d)\s*%', ' percent')
    # Some examples contrast complete sentences with "Sentence. / Sentence."
    # Punctuation retains the pause. Word alternatives, dates, fractions and
    # phonetic /slashes/ still fail the strict English-text check below.
    $spoken = [regex]::Replace($spoken, '([.!?])\s+/\s+(?=[A-Z])', '$1 ')
    # A direct-to-reported-speech example can use a right arrow between two
    # complete utterances. Name that transition; fragments such as word -> word
    # remain unsupported rather than being pronounced as an ordinary sentence.
    $bookRephrasePattern = '([.!?]["'']{0,2})\s*' + [char]0x2192 + '\s+(?=[A-Z])'
    $spoken = [regex]::Replace($spoken, $bookRephrasePattern, '$1 Rephrased: ')
    $spoken = [regex]::Replace($spoken, '\s+', ' ').Trim()
    # Slash notation, IPA, Cyrillic, markup and technical annotations never go
    # to System.Speech. Curly English punctuation is normalized above only.
    if ($spoken -notmatch '^[A-Za-z0-9\s.,!?''":;()\-]+$' -or $spoken -notmatch '[A-Za-z]') {
        throw 'Example contains non-English letters, IPA or unsupported annotations; not synthesized.'
    }
    return $spoken
}

function Get-BookPreferredVoice {
    param([object[]]$Voices)
    $preferred = $Voices | Where-Object { $_.Culture.Name -eq 'en-US' } | Sort-Object @{Expression={ if ($_.Name -like '*Zira*') { 0 } else { 1 } }}, Name | Select-Object -First 1
    if ($null -ne $preferred) { return $preferred }
    return $Voices | Where-Object { $_.Culture.Name -eq 'en-GB' } | Sort-Object Name | Select-Object -First 1
}

Add-Type -AssemblyName System.Speech
$bookSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$bookHash = [Security.Cryptography.SHA256]::Create()
$bookSeen = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
$bookRejected = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
$bookCreated = 0
$bookErrors = 0
$bookMutexHash = [BitConverter]::ToString($bookHash.ComputeHash($bookUTF8.GetBytes($bookAppRoot))).Replace('-', '')
$bookMutex = New-Object Threading.Mutex($false, ('Local\EnglishBookAudio-' + $bookMutexHash.Substring(0, 20)))
$bookOwnsMutex = $false
try {
    try { $bookOwnsMutex = $bookMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $bookOwnsMutex = $true }
    if (-not $bookOwnsMutex) { throw 'An audio preparation process already owns this app directory.' }
    $bookVoices = @($bookSynth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })
    $bookVoice = Get-BookPreferredVoice -Voices $bookVoices
    if ($null -eq $bookVoice) { throw 'No enabled English Windows voice is installed.' }
    $bookSynth.SelectVoice($bookVoice.Name)
    $bookSynth.Rate = 0
    $bookSynth.Volume = 100
    do {
        $bookPending = 0
        $bookFiles = @(Get-ChildItem -LiteralPath $bookLessonsRoot -Filter '*.json' -File)
        foreach ($bookFile in $bookFiles) {
            $bookUnitId = $bookFile.BaseName
            $bookSignature = $bookFile.LastWriteTimeUtc.Ticks.ToString() + ':' + $bookFile.Length
            if ($bookSeen.ContainsKey($bookUnitId) -and $bookSeen[$bookUnitId] -eq $bookSignature) { continue }
            try {
                $bookLesson = [IO.File]::ReadAllText($bookFile.FullName, $bookUTF8) | ConvertFrom-Json
                if ($bookUnitId -notmatch '^[a-z0-9][a-z0-9-]*$' -or $bookLesson.id -ne ('book-' + $bookUnitId) -or $bookLesson.provenance.unitId -ne $bookUnitId -or -not $bookLesson.generated) {
                    throw 'Lesson does not have the validated published identity/provenance.'
                }
                $bookClips = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
                foreach ($bookExample in $bookLesson.examples) {
                    $bookExact = [string]$bookExample.en
                    $bookDigest = [BitConverter]::ToString($bookHash.ComputeHash($bookUTF8.GetBytes($bookExact))).Replace('-', '').ToLowerInvariant()
                    try { $bookSpoken = Convert-BookSpeechText $bookExact }
                    catch {
                        if ($bookRejected.Add($bookUnitId + ':' + $bookDigest)) { Write-BookAudioError $bookUnitId $_.Exception.Message; $bookErrors++ }
                        continue
                    }
                    $bookFilename = $bookDigest + '.wav'
                    $bookTarget = Join-Path $bookAudioRoot $bookFilename
                    if (-not (Test-BookWave $bookTarget)) {
                        $bookTempWave = $bookTarget + '.tmp-' + $PID
                        $bookWaveStream = [IO.File]::Open($bookTempWave, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
                        try {
                            $bookSynth.SetOutputToWaveStream($bookWaveStream)
                            $bookSynth.Speak($bookSpoken)
                        }
                        finally {
                            try { $bookSynth.SetOutputToNull() }
                            finally { $bookWaveStream.Dispose() }
                        }
                        if (-not (Test-BookWave $bookTempWave)) { throw 'Synthesized WAV is empty or has an invalid RIFF/WAVE header.' }
                        if ([IO.File]::Exists($bookTarget)) { [IO.File]::Replace($bookTempWave, $bookTarget, [NullString]::Value) }
                        else { [IO.File]::Move($bookTempWave, $bookTarget) }
                        $bookCreated++
                    }
                    $bookClips[$bookExact] = $bookFilename
                }
                $bookIndex = [ordered]@{ voice = $bookVoice.Name; culture = $bookVoice.Culture.Name; preferredCulture = 'en-US'; isFallback = ($bookVoice.Culture.Name -ne 'en-US'); clips = $bookClips }
                Write-BookAtomicText (Join-Path $bookAudioRoot ($bookUnitId + '.json')) ($bookIndex | ConvertTo-Json -Depth 5)
                $bookSeen[$bookUnitId] = $bookSignature
                Write-Output ("Prepared {0}: {1} example clips" -f $bookUnitId, $bookClips.Count)
            }
            catch {
                $bookPending++
                $bookErrors++
                Write-BookAudioError $bookUnitId $_.Exception.Message
            }
        }
        $bookBatchState = 'unknown'
        if ([IO.File]::Exists($bookBatchPath)) {
            try { $bookBatchState = ([IO.File]::ReadAllText($bookBatchPath, $bookUTF8) | ConvertFrom-Json).state }
            catch { Write-BookAudioError '' 'Could not read the current lesson batch state.' }
        }
        # Re-snapshot after synthesis: a batch may have published another lesson
        # while this pass was writing clips.
        foreach ($bookCurrent in @(Get-ChildItem -LiteralPath $bookLessonsRoot -Filter '*.json' -File)) {
            $bookCurrentSig = $bookCurrent.LastWriteTimeUtc.Ticks.ToString() + ':' + $bookCurrent.Length
            if (-not $bookSeen.ContainsKey($bookCurrent.BaseName) -or $bookSeen[$bookCurrent.BaseName] -ne $bookCurrentSig) { $bookPending++ }
        }
        $bookTerminal = $bookBatchState -in @('complete', 'paused', 'partial', 'interrupted')
        $bookContinue = $Watch -and -not ($bookTerminal -and $bookPending -eq 0)
        $bookStatus = [ordered]@{
            pid = $PID; state = $(if ($bookContinue) { 'watching' } else { 'complete' });
            updatedAt = [DateTime]::UtcNow.ToString('o'); voice = $bookVoice.Name; culture = $bookVoice.Culture.Name;
            preferredCulture = 'en-US'; isFallback = ($bookVoice.Culture.Name -ne 'en-US');
            unitsProcessed = $bookSeen.Count; clipsCreatedThisRun = $bookCreated;
            wavFiles = @(Get-ChildItem -LiteralPath $bookAudioRoot -Filter '*.wav' -File).Count;
            pending = $bookPending; errors = $bookErrors; batchState = $bookBatchState
        }
        Write-BookAtomicText $bookAudioStatusPath ($bookStatus | ConvertTo-Json -Depth 3)
        if ($bookContinue) { Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds)) }
    } while ($bookContinue)
}
catch {
    Write-BookAudioError '' $_.Exception.Message
    throw
}
finally {
    $bookSynth.Dispose()
    $bookHash.Dispose()
    if ($bookOwnsMutex) { $bookMutex.ReleaseMutex() }
    $bookMutex.Dispose()
}
