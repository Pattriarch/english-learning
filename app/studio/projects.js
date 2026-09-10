import {$,$$,esc,icon,api,busy,toast,uid,getDraft,queueDraft,localDraft,feedbackHTML,bindMistakes,words} from './core.js';
import {speak,stopAudio,recordOnly} from './audio.js';
import {projectLevels,projectKey,projectReceiptKey,projectAudioURL,projectParse,projectProgress} from './projects-model.js';

const mounts=new WeakMap(),labels={reading:'Чтение и доказательства',listening:'Слушание и смысл',writing:'Письменный результат',speaking:'Разговор и переговоры',mediation:'Объяснить другому',revision:'Доработка и рефлексия',transfer:'Новая ситуация через неделю'};
const day=at=>new Date(at).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
function json(value){const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>19500)throw Error('Запись слишком длинная. Сократи её перед сохранением.');return text;}
function projectModelHTML(task){return `<details id="project-model"><summary>Образец и почему он работает — после твоей попытки</summary><div class="project-prose" lang="en">${esc(task.model)}</div><p>${esc(task.explanation)}</p><p class="small-note">Это пример, а не единственный правильный ответ. Повтор после просмотра образца — практика с опорой.</p></details>`;}
function hydrate(data){const state={...data.state,drafts:{...data.state?.drafts}};try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith('ew-draft:project:')){const name=key.slice(9);state.drafts[name]={text:getDraft(name,state)};}}}catch{}return {...data,state};}

/** Route contract: #/projects and #/projects/:id. Existing profile APIs own all artifacts. */
export async function mountProjects(root,data,refresh,id=''){
 mounts.get(root)?.dispose?.();stopAudio();const route=location.hash,token={};mounts.set(root,token);
 const current=()=>mounts.get(root)===token&&root.isConnected&&location.hash===route;
 let drawVersion=0,selected='',catalog,unit,filter='all';
 const dispose=()=>{stopAudio();window.removeEventListener('hashchange',dispose);};token.dispose=dispose;window.addEventListener('hashchange',dispose,{once:true});
 root.innerHTML='<div class="book-loading" role="status">Открываем проекты и проверочные работы…</div>';
 try{catalog=await api('/projects');if(!current())return;if(!Array.isArray(catalog.units))throw Error('Программа проектов пока недоступна.');data=hydrate(data);unit=catalog.units.find(u=>u.id===id);if(id&&!unit){root.innerHTML='<section class="surface"><h1>Работа не найдена</h1><a class="btn" href="#/projects">К проектам</a></section>';return;}draw();}catch(e){if(current())root.innerHTML=`<section class="surface"><h1>Не удалось открыть проекты</h1><p>${esc(e.message)}</p><a class="btn" href="#/today">К плану дня</a></section>`;}

 function state(){data=hydrate(data);return data.state;}
 async function save(key,value){await queueDraft(key,value,true);data.state.drafts[key]={text:value};if(localDraft(key)?.pending)throw Error('Текст сохранён в браузере, но сервер пока не подтвердил его. Повтори после восстановления связи.');}
 function status(p){return p.passed?'Все этапы получили положительный разбор'+(p.supported?' · использовалась опора':''):p.transferred?'Все этапы практики сохранены · смотри разбор':p.revised?`Новая ситуация ${day(p.dueAt)}`:p.attempted?`Сохранено ${p.attempted} из ${p.total} основных ответов`:'Можно начать';}
 function statusText(p){return status(p)+(p.needsWork?' · В последних ответах есть замечания.':'')+(p.ungraded?' · Есть ответы без оценки помощника.':'');}
 function draw(){if(!current())return;if(!unit){drawCatalog();return;}drawUnit();}
 function drawCatalog(){
  const s=state(),visible=catalog.units.filter(u=>filter==='all'||u.level===filter);
  root.innerHTML=`<header class="page-header"><div class="eyebrow">A1 → C2 · СОБСТВЕННЫЙ РЕЗУЛЬТАТ</div><h1>Проекты и контрольные работы</h1><p>12 недельных проектов и 12 проверочных форм. В каждой работе: два источника, свой текст, разговор, объяснение для другой аудитории, доработка и новая ситуация через семь дней.</p><p class="small-note">Проверочная форма — самостоятельная учебная проба. Положительный разбор не присваивает уровень CEFR. При выключенном помощнике остаются образцы и история практики без оценки.</p><div class="actions"><a class="btn" href="#/today">План дня</a><a class="btn" href="#/mastery">Карта программы</a></div></header><section class="surface"><label for="projects-level">Уровень работы</label><select id="projects-level"><option value="all">Все уровни</option>${projectLevels.map(l=>`<option ${filter===l?'selected':''}>${l}</option>`).join('')}</select><div class="projects-grid">${visible.map(u=>{const p=projectProgress(u,s);return `<article class="project-card"><div class="eyebrow">${esc(u.level)} · ${u.kind==='project'?'НЕДЕЛЬНЫЙ ПРОЕКТ':'ПРОВЕРОЧНАЯ ФОРМА'}</div><h2>${esc(u.title)}</h2><p>${esc(u.why)}</p><p class="small-note">${esc(status(p))}${p.needsWork?' · есть что доработать':''}. Ориентир ${u.minutes} минут, можно разделить на несколько подходов.</p><a class="btn ${p.due?'primary':''}" href="#/projects/${esc(u.id)}">${p.due?'Применить после паузы':p.attempted?'Продолжить':'Открыть работу'} ${icon('arrow')}</a></article>`;}).join('')}</div><details class="project-boundary"><summary>Что означает результат</summary><p>${esc(catalog.boundary)}</p></details></section>`;
  $('#projects-level',root).onchange=e=>{filter=e.target.value;drawCatalog();};
 }
 function drawUnit(){
  const s=state(),p=projectProgress(unit,s),v=++drawVersion,own=()=>current()&&drawVersion===v;
  const all=[...unit.tasks,{id:'revision',kind:'revision',prompt:unit.reflectionPrompt},{id:'transfer',kind:'transfer',...unit.transfer}];
  if(!selected)selected=p.next==='review'?'revision':p.next;
  const task=all.find(t=>t.id===selected)||all[0],isRevision=task.id==='revision',isTransfer=task.id==='transfer';
  const locked=isRevision&&!p.evidence.every(Boolean)||isTransfer&&(!p.revised||!p.due&&!p.transferred);
  const prior=isRevision?p.revision:isTransfer?p.transfer:p.attempts[unit.tasks.findIndex(t=>t.id===task.id)];
  const key=projectKey(unit.id,task.id),audioKey=projectKey(unit.id,'audio-'+task.id),conditionKey=projectKey(unit.id,'support-'+task.id);
  let requestID=uid(),audio=projectParse(getDraft(audioKey,s)),support=projectParse(getDraft(conditionKey,s))||{transcript:false,model:false};
  const materials=(task.materialIds||[]).map(id=>unit.materials.find(m=>m.id===id)).filter(Boolean);
  root.innerHTML=`<header class="page-header"><div class="eyebrow">${esc(unit.level)} · ${unit.kind==='project'?'НЕДЕЛЬНЫЙ ПРОЕКТ':'ПРОВЕРОЧНАЯ ФОРМА'}</div><h1>${esc(unit.title)}</h1><p>${esc(unit.why)}</p><div class="actions"><a class="btn small" href="#/projects">Все работы</a><a class="btn small" href="#/today">План дня</a></div></header><section class="surface"><p id="project-status" class="project-status" role="status">${esc(statusText(p))}</p><p class="small-note">Ориентир ${unit.minutes} минут за несколько подходов. История работы не является сертификатом. Открытие текста и образца не выполняет этап.</p><ol class="project-steps">${all.map(t=>{const idx=unit.tasks.findIndex(x=>x.id===t.id),done=idx>=0?p.evidence[idx]:t.id==='revision'?p.revised:p.transferred;return `<li><button class="btn small ${t.id===task.id?'primary':''}" data-project-stage="${t.id}" data-project-done="${done}">${done?icon('check'):''}${esc(labels[t.kind])}</button></li>`;}).join('')}</ol><details class="project-rubric" open><summary>Критерии результата</summary><ul>${unit.rubric.map(r=>`<li>${esc(r)}</li>`).join('')}</ul><p class="small-note">Помощник оценивает смысл, полноту, точность и уместность; объём — ориентир жанра. Для устной работы нужны запись и расшифровка. Проверка расшифровки не оценивает звуки, акцент или интонацию.</p></details><h2>${esc(labels[task.kind])}</h2>${locked?`<p>${isRevision?'Сначала сохрани пять основных ответов, включая устную запись. Затем здесь можно сопоставить разбор и доработать результат.':p.revised?'Новый контекст откроется '+esc(day(p.dueAt))+'. Семь дней считаются от фактической доработки.':'Сначала выполни основные ответы и доработку. Новый контекст будет доступен через семь дней.'}</p><a class="btn" href="#/projects">Выбрать другую работу</a>`:`<div class="project-prompt">${esc(task.prompt)}</div>${isTransfer?'<p class="small-note">Передай навык в новый контекст без старых образцов. Если понадобилась опора, отметь это в рефлексии.</p>':''}${materials.map(m=>m.kind==='listening'?`<article class="project-material"><h3>${esc(m.title)}</h3><p class="small-note">Авторский сценарий, синтезированная озвучка Kokoro. Сначала слушай без текста. Разрешены повтор и пауза.</p><button class="btn small" data-project-listen="${m.id}">${icon('sound')} Слушать</button><details id="project-transcript"><summary>Открыть расшифровку как опору</summary><div class="project-prose" lang="en">${esc(m.text)}</div></details></article>`:`<article class="project-material"><h3>${esc(m.title)}</h3><div class="project-prose" lang="en">${esc(m.text)}</div><p class="small-note">${esc(m.source)}</p></article>`).join('')}${isRevision?`<div class="project-history"><h3>Твои ответы и разбор</h3>${p.attempts.map((a,i)=>`<details><summary>${esc(labels[unit.tasks[i].kind])}</summary><div class="project-prose">${esc(a?.answer)}</div>${a?feedbackHTML(a):''}</details>`).join('')}</div>`:''}<label class="field-label" for="project-answer">${task.kind==='speaking'?'Расшифровка твоей записи — можно исправить ошибки распознавания':'Твой полный ответ'}</label><textarea id="project-answer" class="answer-area" rows="12" spellcheck="false" maxlength="15000" placeholder="Сформулируй свой ответ…"></textarea><div class="answer-meta"><span id="project-words"></span><span>Черновик сохраняется</span></div>${task.kind==='speaking'?`<div class="project-record"><button class="btn" id="project-record">${icon('mic')} Записать устный ответ</button><audio id="project-audio" controls ${projectAudioURL(audio?.file)?`src="${projectAudioURL(audio.file)}"`:'hidden'}></audio><p class="small-note">Произнеси свои ответы на обе реплики собеседника. Запись сохраняется в профиле. При включённом Whisper появится расшифровка; при необходимости впиши её самостоятельно. Печатная репетиция без записи не выполняет устный этап.</p><div id="project-takes"></div></div>`:''}<div class="actions"><button class="btn primary" id="project-check">Сохранить ответ и разобрать ${icon('arrow')}</button></div><div id="project-feedback">${prior?feedbackHTML(prior):''}</div><div id="project-next"></div><div id="project-reference">${prior&&task.model?projectModelHTML(task):task.model?'<p class="small-note">Образец и пояснение откроются после сохранённой собственной попытки.</p>':''}</div>`}<details class="project-boundary"><summary>Как сохраняется работа</summary><p>Черновики, версии ответов, разбор, рефлексия и ссылки на записи входят в общий прогресс. Аудиофайлы находятся отдельно в папке профиля на этом компьютере. Новая попытка сохраняет старую в журнале; доработка относится к конкретным пяти ответам. После изменения основного ответа доработку нужно повторить.</p></details></section>`;
  $$('[data-project-stage]',root).forEach(b=>b.onclick=()=>{stopAudio();selected=b.dataset.projectStage;drawUnit();});
  if(locked)return;
  const answer=$('#project-answer',root),counter=$('#project-words',root),feedback=$('#project-feedback',root);
  answer.value=localDraft(key)!==null||Object.hasOwn(s.drafts||{},key)?getDraft(key,s):prior?.answer||'';counter.textContent=words(answer.value)+' слов';bindMistakes(root);
  if(prior&&answer.value!==prior.answer)feedback.innerHTML='';
  answer.oninput=()=>{requestID=uid();queueDraft(key,answer.value);counter.textContent=words(answer.value)+' слов';feedback.innerHTML='';$('#project-next',root).innerHTML='';};
  const saveSupport=()=>queueDraft(conditionKey,json(support));
  const transcript=$('#project-transcript',root);if(transcript)transcript.ontoggle=()=>{if(transcript.open){support.transcript=true;saveSupport();}};
  function bindModel(){const model=$('#project-model',root);if(model)model.ontoggle=()=>{if(model.open){support.model=true;saveSupport();}};}bindModel();
  $$('[data-project-listen]',root).forEach(b=>b.onclick=()=>{const m=materials.find(m=>m.id===b.dataset.projectListen);speak(m.text,1,'en-US',{button:b,isCurrent:own});});
  function drawTakes(){const box=$('#project-takes',root);if(!box)return;const takes=Object.entries(state().drafts).filter(([k])=>k.startsWith('project:take:'+unit.id+':')).map(([,d])=>projectParse(d.text)).filter(r=>r?.task===task.id&&projectAudioURL(r.file));box.innerHTML=takes.length?`<details><summary>Сохранённые записи: ${takes.length}</summary>${takes.map(t=>`<div class="project-take"><span>${esc(day(t.at))}</span><audio controls preload="none" src="${projectAudioURL(t.file)}"></audio></div>`).join('')}</details>`:'';}
  drawTakes();
  const record=$('#project-record',root);if(record)record.onclick=async ev=>{
   const button=ev.currentTarget;if(button.classList.contains('recording')){stopAudio();return;}
   const capturedAt=new Date().toISOString(),capturedAnswer=answer.value,takeID=uid(),unitID=unit.id,taskID=task.id;
   await recordOnly(button,$('#project-audio',root),async(_url,_mime,blob)=>{try{
    if(!(blob instanceof Blob)||!blob.size)throw Error('Запись пустая. Попробуй ещё раз.');
    const form=new FormData();form.append('file',blob,'project.webm');const uploaded=await api('/notebook/audio',form);if(!projectAudioURL(uploaded.audio))throw Error('Сервер не подтвердил файл записи.');
    const take={version:1,file:uploaded.audio,at:capturedAt,task:taskID};await save('project:take:'+unitID+':'+takeID,json(take));
    // A late upload keeps its immutable take without replacing a reopened editor.
    if(!own())return;audio=take;await save(audioKey,json(take));if(!own())return;drawTakes();toast('Голосовая запись сохранена.');
    if(data.settings?.whisperUrl){try{const wav=await projectWav(blob),form=new FormData();form.append('file',wav,'speech.wav');const out=await api('/transcribe',form);if(own()&&answer.value===capturedAnswer&&typeof out.text==='string'){answer.value=out.text;answer.oninput();toast('Проверь расшифровку и отправь на разбор.');}}catch(e){if(own())toast('Запись сохранена. Расшифровка недоступна: '+e.message,true);}}
   }catch(e){toast(e.message,true);}},{retainOnLeave:true});
  };
  $('#project-check',root).onclick=ev=>busy(ev.currentTarget,async()=>{
   const submittedText=answer.value,submitted=submittedText.trim(),attemptID=requestID,capturedAudio=audio,capturedSupport={...support};if(words(submitted)<4)throw Error('Нужен содержательный ответ: хотя бы четыре слова.');if(new TextEncoder().encode(submitted).length>15900)throw Error('Ответ слишком длинный. Сократи его перед разбором.');
   if(task.kind==='speaking'&&!projectAudioURL(capturedAudio?.file))throw Error('Сначала запиши устный ответ. Печатная репетиция остаётся в черновике.');
   stopAudio();await save(key,submitted);
   if(task.kind==='speaking')await save(projectReceiptKey('recording',unit.id,attemptID),json({version:1,file:capturedAudio.file,answer:submitted,at:capturedAudio.at}));
   if(isRevision)await save(projectReceiptKey('revision',unit.id,attemptID),json({version:1,answer:submitted,attemptIds:p.attempts.map(a=>a.id)}));
   await save(projectReceiptKey('conditions',unit.id,attemptID),json({version:1,...capturedSupport,at:new Date().toISOString()}));
   const result=await api('/check',{id:attemptID,lessonId:'project-'+unit.id,exerciseId:task.id,answer:submitted,mode:task.kind==='speaking'?'speaking':'writing',level:unit.level});
   data={...data,state:{...data.state,attempts:[...(data.state.attempts||[]).filter(a=>a.id!==result.id),result]}};
   try{data=hydrate(await refresh());}catch(e){if(own())toast('Ответ сохранён; обновление списка не удалось. '+e.message,true);}
   if(!(data.state.attempts||[]).some(a=>a.id===result.id))data={...data,state:{...data.state,attempts:[...(data.state.attempts||[]),result]}};
   window.dispatchEvent(new CustomEvent('planner-updated',{detail:{source:'projects',unitId:unit.id}}));
   if(!own())return;const changed=requestID!==attemptID||answer.value!==submittedText||task.kind==='speaking'&&audio?.file!==capturedAudio?.file;requestID=uid();if(changed){toast('Разбор предыдущей версии сохранён в журнале.');return;}
   // Update the result around the live editor so focus, selection and scroll stay
   // where the learner left them. Opening the new model remains a separate action.
   const after=projectProgress(unit,state());$('#project-status',root).textContent=statusText(after);
   $$('[data-project-stage]',root).forEach(button=>{const t=all.find(t=>t.id===button.dataset.projectStage),idx=unit.tasks.findIndex(x=>x.id===t.id),done=idx>=0?after.evidence[idx]:t.id==='revision'?after.revised:after.transferred;button.innerHTML=(done?icon('check'):'')+esc(labels[t.kind]);button.setAttribute('data-project-done',String(done));});
   if(task.model&&!$('#project-model',root)){$('#project-reference',root).innerHTML=projectModelHTML(task);bindModel();}
   feedback.innerHTML=feedbackHTML(result);bindMistakes(feedback);$('#project-next',root).innerHTML='<p>Ответ и разбор сохранены. Прочитай замечания и при необходимости сравни с образцом ниже.</p><button class="btn primary" id="project-continue">Продолжить</button>';
   $('#project-continue',root).onclick=()=>{selected='';drawUnit();};
  },'Разбираем работу…');
  answer.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('#project-check',root).click();}};
 }
}

// Whisper receives PCM WAV; the original browser recording remains the artifact.
async function projectWav(blob){
 const ctx=new AudioContext();let buffer;try{buffer=await ctx.decodeAudioData(await blob.arrayBuffer());}finally{await ctx.close();}
 const offline=new OfflineAudioContext(1,Math.ceil(buffer.duration*16000),16000),source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();const samples=(await offline.startRendering()).getChannelData(0),out=new ArrayBuffer(44+samples.length*2),view=new DataView(out);
 const str=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};str(0,'RIFF');view.setUint32(4,out.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples.length*2,true);samples.forEach((sample,i)=>view.setInt16(44+i*2,Math.max(-1,Math.min(1,sample))*32767,true));return new Blob([out],{type:'audio/wav'});
}
