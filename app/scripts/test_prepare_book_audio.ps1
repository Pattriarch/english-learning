# Run with Windows PowerShell 5.1, the same engine as the audio watcher.
$ErrorActionPreference = 'Stop'
$bookAudioScript = Join-Path $PSScriptRoot 'prepare-book-audio.ps1'
$bookTestTokens = $null
$bookTestErrors = $null
$bookTestTree = [Management.Automation.Language.Parser]::ParseFile($bookAudioScript, [ref]$bookTestTokens, [ref]$bookTestErrors)
if ($bookTestErrors.Count) { throw 'Audio preparation script has syntax errors.' }
$bookNormalizer = $bookTestTree.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Convert-BookSpeechText' }, $true)
if ($null -eq $bookNormalizer) { throw 'Audio normalizer was not found.' }
$bookTransform = $bookNormalizer.Body.GetScriptBlock()
$bookPound = [string][char]0xA3
$bookEuro = [string][char]0x20AC
$bookCases = @(
    @{ input = 'Sales rose by 12%, while costs fell by 0.5%.'; expected = 'Sales rose by 12 percent, while costs fell by 0.5 percent.' },
    @{ input = ('I paid ' + $bookPound + '24,000 for it.'); expected = 'I paid 24,000 pounds for it.' },
    @{ input = ('It turned over ' + $bookPound + '2.8 million, with profit of ' + $bookPound + '90,000.'); expected = 'It turned over 2.8 million pounds, with profit of 90,000 pounds.' },
    @{ input = ('The charge was ' + $bookEuro + '47.60; I rounded it up to ' + $bookEuro + '50.'); expected = 'The charge was 47.60 euros; I rounded it up to 50 euros.' },
    @{ input = ('I paid ' + $bookPound + '1 and got ' + $bookEuro + '1.00 back.'); expected = 'I paid 1 pound and got 1.00 euro back.' },
    @{ input = 'It costs $1, but delivery costs $10.'; expected = 'It costs 1 dollar, but delivery costs 10 dollars.' },
    @{ input = 'She has a rabbit. / She has got a rabbit.'; expected = 'She has a rabbit. She has got a rabbit.' },
    @{ input = 'Good luck! Thanks. / You won! Congratulations!'; expected = 'Good luck! Thanks. You won! Congratulations!' },
    @{ input = ('Eva said, ' + [char]0x2018 + 'I need fresh air.' + [char]0x2019 + ' ' + [char]0x2192 + ' Eva said (that) she needed fresh air.'); expected = "Eva said, 'I need fresh air.' Rephrased: Eva said (that) she needed fresh air." },
    @{ input = ('I can help. ' + [char]0x2192 + ' She said she could help.'); expected = 'I can help. Rephrased: She said she could help.' }
)
$bookChecks = 0
foreach ($bookCase in $bookCases) {
    $bookActual = & $bookTransform -Text $bookCase.input
    if ($bookActual -cne $bookCase.expected) { throw ('Unexpected normalization: ' + $bookActual + ' != ' + $bookCase.expected) }
    $bookChecks++
}
foreach ($bookRejectedText in @('He/she works here.', 'The date is 10/09/2026.', 'Use /w/ carefully.', 'One half is 1/2.', ('The amount is ' + $bookPound + '1,0000.'), '% is a symbol.', ('It says ' + [char]0x0430 + '.'), ('need ' + [char]0x2192 + ' needed'), ('I need air ' + [char]0x2192 + ' she needed air'))) {
    $bookWasRejected = $false
    try { $null = & $bookTransform -Text $bookRejectedText }
    catch { $bookWasRejected = $true }
    if (-not $bookWasRejected) { throw ('Unsafe notation was accepted: ' + $bookRejectedText) }
    $bookChecks++
}
Write-Output ('Audio normalizer: ' + $bookChecks + ' checks passed.')

$bookSelector = $bookTestTree.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-BookPreferredVoice' }, $true)
if ($null -eq $bookSelector) { throw 'Voice selector was not found.' }
$bookChoose = $bookSelector.Body.GetScriptBlock()
$bookZira = [pscustomobject]@{ Name = 'Microsoft Zira Desktop'; Culture = [Globalization.CultureInfo]::GetCultureInfo('en-US') }
$bookDavid = [pscustomobject]@{ Name = 'Microsoft David Desktop'; Culture = [Globalization.CultureInfo]::GetCultureInfo('en-US') }
$bookHazel = [pscustomobject]@{ Name = 'Microsoft Hazel Desktop'; Culture = [Globalization.CultureInfo]::GetCultureInfo('en-GB') }
$bookIrina = [pscustomobject]@{ Name = 'Microsoft Irina Desktop'; Culture = [Globalization.CultureInfo]::GetCultureInfo('ru-RU') }
if ((& $bookChoose -Voices @($bookHazel, $bookDavid, $bookZira)).Name -ne $bookZira.Name) { throw 'Zira must win over other US and British voices.' }
if ((& $bookChoose -Voices @($bookHazel, $bookDavid)).Name -ne $bookDavid.Name) { throw 'An available US voice must win over a British voice.' }
if ((& $bookChoose -Voices @($bookIrina, $bookHazel)).Culture.Name -ne 'en-GB') { throw 'British fallback must retain its actual culture.' }
if ($null -ne (& $bookChoose -Voices @($bookIrina))) { throw 'Non-English voices must not be selected.' }
Write-Output 'US-first voice selection: 4 checks passed.'
