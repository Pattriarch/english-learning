import {$,$$,esc,icon,api,busy,toast,uid,getDraft,localDraft,queueDraft,cardModal,feedbackHTML,bindMistakes,clipUTF8} from './core.js';
import {speak,stopAudio,recordOnly,voice} from './audio.js';
import {notebookRegisters,notebookKey,notebookResultKey,validNotebookId,newNotebookEntry,parseNotebookEntry,parseNotebookResult,notebookSource,notebookFingerprint,notebookResultCurrent,notebookEntries,notebookRecordings,notebookAudioURL,notebookJSON} from './notebook-model.js';

export function mountNotebook(root,data,refresh,id='',lessonId=''){
 const stored=(key)=>getDraft(key,data.state),active=stored('notebook:active');
 const selected=id==='new'?uid():validNotebookId(id)?id:validNotebookId(active)?active:uid();
 let entry=parseNotebookEntry(stored(notebookKey(selected)))||newNotebookEntry(selected),result=parseNotebookResult(stored(notebookResultKey(selected))),revision=0,reveal=true,mode='writing',requestID=uid(),editorAnchor=null;
 if(validNotebookId(lessonId))entry.lessonId=lessonId;
 if(id==='new')history.replaceState(null,'','#/notebook/'+selected);
 queueDraft('notebook:active',selected);
 const current=()=>root.isConnected&&editorAnchor?.isConnected&&root.querySelector('#notebook-russian')===editorAnchor;
 function persist(immediate=false){const text=notebookJSON(entry);return queueDraft(notebookKey(selected),text,immediate);}
 function allDrafts(){const drafts={...data.state.drafts};try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith('ew-draft:notebook:'))continue;const draftKey=key.slice(9);drafts[draftKey]={text:stored(draftKey)};}}catch{}drafts[notebookKey(selected)]={text:JSON.stringify(entry)};return drafts;}
 function allEntries(){return notebookEntries(allDrafts());}
 function drawList(){const list=$('#notebook-list',root);if(!list)return;const entries=allEntries();list.innerHTML=entries.length?entries.map(e=>`<a class="notebook-list-item ${e.id===selected?'active':''}" href="#/notebook/${esc(e.id)}"><strong>${esc((e.russian||e.ownEnglish).slice(0,110)||'Голосовая запись')}</strong><span>${esc(notebookRegisters[e.register])} · ${e.savedAt?'Сохранено':'Черновик'}${e.recordings.length?' · '+e.recordings.length+' аудио':''}</span></a>`).join(''):'<p class="small-note">Здесь появятся твои мысли, письма и фразы.</p>';}
 function drawResult(){
  const container=$('#notebook-result',root);if(!container)return;
  if(!result){container.innerHTML='<div class="notebook-placeholder"><span class="notebook-us">American English</span><h2>Скажи именно то, что задумал.</h2><p>Укажи мысль и ситуацию слева. Здесь появится естественная формулировка и объяснение выбора слов.</p></div>';return;}
  const fresh=notebookResultCurrent(entry,result);
  container.innerHTML=`${!fresh?'<p class="notebook-stale" role="status">Русская мысль, ситуация или стиль изменились. Ниже перевод предыдущей версии; переведи заново.</p>':''}<div class="spread"><span class="notebook-us">American English</span><button class="btn small ghost" id="notebook-reveal">${reveal?'Скрыть и вспомнить':'Показать перевод'}</button></div><div ${reveal?'':'hidden'} id="notebook-model"><p class="notebook-english">${esc(result.english)}</p><div class="actions"><button class="btn small" id="notebook-listen">${icon('sound')} Послушать</button><button class="btn small ghost" id="notebook-copy">Скопировать</button><button class="btn small ghost" id="notebook-card" ${fresh?'':'disabled'}>${icon('cards')} В повторение</button></div><h3>Почему так</h3><p class="notebook-prose">${esc(result.explanation)}</p><div class="notebook-phrases">${result.phrases.map(p=>`<div><strong lang="en">${esc(p.english)}</strong><p>${esc(p.russian)}</p></div>`).join('')}</div>${result.alternative?`<details><summary>Ещё один естественный вариант</summary><p class="notebook-prose" lang="en">${esc(result.alternative)}</p></details>`:''}</div>${reveal?'':'<p class="small-note">Перевод скрыт. Передай мысль по памяти в поле собственного ответа, затем сравни.</p>'}<div class="notebook-transfer"><h3>Теперь используй сам</h3><p>${esc(result.practice)}</p><label for="notebook-practice">Ответ для новой ситуации</label><textarea id="notebook-practice" rows="4" maxlength="3500" placeholder="Свой пример, а не копия перевода…">${esc(entry.practice)}</textarea><button class="btn small" id="notebook-check-practice" ${fresh?'':'disabled'}>Разобрать применение</button><div id="notebook-practice-feedback"></div></div>`;
  $('#notebook-reveal',root).onclick=()=>{reveal=!reveal;stopAudio();drawResult();};
  if($('#notebook-listen',root))$('#notebook-listen',root).onclick=()=>speak(result.english,.9,'en-US');
  if($('#notebook-copy',root))$('#notebook-copy',root).onclick=ev=>busy(ev.currentTarget,async()=>{await navigator.clipboard.writeText(result.english);toast('Английский текст скопирован.');});
  if($('#notebook-card',root))$('#notebook-card',root).onclick=()=>cardModal({front:entry.russian,back:result.english,note:result.explanation,source:'Моя мысль · American English'},refresh);
  $('#notebook-practice',root).oninput=ev=>{entry.practice=ev.target.value;requestID=uid();try{persist();}catch(e){toast(e.message,true);}};
  $('#notebook-check-practice',root).onclick=ev=>check(ev.currentTarget,true);
 }
 function drawRecordings(){const box=$('#notebook-recordings',root);box.innerHTML=notebookRecordings(allDrafts(),entry).reverse().map(r=>`<div class="notebook-recording"><span>${new Date(r.at).toLocaleString('ru-RU')} · ${r.kind==='own'?'Свой вариант':'Практика перевода'}</span><audio controls preload="none" src="${notebookAudioURL(r.file)}"></audio><details><summary>Текст во время записи</summary><p class="notebook-prose">${esc(r.text||'Свободная речь')}</p></details></div>`).join('');}
 async function check(button,practice=false){return busy(button,async()=>{
  const answer=practice?entry.practice:entry.ownEnglish;if(answer.trim().length<2)throw Error('Сначала сформулируй свой ответ.');
  const snapshot=notebookSource(entry),savedAnswer=answer,exerciseId='notebook-'+selected+(practice?'-apply':'-recall'),v=revision,revisionRequestID=requestID,submittedID=requestID+(practice?'-apply':'-recall'),submittedMode=practice?'writing':mode;
  const prompt=practice?result?.practice:'Передай на естественном американском английском именно эту русскую мысль: '+entry.russian;
  const context=clipUTF8('Ситуация: '+entry.context+'\nСтиль: '+notebookRegisters[entry.register]+(practice&&result?'\nИзучаемые фразы и пояснения: '+JSON.stringify(result.phrases):''),15000);
  stopAudio();await persist(true);
  let level='B1';try{const chosen=JSON.parse(stored('planner:preferences'));if(['A1','A2','B1','B2','C1','C2'].includes(chosen?.level))level=chosen.level;}catch{}
  const attempt=await api('/check',{id:submittedID,lessonId:'free',exerciseId,prompt:clipUTF8(prompt,7500),context,answer,mode:submittedMode,level});
  if(requestID===revisionRequestID)requestID=uid();await refresh();if(!current()||revision!==v||snapshot!==notebookSource(entry)||(practice?entry.practice:entry.ownEnglish)!==savedAnswer){toast('Разбор предыдущей версии сохранён в журнале.');return;}
  const target=$(practice?'#notebook-practice-feedback':'#notebook-own-feedback',root);target.innerHTML=feedbackHTML(attempt);bindMistakes(target);
 },'Разбираем смысл и формулировку…');}
 root.innerHTML=`<header class="notebook-header"><div><span class="notebook-us">American English · твоя жизнь</span><h1>Мои мысли по-английски</h1><p class="muted">Письмо, сообщение, реплика. Пойми формулировку, сохрани и научись говорить её сам.</p></div><button class="btn" id="notebook-new">${icon('plus')} Новая мысль</button></header><div class="notebook-grid"><section class="card notebook-editor"><label for="notebook-russian">Что ты хочешь сказать по-русски</label><textarea id="notebook-russian" data-entry="${esc(selected)}" rows="5" maxlength="2800" placeholder="Например: Я пока не разобрался, почему запрос зависает, но проверю после обеда.">${esc(entry.russian)}</textarea><div class="notebook-context"><div><label for="notebook-context">Кому и в какой ситуации</label><input id="notebook-context" maxlength="800" value="${esc(entry.context)}" placeholder="Коллеге в рабочем чате"></div><div><label for="notebook-register">Как звучать</label><select id="notebook-register">${Object.entries(notebookRegisters).map(([key,label])=>`<option value="${key}" ${entry.register===key?'selected':''}>${label}</option>`).join('')}</select></div></div><div class="actions"><button class="btn primary" id="notebook-translate">${icon('spark')} Как сказать по-английски</button><button class="btn" id="notebook-save">${icon('check')} Сохранить мысль</button></div><details class="notebook-own" open><summary>Попробовать самому</summary><p class="small-note">Можно написать до перевода или скрыть образец и восстановить мысль по памяти.</p><label for="notebook-own">Моя английская формулировка</label><textarea id="notebook-own" rows="5" maxlength="3500" spellcheck="false" placeholder="I haven't figured out…">${esc(entry.ownEnglish)}</textarea><div class="actions"><button class="btn small" id="notebook-dictate">${icon('mic')} Надиктовать</button><button class="btn small" id="notebook-check">Разобрать мой вариант</button></div><audio id="audio-preview" class="audio-preview" controls hidden></audio><div id="notebook-own-feedback"></div></details><div class="notebook-record"><h3>Сказать и услышать себя</h3><p class="small-note">Запись сохраняется вместе с текстом. Это репетиция речи; распознавание текста не оценивает акцент.</p><button class="btn" id="notebook-record">${icon('mic')} Записать голос</button><audio id="notebook-record-preview" controls hidden></audio><div id="notebook-recordings"></div></div><p class="small-note">Текст и пояснения входят в общий JSON прогресса. Аудио хранится отдельно в папке профиля на этом компьютере.</p>${entry.lessonId?`<a class="btn small" href="#/transfer/${esc(entry.lessonId)}">Вернуться к закреплению темы</a>`:''}</section><section class="card notebook-output" id="notebook-result" aria-live="polite"></section></div><section class="notebook-library"><h2>Сохранённые мысли и черновики</h2><div id="notebook-list"></div></section>`;
 editorAnchor=$('#notebook-russian',root);drawList();drawResult();drawRecordings();
 function changed(field,value){entry[field]=value;revision++;requestID=uid();try{persist();}catch(e){toast(e.message,true);}drawList();}
 $('#notebook-russian',root).oninput=ev=>{changed('russian',ev.target.value);drawResult();};
 $('#notebook-context',root).oninput=ev=>{changed('context',ev.target.value);drawResult();};
 $('#notebook-register',root).onchange=ev=>{changed('register',ev.target.value);drawResult();};
 $('#notebook-own',root).oninput=ev=>{mode='writing';changed('ownEnglish',ev.target.value);$('#notebook-own-feedback',root).innerHTML='';};
 $('#notebook-check',root).onclick=ev=>check(ev.currentTarget);
 $('#notebook-dictate',root).onclick=ev=>voice(ev.currentTarget,$('#notebook-own',root),data.settings,()=>{mode='speaking';changed('ownEnglish',$('#notebook-own',root).value);});
 $('#notebook-save',root).onclick=ev=>busy(ev.currentTarget,async()=>{if(!entry.russian.trim()&&!entry.ownEnglish.trim())throw Error('Сначала впиши мысль.');entry.savedAt=new Date().toISOString();await persist(true);if(localDraft(notebookKey(selected))?.pending)throw Error('Мысль сохранена в браузере; отправим на компьютер при восстановлении связи.');drawList();toast('Мысль сохранена в твоём прогрессе.');});
 $('#notebook-new',root).onclick=()=>{stopAudio();const next=uid();queueDraft('notebook:active',next);location.hash='#/notebook/'+next;};
 $('#notebook-translate',root).onclick=ev=>busy(ev.currentTarget,async()=>{
  if(entry.russian.trim().length<2)throw Error('Впиши мысль по-русски.');const source=notebookFingerprint(entry),payload={russian:entry.russian,context:entry.context,register:entry.register},v=revision,translationRequest=uid(),requestKey='notebook:request:'+selected;
  // Claim the request before any await so an older mount cannot claim it late.
  const claimed=queueDraft(requestKey,translationRequest,true);await persist(true);await claimed;const out=await api('/notebook/translate',payload);
  const translated={...out,version:1,source,at:new Date().toISOString()};const raw=notebookJSON(translated);
  if(stored(requestKey)!==translationRequest){await queueDraft('notebook:history:'+selected+':'+translationRequest,raw,true);toast('Сохранён разбор предыдущего запроса; новый перевод не заменён.');return;}
  await queueDraft(notebookResultKey(selected),raw,true);
  if(!current()||v!==revision||notebookFingerprint(entry)!==source){toast('Перевод предыдущей версии сохранён. Новый текст не заменён.');return;}
  result=translated;requestID=uid();reveal=true;drawResult();
 },'Подбираем естественную формулировку…');
 $('#notebook-record',root).onclick=async ev=>{
  const button=ev.currentTarget;if(button.classList.contains('recording')){stopAudio();return;}
  const capturedText=entry.ownEnglish.trim()||result?.english||'',kind=entry.ownEnglish.trim()?'own':'model',capturedAt=new Date().toISOString();button.disabled=true;
  try{
   // Create even a voice-only entry before recording. After the upload only its
   // separate recording draft is written; a reopened entry must never be replaced.
   await persist(true);if(!current())return;
   await recordOnly(button,$('#notebook-record-preview',root),async(_url,_mime,blob)=>{try{
   if(!(blob instanceof Blob)||!blob.size)throw Error('Запись не содержит звука. Попробуй ещё раз.');const form=new FormData();form.append('file',blob,'recording.webm');
   const out=await api('/notebook/audio',form);if(!notebookAudioURL(out.audio))throw Error('Сервер не подтвердил сохранение записи.');
   const recordingKey='notebook:recording:'+uid();await queueDraft(recordingKey,notebookJSON({version:1,entryId:selected,file:out.audio,at:capturedAt,text:capturedText,kind}),true);
   if(current()){drawRecordings();drawList();toast(localDraft(recordingKey)?.pending?'Аудио сохранено; ссылка пока в черновике браузера.':'Запись голоса сохранена.');}
   }catch(e){toast(e.message,true);}},{retainOnLeave:true});
  }catch(e){toast(e.message,true);}finally{button.disabled=false;}
 };
}
