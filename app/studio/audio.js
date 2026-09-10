import {$,api,toast} from './core.js';
let active=null,audioURL=null,audioGeneration=0,localSpeech=null,localSpeechPanel=null,speechRequest=null;
const speechPlayers=new WeakMap();
export const speechVoiceName=id=>({af_heart:'Heart',af_bella:'Bella',am_michael:'Michael',am_fenrir:'Fenrir',bf_emma:'Emma'}[id]||id);
export function speechLabel(voice,culture='en-US'){
  return ['Kokoro',speechVoiceName(voice),culture==='en-GB'?'британский английский':'американский английский'].filter(Boolean).join(' · ');
}
// All course and free-text playback uses the same local neural voice and cache.
// Optional inline controls keep the player beside its learning material.
export async function speak(text,rate=.9,lang='en-US',options={}){
  text=String(text||'').trim();if(!text)return null;
  stopAudio();const generation=audioGeneration,current=()=>generation===audioGeneration&&(!options.isCurrent||options.isCurrent());
  if(!current())return null;
  let player=options.player,status=options.status;
  if(!player){
    const panel=document.createElement('aside'),close=document.createElement('button');player=document.createElement('audio');status=document.createElement('p');
    panel.className='local-speech-player';panel.setAttribute('aria-label','Озвучка Kokoro');status.setAttribute('role','status');
    close.type='button';close.textContent='×';close.setAttribute('aria-label','Остановить и закрыть озвучку');close.onclick=()=>{if(current())stopAudio();};
    panel.append(status,player,close);document.body.appendChild(panel);localSpeechPanel=panel;
  }
  localSpeech=player;speechPlayers.set(player,generation);player.hidden=true;player.controls=true;player.preload='auto';player.removeAttribute?.('src');
  const show=message=>{if(status){status.hidden=false;status.textContent=message;}};
  const controller=new AbortController(),button=options.button,original=button?.innerHTML;
  let restored=false;const restore=()=>{if(restored)return;restored=true;if(button){button.disabled=false;button.innerHTML=original;button.setAttribute('aria-busy','false');}};
  const request={controller,cancel(){controller.abort();restore();if(generation===audioGeneration&&status?.isConnected!==false)show('Озвучивание остановлено.');}};speechRequest=request;
  if(button){button.disabled=true;button.innerHTML='Готовим озвучку…';button.setAttribute('aria-busy','true');}
  show('Готовим озвучку Kokoro… При первом запуске нужно немного подождать.');
  try{
    let response;try{response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,lang,...(options.voice?{voice:options.voice}:{})}),signal:controller.signal});}catch(error){if(error.name==='AbortError')throw error;throw Error('Сервер озвучки недоступен. Запусти приложение через Start-English.cmd и повтори.');}
    if(!current())return null;
    let out;try{out=await response.json();}catch{throw Error('Сервер озвучки вернул неожиданный ответ.');}
    if(!current())return null;
    if(!response.ok)throw Error(out.error||'Не удалось подготовить озвучку Kokoro. Попробуй ещё раз.');
    if(out.engine!=='kokoro'||!/^[a-f0-9]{64}\.wav$/.test(out.audio||'')||out.culture!==lang||!out.voice)throw Error('Не удалось подтвердить голос Kokoro и выбранный вариант английского. Перезапусти приложение и повтори.');
    player.src='/media/'+out.audio;player.playbackRate=Math.min(1.5,Math.max(.5,Number(rate)||.9));player.hidden=false;
    const label=speechLabel(out.voice,out.culture);player.setAttribute('aria-label','Прослушать фразу · '+label);player.title=label;show(label);
    player.onerror=()=>{if(current()){const message='Не удалось воспроизвести аудио. Попробуй озвучить фразу ещё раз.';show(message);toast(message,true);}};
    try{await player.play();if(!current()&&speechPlayers.get(player)===generation)player.pause();}catch{if(current())show(label+' · Аудио готово. Нажми ▶ в плеере.');}
    return current()?out:null;
  }catch(error){if(current()&&error.name!=='AbortError'){show(error.message);toast(error.message,true);}return null;}
  finally{if(speechRequest===request)speechRequest=null;restore();}
}
export function stopAudio(){speechRequest?.cancel();speechRequest=null;audioGeneration++;const running=active;active=null;running?.stop();localSpeech?.pause();localSpeechPanel?.remove();localSpeech=null;localSpeechPanel=null;document.querySelectorAll('audio').forEach(a=>a.pause());window.speechSynthesis?.cancel();}
// A queued file load must not restart playback after Stop or route navigation.
export function beginAudio(){stopAudio();const generation=audioGeneration;return()=>generation===audioGeneration;}
export async function recordOnly(button,preview,onReady,options={}){
  if(active){active.stop();return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Для записи открой приложение в Chrome или Edge через localhost.',true);return;}
  stopAudio();const generation=audioGeneration,original=button.innerHTML,chunks=[];let stream,recorder,timer,stopped=false,failed=false;
  const cleanup=()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());button.innerHTML=original;button.classList.remove('recording');if(generation===audioGeneration)active=null;};
  button.disabled=true;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(generation!==audioGeneration||!button.isConnected){cleanup();return;}
    recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onerror=()=>{failed=true;cleanup();toast('Не удалось записать звук. Попробуй ещё раз.',true);};
    recorder.onstop=()=>{
      cleanup();if(failed||!chunks.length||(!preview?.isConnected&&!options.retainOnLeave))return;
      const blob=new Blob(chunks,{type:recorder.mimeType});let url='';
      if(preview?.isConnected){if(audioURL)URL.revokeObjectURL(audioURL);audioURL=URL.createObjectURL(blob);url=audioURL;preview.src=url;preview.hidden=false;}
      // Persistent callers get the Blob directly, even if their preview has
      // unmounted. Existing preview-only callers keep their previous behavior.
      return onReady?.(url,recorder.mimeType,blob);
    };
    active={stop:()=>{if(stopped)return;stopped=true;if(recorder.state!=='inactive')recorder.stop();else cleanup();}};
    recorder.start();button.innerHTML='■ Остановить запись';button.classList.add('recording');timer=setTimeout(()=>active?.stop(),300000);
  }catch(e){cleanup();toast(e.name==='NotAllowedError'?'Разреши доступ к микрофону в настройках браузера.':e.message,true);}
  finally{button.disabled=false;}
}
async function wav(blob){
  const ctx=new AudioContext();let buffer;try{buffer=await ctx.decodeAudioData(await blob.arrayBuffer());}finally{await ctx.close();}
  const offline=new OfflineAudioContext(1,Math.ceil(buffer.duration*16000),16000);const source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();const mono=(await offline.startRendering()).getChannelData(0);
  const out=new ArrayBuffer(44+mono.length*2),v=new DataView(out);const str=(offset,t)=>{for(let i=0;i<t.length;i++)v.setUint8(offset+i,t.charCodeAt(i));};str(0,'RIFF');v.setUint32(4,out.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,mono.length*2,true);mono.forEach((x,i)=>v.setInt16(44+i*2,Math.max(-1,Math.min(1,x))*32767,true));return new Blob([out],{type:'audio/wav'});
}
export async function voice(button,target,settings,onText){
  if(active){active.stop();return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Запись недоступна. Откройте приложение в Chrome или Edge через localhost.',true);return;}
  stopAudio();const generation=audioGeneration,original=button.innerHTML,preview=$('#audio-preview'),check=$('#check')||$('#unit-check')||$('#book-check'),checkDisabled=check?.disabled;
  let stream,recognition,recorder,timer,transcript='',released=false,failed=false,lastText=target.value,textChanged=false;const chunks=[],initial=target.value.trim();
  const current=()=>generation===audioGeneration&&button.isConnected&&target.isConnected;
  const releaseStream=()=>{clearTimeout(timer);if(recognition){try{recognition.stop();}catch{}}stream?.getTracks().forEach(t=>t.stop());stream=null;};
  const cleanup=()=>{releaseStream();if(released)return;released=true;button.innerHTML=original;button.disabled=false;button.classList.remove('recording');if(check)check.disabled=checkDisabled;if(active===session)active=null;};
  const applyText=text=>{
    if(!current()||textChanged)return;
    if(target.value!==lastText){textChanged=true;toast('Ответ уже изменён вручную. Сохранили твой текст; запись можно прослушать.',true);return;}
    lastText=[initial,text.trim()].filter(Boolean).join(' ');target.value=lastText;onText();
  };
  const session={stop:()=>{if(!current())cleanup();if(recorder&&recorder.state!=='inactive')recorder.stop();else{if(current())audioGeneration++;cleanup();}}};
  active=session;button.disabled=true;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true});if(!current()){cleanup();return;}recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onerror=()=>{failed=true;cleanup();if(current())toast('Не удалось записать звук. Попробуй ещё раз.',true);};
    recorder.onstop=async()=>{
      releaseStream();if(!current()||failed||!chunks.length){cleanup();return;}
      const blob=new Blob(chunks,{type:recorder.mimeType});if(audioURL)URL.revokeObjectURL(audioURL);audioURL=URL.createObjectURL(blob);if(preview?.isConnected){preview.src=audioURL;preview.hidden=false;}
      if(!settings.whisperUrl){cleanup();return;}
      button.disabled=true;button.textContent='Распознаём запись…';
      try{const file=await wav(blob);if(!current())return;const form=new FormData();form.append('file',file,'speech.wav');const out=await api('/transcribe',form);if(current()){applyText(out.text);if(!textChanged)toast('Проверьте расшифровку перед разбором.');}}
      catch(e){if(current())toast(e.message,true);}finally{cleanup();}
    };
    if(!settings.whisperUrl){
      const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(Recognition){recognition=new Recognition();recognition.lang='en-US';recognition.continuous=true;recognition.interimResults=false;
        recognition.onresult=e=>{if(!current())return;for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)transcript+=' '+e.results[i][0].transcript;applyText(transcript);};
        recognition.onerror=e=>{if(current()&&e.error!=='aborted')toast('Браузер не распознал речь ('+e.error+'). Запись сохранится для прослушивания; можно подключить локальный Whisper.',true);};
        recognition.start();
      }else toast('Звук записывается. Для расшифровки подключите whisper.cpp в настройках или откройте Chrome/Edge.',true);
    }
    recorder.start();button.disabled=false;if(check)check.disabled=true;button.innerHTML='■ Остановить запись';button.classList.add('recording');timer=setTimeout(()=>session.stop(),300000);
    toast(settings.whisperUrl?'Говорите по-английски. Расшифруем после остановки.':'Говорите по-английски. Распознавание браузера может использовать интернет.');
  }catch(e){cleanup();if(current())toast(e.name==='NotAllowedError'?'Разрешите доступ к микрофону в настройках браузера.':e.message,true);}
}
