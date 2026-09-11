import {$,$$,esc,icon,api,busy,toast,uid,getDraft,localDraft,queueDraft,words,feedbackHTML,bindMistakes,clipUTF8} from './core.js';
import {voice,stopAudio} from './audio.js';
import {transferTopics,transferQueue,transferProgress,transferSnapshot,validTransferSnapshot,transferTopicKey,transferReviewKey,transferAnswerKey,transferTask,transferIdentity} from './transfer-model.js';

const mounts=new WeakMap();
const labels={recall:'Объяснить по памяти',write:'Своя ситуация письменно',speak:'Другая ситуация голосом',revise:'Доработать после разбора'};
function parsed(text){try{return JSON.parse(text||'null');}catch{return null;}}
function storeJSON(value){const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>19500)throw Error('Запись слишком длинная. Сократи пояснение и попробуй ещё раз.');return text;}
export function transferState(data){
 const state={...data.state,drafts:{...data.state?.drafts}};
 for(const topic of transferTopics(data)){
  const key=transferTopicKey(topic.lessonId),text=getDraft(key,state);if(text)state.drafts[key]={text};
  const rounds=new Set([0,...(state.attempts||[]).map(a=>transferIdentity(a)).filter(a=>a?.lessonId===topic.lessonId).map(a=>a.round)]);
  for(const round of rounds){const key=transferReviewKey(topic.lessonId,round),text=getDraft(key,state);if(text)state.drafts[key]={text};}
 }
 return state;
}
/** Same signature as the rest of the studio: refresh returns current bootstrap data. */
export async function mountTransfer(root,data,refresh,lessonId=''){
 mounts.get(root)?.dispose?.();stopAudio();const route=location.hash,token={};mounts.set(root,token);
 const current=()=>mounts.get(root)===token&&root.isConnected&&location.hash===route;
 const dispose=()=>{stopAudio();window.removeEventListener('hashchange',dispose);window.removeEventListener('planner-updated',onUpdate);};token.dispose=dispose;
 let selectedStage=null,drawVersion=0,refreshVersion=0,topic=null,requestID=uid(),inputMode='writing';
 const hydrate=()=>{data={...data,state:transferState(data)};};hydrate();
 if(!lessonId){drawQueue();return;}
 topic=transferTopics(data).find(t=>t.lessonId===lessonId);
 if(!topic){root.innerHTML=`<section class="surface"><div class="eyebrow">ПРИМЕНЕНИЕ ТЕМ</div><h1>Сначала попробуй тему в уроке</h1><p>После своего полного ответа здесь появится работа с этой темой. Одно чтение или сохранение заметки не создаёт выполненный цикл.</p><a class="btn" href="#/transfer">К очереди тем</a> <a class="btn" href="#/roadmap">К занятиям</a></section>`;return;}
 const key=transferTopicKey(topic.lessonId),saved=parsed(getDraft(key,data.state));
 if(validTransferSnapshot(saved,topic.lessonId))topic={...topic,...saved};
 else{
  root.innerHTML='<div class="book-loading" role="status">Готовим применение твоей темы…</div>';
  let source=topic.lesson;
  if(topic.book){const result=await api('/library/unit/'+topic.lessonId.slice(5));if(!current())return;source=result.lesson;if(!source||source.id!==topic.lessonId){root.innerHTML=`<section class="surface"><h1>Материал темы пока недоступен</h1><p>Твои ответы сохранены. Для точной практики нужен подготовленный урок.</p><a class="btn" href="${esc(topic.href)}">Открыть урок</a></section>`;return;}}
  const snapshot=transferSnapshot(topic,source);await queueDraft(key,storeJSON(snapshot),true);if(!current())return;topic={...topic,...snapshot};data.state.drafts[key]={text:JSON.stringify(snapshot)};
 }
 window.addEventListener('hashchange',dispose,{once:true});window.addEventListener('planner-updated',onUpdate);draw();

 function drawQueue(){
  hydrate();const queue=transferQueue(data),shown=[...queue.due,...queue.upcoming.slice(0,5)];
  root.innerHTML=`<section class="surface"><div class="eyebrow">ВСПОМНИТЬ И ПРИМЕНИТЬ</div><h1>Тема становится твоей в собственной речи</h1><p>Вспомни назначение без опоры, напиши своё сообщение и примени тему в другой устной ситуации. После паузы вернись к новому контексту.</p><p class="small-note">До двух тем за подход. Если ты пропустил несколько дней, у каждой темы остаётся один следующий шаг. Пройденные циклы показывают практику, а не присвоенный уровень.</p>${shown.length?shown.map(t=>`<article class="planner-block"><div class="eyebrow">${t.due?'МОЖНО ПРИМЕНИТЬ СЕГОДНЯ':'СЛЕДУЮЩИЙ ВОЗВРАТ · '+esc(t.dueDay)}</div><h2>${esc(t.title)}</h2><p>${t.completedRounds?'Завершено циклов практики: '+t.completedRounds+'.':'Первое применение после урока.'} ${esc(labels[t.next])}.</p><a class="btn ${t.due?'primary':''}" href="#/transfer/${esc(t.lessonId)}">${t.due?'Открыть практику':'Посмотреть тему'} ${icon('arrow')}</a></article>`).join(''):'<p>Очередь появится после твоих содержательных ответов в уроках. Начни с темы, которая пригодится в ближайшем разговоре.</p><a class="btn primary" href="#/roadmap">Выбрать тему</a>'}<div class="actions"><a class="btn" href="#/today">К плану дня</a></div><details><summary>Как выбираются даты</summary><p>Ориентиры — через 1, 3, 7, 21 и 60 дней после фактически выполненной практики. При трудностях возвращаемся раньше; после самопроверки интервал осторожнее. Это настройка приложения, а не универсальная научная формула запоминания. Время и открытие страницы не выполняют шаги.</p></details></section>`;
 }
 async function onUpdate(event){
  if(event.detail?.source==='transfer')return;if(!current()){dispose();return;}const version=++refreshVersion;
  try{const updated=await refresh();if(current()&&version===refreshVersion){data=updated;hydrate();if(topic)draw();else drawQueue();}}catch(error){if(current())toast(error.message,true);}
 }
 function draw(){
  if(!current())return;hydrate();const progress=transferProgress(topic,data.state),version=++drawVersion;
  const future=!progress.due,round=progress.round,available=progress.stages.map(s=>s.stage),stage=selectedStage&&available.includes(selectedStage)?selectedStage:progress.next;
  const row=progress.stages.find(s=>s.stage===stage),taskKey=`transfer:task:${topic.lessonId}:${round}:${stage}`,savedTask=parsed(getDraft(taskKey,data.state));
  let task=savedTask?.version===1&&savedTask.lessonId===topic.lessonId&&savedTask.round===round&&savedTask.stage===stage&&typeof savedTask.prompt==='string'&&typeof savedTask.context==='string'?savedTask:null;
  if(!task){task=transferTask(topic,round,stage,data.state);task={...task,prompt:clipUTF8(task.prompt,5000),context:clipUTF8(task.context,12000)};queueDraft(taskKey,storeJSON(task),true);}
  const answerKey=transferAnswerKey(topic.lessonId,round,stage),modeKey=`transfer:mode:${topic.lessonId}:${round}:${stage}`;
  selectedStage=stage;requestID=uid();const own=()=>current()&&drawVersion===version;
  const prior=row?.attempt||null,latestRound=progress.history.at(-1);
  root.innerHTML=`<header class="page-header"><div class="eyebrow">ПРИМЕНЕНИЕ · ${esc(topic.level)} · AMERICAN ENGLISH</div><h1>${esc(topic.title)}</h1><p>Свои мысли сейчас, новый контекст после паузы.</p><div class="actions"><a class="btn small" href="#/transfer">Все темы</a><a class="btn small" href="${esc(topic.href)}">Исходный урок</a><a class="btn small" href="#/notebook/new/${esc(topic.lessonId)}">Моя мысль по этой теме</a><a class="btn small" href="#/today">План дня</a></div></header>
   <section class="surface"><div class="eyebrow">${round===0?'ПЕРВОЕ ПРИМЕНЕНИЕ':'ВОЗВРАТ ПОСЛЕ ПАУЗЫ · ЦИКЛ '+(round+1)}</div>${future?`<h2>Следующий шаг — ${esc(progress.dueDay)}</h2><p>Последний цикл практики сохранён.${latestRound?.selfChecked?' Проверку ты отметил самостоятельно.':''}${latestRound?.needsWork?' В разборе остались трудности, поэтому вернёмся раньше.':''} Пока можно продолжить другую тему.</p><a class="btn primary" href="#/today">Продолжить план</a>`:`<div class="actions" role="group" aria-label="Шаги применения">${progress.stages.map((r,i)=>`<button class="btn small ${r.stage===stage?'primary':''}" data-transfer-stage="${r.stage}" ${!r.done&&r.stage!==progress.next?'disabled':''}>${r.done?icon('check'):String(i+1)+'.'} ${esc(labels[r.stage])}</button>`).join('')}</div><h2>${esc(labels[stage])}</h2><p class="book-task-context" id="transfer-prompt">${esc(task.prompt)}</p>
   ${stage==='revise'?`<details open><summary>Предыдущая работа и разбор</summary><div class="book-legacy" style="white-space:pre-wrap">${esc(task.context.slice((topic.context||'').length))}</div></details>`:''}
   <label class="field-label" for="transfer-answer">${stage==='recall'?'Объяснение своими словами и два английских примера':stage==='speak'?'Расшифровка твоей устной попытки':'Твой полный ответ'}</label><textarea id="transfer-answer" class="answer-area" rows="10" spellcheck="false" placeholder="${stage==='speak'?'Нажми микрофон и ответь без готового текста…':'Начни со своей мысли…'}"></textarea><div class="answer-meta"><span id="transfer-words"></span><span>Черновик сохраняется</span></div>
   <div class="actions"><button class="btn" id="transfer-voice">${icon('mic')} Надиктовать ответ</button><button class="btn primary" id="transfer-check">Сохранить и разобрать ${icon('arrow')}</button></div><audio id="audio-preview" class="audio-preview" controls hidden></audio><p class="small-note">${stage==='speak'?'Печатный текст — письменная репетиция. Этот шаг выполняется ответом через микрофон. ':''}Проверка расшифровки оценивает смысл и язык, а не звуки или акцент. Другие стандартные варианты английского допустимы.</p><div id="transfer-feedback"></div><div id="transfer-next"></div>
   ${stage==='revise'&&progress.ungraded&&!progress.needsWork?`<details><summary>Проверить самостоятельно без оценки ИИ</summary><p>Сверь назначение темы, свои примеры и уместность формулировок с опорой. Это будет отдельная отметка самопроверки.</p><label for="transfer-self-note">Что ты проверил и что стоит повторить</label><textarea id="transfer-self-note" rows="3"></textarea><button class="btn" id="transfer-self-check">Я проверил свою работу</button></details>`:''}`}
   <details id="transfer-notes"><summary>Открыть опору после своей попытки</summary><p class="small-note">Сначала восстанови смысл по памяти. Открытие этой опоры не выполняет практику.</p><div style="white-space:pre-wrap">${esc(topic.context)}</div></details><p class="small-note">Выполнено циклов: ${progress.completedRounds}. Это история практики, а не оценка владения темой.</p></section>`;
  if(future)return;
  $$('[data-transfer-stage]',root).forEach(button=>button.onclick=()=>{stopAudio();selectedStage=button.dataset.transferStage;draw();});
  const target=$('#transfer-answer',root),counter=$('#transfer-words',root),feedback=$('#transfer-feedback',root),next=$('#transfer-next',root);
  const hasDraft=localDraft(answerKey)!==null||Object.hasOwn(data.state.drafts,answerKey);target.value=hasDraft?getDraft(answerKey,data.state):prior?.answer||'';
  const storedMode=parsed(getDraft(modeKey,data.state));inputMode=storedMode?.answer===target.value&&storedMode.mode==='speaking'?'speaking':prior&&prior.answer===target.value?prior.mode||'writing':'writing';counter.textContent=words(target.value)+' слов';
  if(prior&&prior.answer===target.value){feedback.innerHTML=feedbackHTML(prior);bindMistakes(feedback);}
  const changed=()=>{queueDraft(answerKey,target.value);queueDraft(modeKey,storeJSON({mode:inputMode,answer:target.value}));requestID=uid();counter.textContent=words(target.value)+' слов';feedback.innerHTML='';next.innerHTML='';};
  target.oninput=()=>{inputMode='writing';changed();};
  $('#transfer-voice',root).onclick=event=>voice(event.currentTarget,target,data.settings,()=>{if(own()){inputMode='speaking';changed();}});
  $('#transfer-check',root).onclick=event=>busy(event.currentTarget,async()=>{
   const submitted=target.value,mode=inputMode;if(words(submitted)<4)throw Error('Сформулируй полный ответ: нужны хотя бы четыре слова.');
   const payload={id:requestID,lessonId:'free',exerciseId:task.exerciseId,prompt:clipUTF8(task.prompt,11900),context:clipUTF8(task.context,15900),answer:submitted,mode,level:task.level};
   stopAudio();await queueDraft(answerKey,submitted,true);const result=await api('/check',payload);
   // The submitted result belongs to its captured round and stage, even after navigation.
   let updated;try{updated=await refresh();}catch(error){if(own())toast('Ответ сохранён, но обновление списка не удалось. '+error.message,true);}
   if(!own())return;if(updated)data=updated;
   data={...data,state:{...data.state,attempts:[...(data.state.attempts||[]).filter(a=>a.id!==result.id),result]}};hydrate();
   window.dispatchEvent(new CustomEvent('planner-updated',{detail:{source:'transfer',lessonId:topic.lessonId}}));
   if(target.value!==submitted){toast('Разбор предыдущей версии сохранён в журнале.');return;}
   feedback.innerHTML=feedbackHTML(result);bindMistakes(feedback);
   const after=transferProgress(topic,data.state);next.innerHTML=`<p>${stage==='speak'&&mode!=='speaking'?'Письменная репетиция сохранена. Для устного шага теперь ответь через микрофон.':after.completedRounds>progress.completedRounds?'Цикл практики сохранён. Следующий возврат: '+esc(after.dueDay)+'.':after.next==='revise'?'Прочитай разбор и доработай свою формулировку.':'Ответ сохранён. Продолжи применение темы.'}</p><button class="btn primary" id="transfer-continue">${after.completedRounds>progress.completedRounds?'Посмотреть следующий шаг':'Продолжить'} ${icon('arrow')}</button>`;
   $('#transfer-continue',root).onclick=()=>{selectedStage=null;draw();};
  },'Разбираем твою мысль…');
  target.onkeydown=event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();$('#transfer-check',root).click();}};
  const self=$('#transfer-self-check',root),selfNote=$('#transfer-self-note',root),selfNoteKey=`transfer:self-note:${topic.lessonId}:${round}`;
  if(selfNote){selfNote.value=getDraft(selfNoteKey,data.state);selfNote.oninput=()=>queueDraft(selfNoteKey,selfNote.value);}
  if(self)self.onclick=event=>busy(event.currentTarget,async()=>{
   const note=$('#transfer-self-note',root).value.trim();if(words(note)<4)throw Error('Запиши конкретно, что проверил: хотя бы четыре слова.');
   // Re-read evidence immediately; a late check must not certify a newer response.
   const at=new Date().toISOString(),entry={version:1,kind:'self-check',checked:true,at,note,attemptIds:progress.attempts.map(a=>a.id)};
   const key=transferReviewKey(topic.lessonId,round);await queueDraft(key,storeJSON(entry),true);if(!own())return;data.state.drafts[key]={text:JSON.stringify(entry)};selectedStage=null;draw();window.dispatchEvent(new CustomEvent('planner-updated',{detail:{source:'transfer',lessonId:topic.lessonId}}));
  });
 }
}
