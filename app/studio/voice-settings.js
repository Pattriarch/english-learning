import {$,esc,api} from './core.js';
import {speak,stopAudio,speechVoiceName} from './audio.js';

export const voicePreviewText="Hi! I'm ready to practice English. Let's take our time, listen carefully, and try something new today.";
const mounted=new WeakMap();
export async function mountVoiceSettings(root){
 const mount={};mounted.set(root,mount);const current=()=>root.isConnected&&mounted.get(root)===mount;
 root.innerHTML='<h2>Голос озвучки</h2><p>Загружаем голоса Kokoro…</p>';
 let config;
 try{config=await api('/speech/config');if(!current())return;if(config.engine!=='kokoro'||!Array.isArray(config.voices)||!config.voices.length)throw Error('Настройки Kokoro недоступны. Перезапусти приложение и повтори.');}
 catch(error){if(current()){root.innerHTML=`<h2>Голос озвучки</h2><p role="status">${esc(error.message)}</p><button class="btn small" id="speech-retry">Повторить</button>`;$('#speech-retry',root).onclick=()=>mountVoiceSettings(root);}return;}
 const choices=config.voices.filter(v=>v.culture==='en-US'&&typeof v.id==='string');
 root.innerHTML=`<h2>Голос озвучки</h2><p>Локальная озвучка Kokoro для примеров, учебников и твоих текстов. Выбери голос, послушав одну и ту же фразу.</p><div class="field"><label for="speech-voice">Американский английский</label><select id="speech-voice">${choices.map(v=>`<option value="${esc(v.id)}" ${v.id===config.voice?'selected':''}>${esc(v.name||speechVoiceName(v.id))}</option>`).join('')}</select></div><p class="speech-preview-text" lang="en">${esc(voicePreviewText)}</p><div class="actions"><button class="btn small" id="speech-preview">Послушать голос</button><button class="btn small ghost" id="speech-stop">Остановить</button><button class="btn primary small" id="speech-save" disabled>Сохранить голос</button></div><audio class="audio-preview" id="speech-player" controls hidden></audio><p class="small-note" id="speech-preview-status" role="status"></p><p class="small-note" id="speech-config-status" role="status">${config.available?'Озвучка готова.':'Сервис озвучки пока недоступен. Запусти приложение через Start-English.cmd и повтори прослушивание.'}</p><p class="small-note">Для британского сравнения в произношении используется Emma. Выбор здесь меняет американский голос во всём приложении.</p>`;
 const select=$('#speech-voice',root),save=$('#speech-save',root),preview=$('#speech-preview',root),status=$('#speech-config-status',root);let savedVoice=config.voice,previewRequest=0;
 select.onchange=()=>{previewRequest++;stopAudio();save.disabled=select.value===savedVoice;status.textContent=save.disabled?'Выбран сохранённый голос.':'Прослушай голос и сохрани, если он подходит.';};
 $('#speech-stop',root).onclick=()=>{previewRequest++;stopAudio();};
 preview.onclick=async()=>{const request=++previewRequest;await speak(voicePreviewText,1,'en-US',{voice:select.value,player:$('#speech-player',root),status:$('#speech-preview-status',root),button:preview,isCurrent:()=>current()&&select.isConnected&&request===previewRequest});};
 save.onclick=async()=>{
  if(save.disabled)return;const selected=select.value;save.disabled=true;select.disabled=true;status.textContent='Сохраняем голос…';
  try{const out=await api('/speech/config',{voice:selected});if(!current())return;if(out.engine!=='kokoro'||out.voice!==selected)throw Error('Сервер не подтвердил выбранный голос. Повтори сохранение.');savedVoice=out.voice;status.textContent='Голос '+speechVoiceName(savedVoice)+' сохранён. Следующая озвучка использует его.';}
  catch(error){if(current())status.textContent=error.message;}
  finally{if(current()){select.disabled=false;save.disabled=select.value===savedVoice;}}
 };
}
