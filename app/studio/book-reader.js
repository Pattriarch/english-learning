import {$,$$,esc,icon,api,busy,toast,getDraft,localDraft,queueDraft,words,feedbackHTML,bindMistakes,uid,progressLesson,cardModal} from './core.js';
import {recordOnly,stopAudio,speak} from './audio.js';
import {exerciseMaterials,mountLessonMaterials} from './lesson-materials.js';
import {remapBookStudyPlan,bookStudyProgress} from './book-study-model.js';

export function bookParagraphs(value){
 return String(value||'').split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${esc(p).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>')}</p>`).join('');
}
const kindName={translate:'Перевести целиком',rewrite:'Переформулировать',write:'Написать свой текст',speak:'Рассказать',correct:'Найти и исправить ошибку',explain:'Объяснить выбор',contrast:'Сравнить смысл'};
const pdfLink=(b,u)=>`/books/${encodeURIComponent(b.filename)}#page=${u.page}`;
const mountedBooks=new WeakMap();
export async function loadBookStatus(data){
 try{const response=await fetch('/book-content/status.json');if(response.ok)return await response.json();}catch{}
 return data.bookStatus||{ready:0,units:{},books:{}};
}
export function bookAttemptState(state,lesson,library){
 const versioned=new Set(lesson.exercises.filter(ex=>/--[a-f0-9]{16}$/.test(ex.id)).map(ex=>ex.id));
 const aliases=new Set(),freeIDs=new Map(lesson.exercises.map(ex=>[lesson.id+'-'+ex.id,ex.id]));
 const books=library?.books||[];
 // Match the catalog's explicit equivalence, as the book endpoint does. Never
 // infer an alias from spelling or strip a task hash to recover old credit.
 if(books.some(book=>!book.duplicateOf&&book.units.some(unit=>'book-'+unit.id===lesson.id))){
  for(const book of books)for(const unit of book.units){
   if(unit.equivalentUnitId&&'book-'+unit.equivalentUnitId===lesson.id&&'book-'+unit.id!==lesson.id){
    const alias='book-'+unit.id;aliases.add(alias);
    for(const id of versioned)freeIDs.set(alias+'-'+id,id);
   }
  }
 }
 return {...state,attempts:(state.attempts||[]).map(a=>{
  if(a.lessonId==='free'&&freeIDs.has(a.exerciseId))return {...a,lessonId:lesson.id,exerciseId:freeIDs.get(a.exerciseId)};
  if(aliases.has(a.lessonId)&&versioned.has(a.exerciseId))return {...a,lessonId:lesson.id};
  return a;
 })};
}
export async function bookExerciseID(exercise,materials=[]){
 let text=[exercise.kind||'',exercise.prompt||'',exercise.context||'',exercise.hint||'',exercise.explanation||'',(exercise.answers||[]).join('\u001e')].join('\u001f');
 const selected=exerciseMaterials({materials},exercise);
 if(selected.length)text+='\u001fmaterials-v1\u001f'+selected.map(m=>[m.id,m.title,m.kind,m.text,m.source,m.sourceUrl,m.audioFile,m.inputSkill,m.figure?.id,m.figure?.format,m.figure?.alt,m.figure?.caption].map(value=>value??'').join('\u001d')).join('\u001e');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 const suffix=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
 return exercise.id.replace(/--[a-f0-9]{16}$/,'')+'--'+suffix;
}

// Plan IDs define the teaching order; retain raw indices for stable task links
// and append any unlisted exercises so navigation can never hide a task.
export function bookExerciseOrder(lesson){
 const byID=new Map(lesson.exercises.map((ex,i)=>[ex.id,i])),seen=new Set(),order=[];
 for(const id of (lesson.studyPlan?.stages||[]).flatMap(stage=>stage.exerciseIds||[])){
  if(byID.has(id)&&!seen.has(id)){seen.add(id);order.push(byID.get(id));}
 }
 lesson.exercises.forEach((ex,i)=>{if(!seen.has(ex.id))order.push(i);});return order;
}
const bookAudioURL=file=>/^[a-f0-9]{64}\.(webm|wav|ogg|m4a)$/.test(file||'')?'/media/'+file:'';
export function bookRecordings(drafts,lessonId,exerciseId){
 const prefix='book-recording:'+lessonId+':'+exerciseId+':';
 return Object.entries(drafts||{}).flatMap(([key,draft])=>{
  if(!key.startsWith(prefix)||key===prefix)return [];
  try{const record=JSON.parse(typeof draft==='string'?draft:draft?.text);
   return record?.version===1&&record.lessonId===lessonId&&record.exerciseId===exerciseId&&bookAudioURL(record.file)&&Number.isFinite(Date.parse(record.at))?[{...record,key}]:[];
  }catch{return [];}
 }).sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key));
}
async function bookSpeechWAV(blob){
 const ctx=new AudioContext();let buffer;try{buffer=await ctx.decodeAudioData(await blob.arrayBuffer());}finally{await ctx.close();}
 const offline=new OfflineAudioContext(1,Math.ceil(buffer.duration*16000),16000),source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();
 const samples=(await offline.startRendering()).getChannelData(0),out=new ArrayBuffer(44+samples.length*2),view=new DataView(out);
 const str=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
 str(0,'RIFF');view.setUint32(4,out.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples.length*2,true);
 samples.forEach((sample,i)=>view.setInt16(44+i*2,Math.max(-1,Math.min(1,sample))*32767,true));return new Blob([out],{type:'audio/wav'});
}

export async function mountBookUnit(root,data,id,refresh){
 const book=data.library?.books?.find(b=>b.units.some(u=>u.id===id)),unit=book?.units.find(u=>u.id===id),route=location.hash;
 const mount={};mountedBooks.set(root,mount);const current=()=>mountedBooks.get(root)===mount&&root.isConnected&&location.hash===route;
 if(!unit){root.innerHTML='<h1>Юнит не найден</h1><a class="btn" href="#/books">К библиотеке</a>';return;}
 root.innerHTML='<div class="book-loading" role="status">Открываем урок…</div>';
 const payload=await api('/library/unit/'+id);if(!current())return;
 const legacyServer=!Object.prototype.hasOwnProperty.call(payload,'lessonStatus'),versionedChecks=payload.taskVersions===true,canonical=payload.canonicalUnitId||unit.equivalentUnitId||id;
 let lesson=payload.lesson;
 if(!lesson&&legacyServer){
  try{const [response,statusResponse]=await Promise.all([fetch('/book-content/'+encodeURIComponent(canonical)+'.json'),fetch('/book-content/status.json')]);if(response.ok&&statusResponse.ok){const [candidate,status]=await Promise.all([response.json(),statusResponse.json()]);if(status.units?.[canonical]?.status==='ready'&&candidate.id==='book-'+canonical&&candidate.provenance?.unitId===canonical&&candidate.sections?.length>=4&&candidate.exercises?.length>=8)lesson=candidate;}}catch{}
  if(!current())return;
 }
 if(lesson){
  const originalExercises=lesson.exercises,exercises=await Promise.all(originalExercises.map(async ex=>({...ex,id:await bookExerciseID(ex,lesson.materials)})));
  if(!current())return;
  const studyPlan=remapBookStudyPlan(lesson.studyPlan,originalExercises,exercises);
  if(lesson.studyPlan&&!studyPlan)throw Error('План урока не соответствует текущим заданиям. Открой урок заново после обновления материалов.');
  lesson={...lesson,exercises,...(studyPlan?{studyPlan}:{})};
 }
 const prev=book.units.find(u=>u.unit===unit.unit-1),next=book.units.find(u=>u.unit===unit.unit+1);
 const top=`<div class="book-breadcrumb"><a href="#/books">${icon('book')} Библиотека</a><span>/</span><span>${esc(book.title)}</span></div><header class="book-heading"><div class="eyebrow">UNIT ${String(unit.unit).padStart(2,'0')} · ${esc(lesson?.level||book.level)}</div><h1>${esc(lesson?.title||unit.titleRu||unit.title)}</h1><p>${esc(lesson?.goal||unit.title)}</p><div class="book-heading-meta"><span>${lesson?lesson.minutes+' минут · '+lesson.exercises.length+' заданий':'Страницы '+unit.page+'–'+unit.endPage}</span><a href="${pdfLink(book,unit)}" target="_blank" rel="noopener">Оригинал в PDF ${icon('arrow')}</a></div></header>`;
 if(!lesson){
  root.innerHTML=top+`<section class="surface book-pending"><div class="eyebrow">УРОК ГОТОВИТСЯ</div><h2>Здесь будет полный разбор юнита.</h2><p>Объяснение по-русски, разобранные примеры и задания по материалу этих страниц. Урок появится здесь после обработки книги.</p><div class="actions"><button class="btn primary" id="book-reload">Проверить готовность</button><a class="btn" href="${pdfLink(book,unit)}" target="_blank" rel="noopener">Открыть страницы книги</a></div><p class="small-note">Готовые уроки доступны в библиотеке. Этот юнит ещё в обработке.</p></section>`;
  $('#book-reload',root).onclick=e=>busy(e.currentTarget,()=>mountBookUnit(root,data,id,refresh));return;
 }
 const answered=new Set(bookAttemptState(data.state,lesson,data.library).attempts.filter(a=>a.lessonId===lesson.id&&a.answer?.trim()).map(a=>a.exerciseId));
 const initialStudy=bookStudyProgress(lesson,bookAttemptState(data.state,lesson,data.library));
 const exerciseOrder=bookExerciseOrder(lesson),recordedDrafts={};
 const recordingDrafts=()=>{
  const drafts={...data.state.drafts,...recordedDrafts};
  // Keep uploaded takes discoverable if only their metadata is awaiting an
  // offline draft retry, including after a reload. Never scan unrelated data.
  try{for(let i=0;i<localStorage.length;i++){const storageKey=localStorage.key(i);if(storageKey?.startsWith('ew-draft:book-recording:'+lesson.id+':')){const key=storageKey.slice(9);drafts[key]={text:getDraft(key,data.state)};}}}catch{}
  return drafts;
 };
 const recordingsFor=exerciseId=>bookRecordings(recordingDrafts(),lesson.id,exerciseId);
 const diagnosticPending=initialStudy?.stages.some(stage=>stage.id==='diagnostic'&&!stage.complete);
 let tab=diagnosticPending?'practice':'theory',step=exerciseOrder.find(i=>initialStudy?lesson.exercises[i].id===initialStudy.nextExerciseId:!answered.has(lesson.exercises[i].id))??exerciseOrder[0],playRequest=0,transferTimer;
 const requestedExercise=route.split('/')[3],requestedIndex=requestedExercise?lesson.exercises.findIndex(ex=>ex.id===requestedExercise):-1;
 if(requestedIndex>=0){step=requestedIndex;tab='practice';}
 const noteKey='unit-notes:'+id;
 const confirmedAttempts=new Map();
 root.innerHTML=top+`<div class="book-tabs" role="group" aria-label="Разделы урока"><button data-book-tab="theory" class="active" aria-pressed="true">01 <span>Разобраться</span></button><button data-book-tab="practice" aria-pressed="false">02 <span>Попрактиковаться</span></button><button data-book-tab="notes" aria-pressed="false">03 <span>Мой конспект</span></button></div>${lesson.studyPlan?'<section class="book-study-plan" id="book-study-plan" aria-label="План самостоятельного урока"></section>':''}<div class="book-reader-layout"><div id="book-main"></div><aside class="book-outline"><div class="eyebrow">В ЭТОМ ЮНИТЕ</div><nav aria-label="План юнита">${lesson.sections.map((s,i)=>`<button data-book-section="${i}"><span>${String(i+1).padStart(2,'0')}</span>${esc(s.title)}</button>`).join('')}</nav><div class="book-progress" id="book-progress"></div><div class="book-neighbours">${prev?`<a href="#/unit/${prev.id}">← Юнит ${prev.unit}</a>`:''}${next?`<a href="#/unit/${next.id}">Юнит ${next.unit} →</a>`:''}</div></aside></div>`;
 const studyProgress=()=>bookStudyProgress(lesson,bookAttemptState(data.state,lesson,data.library));
 const dueDate=at=>new Date(at).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
 const recordingDate=at=>new Date(at).toLocaleString('ru-RU',{year:'numeric',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 function renderStudyPlan(progress){
  if(!progress)return;
  const selected=progress.stages.find(stage=>stage.exerciseIds.includes(lesson.exercises[step].id)),container=$('#book-study-plan',root);
  container.innerHTML=`<div class="book-study-intro"><div><span class="eyebrow">ПОНЯТЬ → ПРИМЕНИТЬ → ВЕРНУТЬСЯ</span><h2>План самостоятельной работы</h2></div><p>${progress.stages.filter(stage=>stage.complete).length} из 6 этапов · ${progress.completed} из ${progress.total} заданий</p></div><div class="book-study-stages">${progress.stages.map((stage,i)=>`<button type="button" data-book-stage="${stage.id}" class="book-study-stage ${stage.complete?'complete':''} ${tab==='practice'&&selected?.id===stage.id?'active':''}" aria-pressed="${tab==='practice'&&selected?.id===stage.id}"><span class="book-study-stage-number">${String(i+1).padStart(2,'0')}</span><strong>${esc(stage.title)}</strong><span class="book-study-stage-count">${stage.completed} / ${stage.total} заданий · ${stage.minutes} мин</span><span class="book-study-stage-status">${stage.complete?'Выполнено':stage.id==='transfer'&&progress.dueAt!==null?progress.transferReady?'Можно закреплять':'С '+esc(dueDate(progress.dueAt)):stage.id==='transfer'?'После исправлений и паузы':'Можно открыть'}</span></button>`).join('')}</div><p class="small-note">Первые четыре этапа учитывают твои содержательные ответы; устные задания — ответы голосом. Исправления и перенос требуют верного разбора. Время занятия и отметка о прочтении не завершают задания.</p>`;
  $$('[data-book-stage]',container).forEach(button=>button.onclick=()=>{const stage=progress.stages.find(stage=>stage.id===button.dataset.bookStage);const first=stage.exerciseIds.find(id=>!progress.acceptedExerciseIds.includes(id))||stage.exerciseIds[0];step=lesson.exercises.findIndex(ex=>ex.id===first);tab='practice';draw();$('#book-main',root).scrollIntoView({block:'start'});});
 }
 function updateProgress(){
  const study=studyProgress();renderStudyPlan(study);
  if(study){$('#book-progress',root).innerHTML=`<strong>${study.completed}<span> / ${study.total}</span></strong><p>заданий засчитано по этапам</p><div class="progress-track"><span style="width:${study.completed/study.total*100}%"></span></div><small>${study.complete?'Все этапы этого урока выполнены.':study.dueAt!==null&&!study.transferReady?'Перенос в новую ситуацию — с '+esc(dueDate(study.dueAt))+'.':'Продолжай по плану выше. Исправления и отложенный перенос учитываются отдельно.'}</small>`;return;}
  const p=progressLesson(lesson,bookAttemptState(data.state,lesson,data.library));$('#book-progress',root).innerHTML=`<strong>${p.tried}<span> / ${p.total}</span></strong><p>заданий с твоим ответом</p><div class="progress-track"><span style="width:${p.tried/p.total*100}%"></span></div><small>${p.correct} выполнено верно · ${data.state.read[lesson.id]||data.state.read[canonical]?'теория прочитана':'теория ещё не отмечена'}</small>`;
 }
 function draw(){
  clearTimeout(transferTimer);playRequest++;stopAudio();$$('[data-book-tab]',root).forEach(b=>{b.classList.toggle('active',b.dataset.bookTab===tab);b.setAttribute('aria-pressed',String(b.dataset.bookTab===tab));});
  const main=$('#book-main',root);updateProgress();
  if(tab==='theory'){
   main.innerHTML=`<article class="book-theory">${lesson.formula?`<div class="book-key"><span class="eyebrow">ОПОРНАЯ ИДЕЯ</span><div>${esc(lesson.formula)}</div></div>`:''}${lesson.sections.map((s,i)=>`<section class="book-section" id="book-section-${i}"><div class="book-section-number">${String(i+1).padStart(2,'0')}</div><h2>${esc(s.title)}</h2>${bookParagraphs(s.body)}</section>`).join('')}<section class="book-section"><div class="eyebrow">ОТ СМЫСЛА К ФОРМЕ</div><h2>Разбираем на примерах</h2><div class="book-examples">${lesson.examples.map((ex,i)=>`<article class="book-example"><div class="spread"><span class="small-note">ПРИМЕР ${i+1}</span><div class="actions"><button class="btn ghost small" data-example-speak="${i}" aria-label="Прослушать пример ${i+1}">${icon('sound')}</button><button class="btn ghost small" data-example-card="${i}" aria-label="В карточки: пример ${i+1}">${icon('cards')}</button></div></div><p class="book-en">${esc(ex.en)}</p><p class="book-ru">${esc(ex.ru)}</p><p class="book-why">${esc(ex.why)}</p></article>`).join('')}</div></section><details class="book-source-map"><summary>Что перенесено из этого юнита</summary><p>Самостоятельный разбор по ${esc(book.title)}, юнит ${unit.unit}. Названия ниже связывают материал книги с разделами урока.</p><ul>${lesson.provenance.sourceCoverage.map(c=>`<li><strong>${esc(c.point)}</strong><br><span>${esc(c.sectionTitle)}</span></li>`).join('')}</ul>${lesson.provenance.warnings?.length?`<p class="small-note">Примечания к разбору: ${esc(lesson.provenance.warnings.join(' · '))}</p>`:''}<a class="text-link" href="${pdfLink(book,unit)}" target="_blank" rel="noopener">Свериться с оригиналом →</a></details><div class="book-bottom-actions"><button class="btn" id="book-read">${icon('check')} ${data.state.read[lesson.id]||data.state.read[canonical]?'Теория прочитана':'Отметить прочитанным'}</button><button class="btn primary" id="book-start">Перейти к практике ${icon('arrow')}</button></div></article>`;
   $('.book-examples',main).insertAdjacentHTML('beforebegin','<audio id="book-model-audio" class="audio-preview" controls hidden></audio><p id="book-model-voice" class="small-note" role="status" hidden></p><button class="btn small ghost" id="book-model-stop">Остановить озвучку</button>');
   $('#book-model-stop',main).onclick=()=>{playRequest++;stopAudio();};
   $$('[data-example-speak]',main).forEach(b=>b.onclick=async()=>{
    const request=++playRequest,text=lesson.examples[+b.dataset.exampleSpeak].en;
    await speak(text,.9,'en-US',{player:$('#book-model-audio',main),status:$('#book-model-voice',main),button:b,isCurrent:()=>current()&&b.isConnected&&request===playRequest});
   });
   $$('[data-example-card]',main).forEach(b=>b.onclick=()=>{const ex=lesson.examples[+b.dataset.exampleCard];cardModal({front:ex.ru,back:ex.en,note:ex.why,source:lesson.title});});
   $('#book-start',main).onclick=()=>{tab='practice';draw();main.scrollIntoView({block:'start'});};
   $('#book-read',main).onclick=e=>busy(e.currentTarget,async()=>{await api('/read',{id:lesson.id});data.state.read[lesson.id]=new Date().toISOString();await api('/read',{id:canonical});data.state.read[canonical]=new Date().toISOString();if(!current())return;updateProgress();toast('Теория отмечена. Теперь закрепи её в своих ответах.');});
  }else if(tab==='notes'){
   const legacy=[0,1,2,3].map(i=>getDraft('unit-answer:'+id+':'+i,data.state)).filter(Boolean);
   main.innerHTML=`<section class="surface book-notes"><div class="eyebrow">СВОИМИ СЛОВАМИ</div><h2>Что я хочу запомнить</h2><p>Запиши разницу, которая стала понятнее, свой пример и вопрос, к которому стоит вернуться.</p><label class="field-label" for="book-notes">Твой конспект</label><textarea id="book-notes" rows="16" placeholder="Раньше я путал… Теперь понимаю… Мой пример…">${esc(getDraft(noteKey,data.state))}</textarea><p class="small-note">Сохраняется автоматически вместе с прогрессом.</p>${legacy.length?`<details><summary>Мои ответы в предыдущей рабочей тетради</summary>${legacy.map(t=>`<p class="book-legacy">${esc(t)}</p>`).join('')}</details>`:''}</section>`;
   $('#book-notes',main).oninput=e=>queueDraft(noteKey,e.target.value);
  }else drawPractice(main);
 }
 function drawPractice(main){
  const ex=lesson.exercises[step],key=lesson.id+':'+ex.id,study=studyProgress(),stage=study?.stages.find(stage=>stage.exerciseIds.includes(ex.id));
  const attempt=study?study.attemptByID[ex.id]:bookAttemptState(data.state,lesson,data.library).attempts.filter(a=>a.lessonId===lesson.id&&a.exerciseId===ex.id).at(-1),isRevision=stage?.id==='revision',isTransfer=stage?.id==='transfer',transferLocked=isTransfer&&!study.transferReady;
  const ownProduction=isRevision?study.productionAttempts.filter(item=>item.submitted):[];
  const ownWork=isRevision?study.productionAttempts.filter(item=>item.submitted||recordingsFor(item.exercise.id).length):[];
  const productionHTML=isRevision?`<section class="book-own-production"><h3>Твои исходные ответы</h3>${ownWork.length?ownWork.map(item=>{const takes=recordingsFor(item.exercise.id);return `<article><p class="small-note">${esc(item.exercise.prompt)}</p>${item.submitted?`<p class="book-own-answer" lang="en">${esc(item.attempt.answer)}</p>`:'<p>Запись сохранена; ответ ещё не отправлен на разбор.</p>'}${takes.length?`<div class="book-production-recordings"><p class="small-note">Записи этого задания · выбери нужную попытку по дате</p>${takes.map(take=>`<div><p class="small-note">${esc(recordingDate(take.at))}</p><audio class="audio-preview" controls preload="none" src="${bookAudioURL(take.file)}" aria-label="Твоя запись: ${esc(item.exercise.prompt)} · ${esc(recordingDate(take.at))}"></audio></div>`).join('')}</div>`:item.attempt?.mode==='speaking'?'<p class="small-note">У этого прежнего устного ответа нет сохранённой аудиозаписи.</p>':''}${item.submitted&&item.attempt.feedback?`<details><summary>Разбор этого ответа</summary>${feedbackHTML(item.attempt)}</details>`:''}</article>`;}).join(''):'<p>Сначала напиши текст и ответь голосом на этапе самостоятельной работы. Здесь появятся именно твои ответы для переработки.</p>'}${!study.produced?'<p class="small-note">Этап исправлений будет засчитан после всех ответов этапа самостоятельной работы и нового верного разбора.</p>':''}</section>`:'';
  const practiceFooter=study?`<p class="small-note">Закрепление темы — на этапе переноса в плане этого урока: <button type="button" class="text-link" id="book-transfer-stage">открыть отложенный перенос</button> или <a href="#/notebook/new/${lesson.id}">сохранить свою мысль</a>.</p>`:`<p class="small-note">После упражнений: <a href="#/transfer/${lesson.id}">применить тему в новой ситуации</a> или <a href="#/notebook/new/${lesson.id}">сформулировать свою мысль и сохранить её</a>.</p>`;
  let request=uid(),recordingKey='',speakingAttemptId='',editVersion=0,recordGeneration=0,recordPending=false;
  const position=exerciseOrder.indexOf(step);
  const sourceID=ex.id.replace(/--[a-f0-9]{16}$/,''),reference=/^e\d+$/.test(sourceID)?sourceID:'';
  const stepCounter=`Шаг ${position+1} из ${lesson.exercises.length}${reference?' · задание '+reference:''}`;
  main.innerHTML=`<section class="surface book-practice"><div class="book-exercise-nav" role="group" aria-label="Задания">${exerciseOrder.map(i=>{const e=lesson.exercises[i],number=exerciseOrder.indexOf(i)+1;if(stage&&!stage.exerciseIds.includes(e.id))return '';const a=bookAttemptState(data.state,lesson,data.library).attempts.filter(a=>a.lessonId===lesson.id&&a.exerciseId===e.id).at(-1),done=study?study.acceptedExerciseIds.includes(e.id):a?.feedback?.verdict==='correct';return `<button data-book-exercise="${i}" class="${i===step?'active':done?'done':''}" aria-label="Задание ${number}" aria-pressed="${i===step}">${number}</button>`;}).join('')}</div>${stage?`<div class="book-current-stage"><span class="eyebrow">${esc(stage.title)}</span><p>${esc(stage.purpose)}</p></div>`:''}<div class="eyebrow">${esc(kindName[ex.kind]||'Сформулировать самостоятельно')} · ${stepCounter}</div><h2 class="book-prompt">${esc(ex.prompt)}</h2><section class="lesson-materials book-task-materials" id="book-task-materials" aria-label="Материалы текущего задания" hidden></section>${ex.context?`<div class="book-task-context">${bookParagraphs(ex.context)}</div>`:''}${productionHTML}${transferLocked?`<div class="book-transfer-lock" role="status"><strong>${study.dueAt===null?'Сначала заверши исправления':'Вернись к этому заданию позже'}</strong><p>${study.dueAt===null?'Перенос откроется через '+lesson.studyPlan.transfer.delayDays+' дней после верного разбора всех исправлений. Задание можно посмотреть заранее и сохранить черновик.':'Проверка будет доступна с '+esc(dueDate(study.dueAt))+'. Пауза нужна, чтобы извлечь знания из памяти и применить их в новой ситуации.'}</p></div>`:''}<div class="answer-input-header"><label class="field-label" for="answer">Твой ответ на английском</label><button type="button" class="btn" id="book-voice" aria-controls="answer">${icon('mic')} Надиктовать ответ</button></div><textarea id="answer" class="answer-area" rows="9" placeholder="Напиши или надиктуй целый ответ. Допустимые варианты тоже учитываются."></textarea><div class="answer-meta"><span id="book-words"></span><span>Черновик сохраняется</span></div><div class="actions"><button class="btn primary" id="book-check" ${transferLocked?'disabled':''}>Получить разбор ${icon('arrow')}</button></div><audio id="audio-preview" class="audio-preview" controls hidden></audio><div id="book-recordings"></div><p class="small-note" id="book-record-status" role="status"></p><p class="small-note book-voice-note">При диктовке проверяется расшифровка: смысл, грамматика и словоупотребление. Произношение по тексту не оценивается.</p>${ex.hint?`<details class="book-hint"><summary>Небольшая подсказка</summary>${bookParagraphs(ex.hint)}</details>`:''}<div id="book-feedback"></div><details class="book-reference"><summary>Разобрать пример ответа</summary>${ex.answers.map(a=>`<p class="book-en">${esc(a)}</p>`).join('')}${bookParagraphs(ex.explanation)}</details><div class="book-bottom-actions"><button class="btn small" id="book-ex-prev" ${position===0?'disabled':''}>← Предыдущее</button><button class="btn small" id="book-ex-next" ${position===exerciseOrder.length-1?'disabled':''}>Следующее →</button></div>${practiceFooter}</section>`;
  mountLessonMaterials($('#book-task-materials',main),lesson,ex,data.state);
  if(transferLocked&&study.dueAt!==null){const index=step;transferTimer=setTimeout(()=>{if(current()&&tab==='practice'&&step===index)draw();},Math.min(2147483647,Math.max(1,study.dueAt-Date.now())));transferTimer?.unref?.();}
  const target=$('#answer',main),feedback=$('#book-feedback',main),counter=$('#book-words',main);
  target.value=localDraft(key)!==null||Object.prototype.hasOwnProperty.call(data.state.drafts,key)?getDraft(key,data.state):attempt?.answer||'';
  if(attempt&&attempt.answer===target.value.trim()){feedback.innerHTML=feedbackHTML(attempt);if(attempt.mode==='speaking'&&attempt.id)speakingAttemptId=attempt.id;}
  const inputKey='book-input:'+key;
  const own=()=>current()&&target.isConnected&&$('#answer',root)===target;
  const knownSpeaking=id=>id&&bookAttemptState(data.state,lesson,data.library).attempts.some(a=>a.id===id&&a.lessonId===lesson.id&&a.exerciseId===ex.id&&a.mode==='speaking');
  try{const input=JSON.parse(getDraft(inputKey,data.state));if(input?.version===2&&input.answer===target.value){
   if(recordingsFor(ex.id).some(take=>take.key===input.recordingKey))recordingKey=input.recordingKey;
   if(knownSpeaking(input.speakingAttemptId))speakingAttemptId=input.speakingAttemptId;
  }}catch{}
  const inputMode=()=>recordingsFor(ex.id).some(take=>take.key===recordingKey)||knownSpeaking(speakingAttemptId)?'speaking':'writing';
  const saveInput=(immediate=false)=>queueDraft(inputKey,JSON.stringify({version:2,answer:target.value,recordingKey,speakingAttemptId}),immediate);
  const onInput=()=>{if(!own())return;editVersion++;queueDraft(key,target.value);saveInput();request=uid();counter.textContent=words(target.value)+' слов';feedback.innerHTML='';};
  // Correcting capitalization or intonation marks in a real spoken response
  // does not turn it into writing. An unverified legacy mode flag cannot turn
  // an independently typed answer into speech.
  target.oninput=onInput;counter.textContent=words(target.value)+' слов';
  const recordStatus=$('#book-record-status',main),preview=$('#audio-preview',main);
  function renderRecordings(){
   if(!own())return;
   const takes=recordingsFor(ex.id),box=$('#book-recordings',main);
   box.innerHTML=takes.length?`<details open><summary>Твои сохранённые записи · ${takes.length}</summary>${takes.map(take=>`<div><p class="small-note">${esc(recordingDate(take.at))}${take.key===recordingKey?' · связана с этим черновиком':''}</p><audio class="audio-preview" controls preload="none" src="${bookAudioURL(take.file)}" aria-label="Твоя запись от ${esc(recordingDate(take.at))}"></audio>${take.key!==recordingKey?`<button type="button" class="btn small ghost" data-book-use-recording="${esc(take.key)}">Работать с расшифровкой этой записи</button>`:''}</div>`).join('')}</details>`:'';
   $$('[data-book-use-recording]',box).forEach(button=>button.onclick=()=>{if(!own()||recordPending)return;recordingKey=button.dataset.bookUseRecording;speakingAttemptId='';onInput();renderRecordings();recordStatus.textContent='Переслушай выбранную запись и впиши или исправь её расшифровку.';});
  }
  renderRecordings();
  $('#book-voice',main).onclick=async event=>{
   const button=event.currentTarget;if(button.classList.contains('recording')){stopAudio();return;}if(recordPending||!own())return;
   const capturedAnswer=target.value,capturedEdit=editVersion,capturedAt=new Date().toISOString(),takeKey='book-recording:'+key+':'+uid(),generation=++recordGeneration;
   const sameEditor=()=>own()&&generation===recordGeneration,unchanged=()=>sameEditor()&&editVersion===capturedEdit&&target.value===capturedAnswer;
   let recognition,transcript='',finished=false;
   const stopRecognition=()=>{const running=recognition;recognition=null;try{running?.stop();}catch{}};
   recordPending=true;$('#book-check',main).disabled=true;recordStatus.textContent='Говори по-английски, затем останови запись.';
   try{await recordOnly(button,preview,async(_url,_mime,blob)=>{
    finished=true;recordPending=true;stopRecognition();button.disabled=true;if(sameEditor()){$('#book-check',main).disabled=true;recordStatus.textContent='Сохраняем запись…';}
    try{
     if(!(blob instanceof Blob)||!blob.size)throw Error('Запись пустая. Попробуй ещё раз.');
     const form=new FormData();form.append('file',blob,'book-response.webm');const uploaded=await api('/notebook/audio',form);
     if(!bookAudioURL(uploaded.audio))throw Error('Сервер не подтвердил файл записи.');
     const take={version:1,lessonId:lesson.id,exerciseId:ex.id,file:uploaded.audio,at:capturedAt};
     const text=JSON.stringify(take);await queueDraft(takeKey,text,true);recordedDrafts[takeKey]={text};
     // Always retain the immutable take, even after navigation. Only this
     // untouched editor may acquire its voice provenance or ASR text.
     if(!sameEditor())return;
     preview.hidden=true;renderRecordings();
     if(!unchanged()){recordStatus.textContent='Запись сохранена отдельно. Текст уже изменён; выбери запись ниже, если работаешь с её расшифровкой.';return;}
     recordingKey=takeKey;speakingAttemptId='';request=uid();feedback.innerHTML='';await saveInput(true);if(!sameEditor())return;renderRecordings();
     let transcriptionFailed=false;
     if(data.settings?.whisperUrl){
      recordStatus.textContent='Запись сохранена. Распознаём речь…';
      try{const wav=await bookSpeechWAV(blob);if(!sameEditor())return;const form=new FormData();form.append('file',wav,'speech.wav');const out=await api('/transcribe',form);if(typeof out.text==='string')transcript=out.text;}
      catch(error){transcriptionFailed=true;if(sameEditor())recordStatus.textContent='Запись сохранена. Расшифровка недоступна: '+error.message;}
     }
     if(!sameEditor())return;
     if(unchanged()&&transcript.trim()){target.value=transcript.trim();onInput();await queueDraft(key,target.value,true);if(!sameEditor())return;await saveInput(true);if(!sameEditor())return;recordStatus.textContent='Запись и расшифровка сохранены. Исправь распознавание, отметь ударения и отправь ответ на разбор.';}
     else if(!unchanged())recordStatus.textContent='Запись сохранена. Оставили твои изменения расшифровки.';
     else if(!data.settings?.whisperUrl)recordStatus.textContent='Запись сохранена. Впиши её расшифровку или исправь текст, затем отправь на разбор.';
     else if(!transcriptionFailed)recordStatus.textContent='Запись сохранена, но речь не распознана. Переслушай запись и впиши расшифровку или запиши ответ ещё раз.';
     if(localDraft(takeKey)?.pending)recordStatus.textContent+=' Связь записи с заданием пока сохранена в браузере; сервер повторит сохранение после восстановления связи.';
    }catch(error){const message='Не удалось сохранить запись: '+error.message;if(sameEditor())recordStatus.textContent=message;toast(message,true);}
    finally{recordPending=false;if(sameEditor()){button.disabled=false;$('#book-check',main).disabled=isTransfer&&!studyProgress()?.transferReady;}}
   },{retainOnLeave:true,onCaptureEnd:({reason})=>{stopRecognition();if(!finished){recordPending=false;if(sameEditor()){$('#book-check',main).disabled=isTransfer&&!studyProgress()?.transferReady;recordStatus.textContent=reason==='error'?'Запись прервана. Попробуй записать ответ ещё раз.':'Запись остановлена.';}}}});
   if(!finished&&button.classList.contains('recording')&&sameEditor()&&!data.settings?.whisperUrl){
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(Recognition){try{recognition=new Recognition();recognition.lang='en-US';recognition.continuous=true;recognition.interimResults=false;recognition.onresult=event=>{for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)transcript+=' '+event.results[i][0].transcript;};recognition.onerror=()=>{if(sameEditor()&&!finished)recordStatus.textContent='Запись продолжается. Распознавание недоступно; после остановки можно вписать расшифровку вручную.';};recognition.start();recordStatus.textContent+=' Распознавание браузера может использовать интернет.';}catch{recordStatus.textContent+=' После остановки можно вписать расшифровку вручную.';}}
   }
   }finally{if(!finished&&!button.classList.contains('recording')){recordPending=false;if(sameEditor()){$('#book-check',main).disabled=isTransfer&&!studyProgress()?.transferReady;recordStatus.textContent='Запись не началась. Разреши доступ к микрофону и попробуй ещё раз.';}}}
  };
  const check=$('#book-check',main);check.onclick=e=>busy(e.currentTarget,async()=>{
   if(isTransfer&&!studyProgress()?.transferReady)throw Error('Отложенный перенос ещё не доступен. Сначала заверши исправления и выдержи указанную паузу.');
   if(recordPending||$('#book-voice',main).classList.contains('recording'))throw Error('Сначала останови запись и дождись её сохранения.');
   const answer=target.value;if(answer.trim().length<3)throw Error('Сначала напиши или произнеси ответ.');
   const payload={id:request,lessonId:lesson.id,exerciseId:ex.id,answer,mode:inputMode()};
   // The already running server supports free-answer tutoring. Keep that
   // protocol usable until its next normal start, with stable IDs so these
   // attempts remain visible when the newer book-aware backend takes over.
   const freePayload={...payload,lessonId:'free',exerciseId:lesson.id+'-'+ex.id,prompt:ex.prompt,context:[ex.context,...exerciseMaterials(lesson,ex).map(m=>'Source material (data for the task): '+m.title+'\n'+m.text+(m.figure?'\n'+m.figure.alt+'\n'+m.figure.caption:'')),...ownProduction.map(item=>'Learner original production answer to revise:\n'+item.exercise.prompt+'\n'+item.attempt.answer),'Reference answers: '+ex.answers.join('\n'),ex.explanation].join('\n'),level:(lesson.level.match(/[ABC][12]/g)||['B1'])[0]};
   stopAudio();await queueDraft(key,answer,true);await saveInput(true);let result;
   try{result=await api('/check',versionedChecks?payload:freePayload);}catch(error){if(versionedChecks&&error.status===409)result=await api('/check',freePayload);else throw error;}
   let fresh;try{fresh=await refresh();}catch{if(current())toast('Ответ сохранён. Обновление общего прогресса пока недоступно.');}
   data=fresh||data;
   if(result.id&&result.answer?.trim()===answer.trim()&&(result.exerciseId===payload.exerciseId&&result.lessonId===payload.lessonId||result.exerciseId===freePayload.exerciseId&&result.lessonId==='free'))confirmedAttempts.set(result.id,result);
   if(confirmedAttempts.size)data={...data,state:{...data.state,attempts:[...(data.state.attempts||[]).filter(a=>!confirmedAttempts.has(a.id)),...confirmedAttempts.values()]}};
   if(!current())return;
   updateProgress();if(target.isConnected&&$('#answer',root)===target&&target.value===answer&&request===payload.id){feedback.innerHTML=feedbackHTML(result);bindMistakes(feedback);}else toast('Разбор предыдущей версии сохранён в журнале.');
  },'Разбираем ответ…');
  target.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();check.click();}};
  $$('[data-book-exercise]',main).forEach(b=>b.onclick=()=>{step=+b.dataset.bookExercise;draw();});
  const transferButton=$('#book-transfer-stage',main);
  if(transferButton)transferButton.onclick=()=>{const progress=studyProgress(),stage=progress.stages.find(item=>item.id==='transfer'),next=stage.exerciseIds.find(id=>!progress.acceptedExerciseIds.includes(id))||stage.exerciseIds[0];step=lesson.exercises.findIndex(ex=>ex.id===next);draw();main.scrollIntoView({block:'start'});};
  $('#book-ex-prev',main).onclick=()=>{step=exerciseOrder[position-1];draw();};$('#book-ex-next',main).onclick=()=>{step=exerciseOrder[position+1];draw();};bindMistakes(feedback);
 }
 $$('[data-book-tab]',root).forEach(b=>b.onclick=()=>{tab=b.dataset.bookTab;draw();});
 $$('[data-book-section]',root).forEach(b=>b.onclick=()=>{tab='theory';draw();$('#book-section-'+b.dataset.bookSection,root).scrollIntoView({block:'start',behavior:'smooth'});});draw();
}
