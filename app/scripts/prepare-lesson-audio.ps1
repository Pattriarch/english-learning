[CmdletBinding()]
param([switch]$Watch, [int]$PollSeconds=30)
$ErrorActionPreference='Stop'
$lessonApp=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lessonOutput=Join-Path $lessonApp 'studio\lesson-audio'
$lessonStatus=Join-Path $lessonApp 'data\lesson-audio-status.json'
$lessonCourse=Join-Path $lessonApp 'content\courses\extended-skills.json'
$lessonUTF8=New-Object Text.UTF8Encoding($false)
[IO.Directory]::CreateDirectory($lessonOutput) | Out-Null
Add-Type -AssemblyName System.Speech
$lessonSynth=New-Object System.Speech.Synthesis.SpeechSynthesizer
$lessonHash=[Security.Cryptography.SHA256]::Create()
function Write-LessonJSON($Path,$Value) {
 $json=$Value|ConvertTo-Json -Depth 15
 if([IO.File]::Exists($Path) -and [IO.File]::ReadAllText($Path,$lessonUTF8) -eq $json){return}
 $temporary=$Path+'.tmp-'+$PID
 [IO.File]::WriteAllText($temporary,$json,$lessonUTF8)
 for($lessonWriteAttempt=0;$lessonWriteAttempt -lt 10;$lessonWriteAttempt++){
  try{
   if([IO.File]::Exists($Path)){[IO.File]::Replace($temporary,$Path,[NullString]::Value)}else{[IO.File]::Move($temporary,$Path)}
   return
  }catch{
   if($_.Exception.GetBaseException() -isnot [IO.IOException] -or $lessonWriteAttempt -eq 9){throw}
   Start-Sleep -Milliseconds 200
  }
 }
}
function Get-LessonHash([string]$Text) { return [BitConverter]::ToString($lessonHash.ComputeHash($lessonUTF8.GetBytes($Text))).Replace('-','').ToLowerInvariant() }
try {
 $voices=@($lessonSynth.GetInstalledVoices() | Where-Object {$_.Enabled} | ForEach-Object {$_.VoiceInfo})
 $voice=$voices | Where-Object {$_.Culture.Name -eq 'en-US'} | Sort-Object @{Expression={if($_.Name -like '*Zira*'){0}else{1}}},Name | Select-Object -First 1
 if(-not $voice){$voice=$voices | Where-Object {$_.Culture.Name -eq 'en-GB'} | Select-Object -First 1}
 if(-not $voice){throw 'An installed English System.Speech voice is required.'}
 $lessonSynth.SelectVoice($voice.Name);$lessonSynth.Rate=0
 do {
  $ready=0;$errors=@();$lessons=@()
  if([IO.File]::Exists($lessonCourse)){$lessons=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($lessonCourse,$lessonUTF8))}
  foreach($lesson in $lessons){
   $clips=@{}
   foreach($material in $lesson.materials){
    try{
     if($material.id -notmatch '^[A-Za-z0-9_-]+$' -or [string]::IsNullOrWhiteSpace($material.text)){throw 'Invalid material identity or empty text.'}
     if($material.text -match '[\u0400-\u04FF]'){throw 'English recording text contains Cyrillic instructions.'}
     $textHash=Get-LessonHash $material.text
     $clipHash=Get-LessonHash ($voice.Name+"`n"+$material.text)
     $target=Join-Path $lessonOutput ($clipHash+'.wav')
     if(-not [IO.File]::Exists($target) -or (Get-Item -LiteralPath $target).Length -le 44){
      $temporary=$target+'.tmp-'+$PID
      try{$lessonSynth.SetOutputToWaveFile($temporary);$lessonSynth.Speak($material.text)}finally{$lessonSynth.SetOutputToNull()}
      if((Get-Item -LiteralPath $temporary).Length -le 44){throw 'Empty speech file.'}
      if([IO.File]::Exists($target)){[IO.File]::Replace($temporary,$target,[NullString]::Value)}else{[IO.File]::Move($temporary,$target)}
     }
     $clips[$material.id]=@{file=$clipHash+'.wav';textSHA256=$textHash};$ready++
    }catch{$errors+=@{lessonId=$lesson.id;materialId=$material.id;error=$_.Exception.Message}}
   }
   if($lesson.id -notmatch '^[A-Za-z0-9_-]+$'){throw 'Invalid lesson ID.'}
   Write-LessonJSON (Join-Path $lessonOutput ($lesson.id+'.json')) @{version=1;voice=$voice.Name;culture=$voice.Culture.Name;materials=$clips}
  }
  Write-LessonJSON $lessonStatus @{version=1;updatedAt=[DateTime]::UtcNow.ToString('o');lessons=$lessons.Count;ready=$ready;errors=$errors}
  Write-Output ("LESSON_AUDIO ready="+$ready+" lessons="+$lessons.Count+" errors="+$errors.Count)
  if($Watch){Start-Sleep -Seconds $PollSeconds}
 }while($Watch)
}finally{$lessonSynth.Dispose();$lessonHash.Dispose()}
