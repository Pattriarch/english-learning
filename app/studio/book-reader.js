import {$,$$,esc,icon,api,busy,toast,getDraft,localDraft,queueDraft,words,feedbackHTML,bindMistakes,uid,progressLesson,cardModal} from './core.js';
import {voice,stopAudio,beginAudio,speak,speechVoice} from './audio.js';

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
export function bookAttemptState(state,lesson){
 return {...state,attempts:state.attempts.map(a=>a.lessonId==='free'&&lesson.exercises.some(e=>a.exerciseId===lesson.id+'-'+e.id)?{...a,lessonId:lesson.id,exerciseId:a.exerciseId.slice(lesson.id.length+1)}:a)};
}
export async function bookExerciseID(exercise){
 const text=[exercise.kind||'',exercise.prompt||'',exercise.context||'',exercise.hint||'',exercise.explanation||'',(exercise.answers||[]).join('\u001e')].join('\u001f');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 const suffix=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
 return exercise.id.replace(/--[a-f0-9]{16}$/,'')+'--'+suffix;
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
 if(lesson){lesson={...lesson,exercises:await Promise.all(lesson.exercises.map(async ex=>({...ex,id:await bookExerciseID(ex)})))};if(!current())return;}
 const prev=book.units.find(u=>u.unit===unit.unit-1),next=book.units.find(u=>u.unit===unit.unit+1);
 const top=`<div class="book-breadcrumb"><a href="#/books">${icon('book')} Библиотека</a><span>/</span><span>${esc(book.title)}</span></div><header class="book-heading"><div class="eyebrow">UNIT ${String(unit.unit).padStart(2,'0')} · ${esc(lesson?.level||book.level)}</div><h1>${esc(lesson?.title||unit.titleRu||unit.title)}</h1><p>${esc(lesson?.goal||unit.title)}</p><div class="book-heading-meta"><span>${lesson?lesson.minutes+' минут · '+lesson.exercises.length+' заданий':'Страницы '+unit.page+'–'+unit.endPage}</span><a href="${pdfLink(book,unit)}" target="_blank" rel="noopener">Оригинал в PDF ${icon('arrow')}</a></div></header>`;
 if(!lesson){
  root.innerHTML=top+`<section class="surface book-pending"><div class="eyebrow">УРОК ГОТОВИТСЯ</div><h2>Здесь будет полный разбор юнита.</h2><p>Объяснение по-русски, разобранные примеры и задания по материалу этих страниц. Урок появится здесь после обработки книги.</p><div class="actions"><button class="btn primary" id="book-reload">Проверить готовность</button><a class="btn" href="${pdfLink(book,unit)}" target="_blank" rel="noopener">Открыть страницы книги</a></div><p class="small-note">Готовые уроки доступны в библиотеке. Этот юнит ещё в обработке.</p></section>`;
  $('#book-reload',root).onclick=e=>busy(e.currentTarget,()=>mountBookUnit(root,data,id,refresh));return;
 }
 const answered=new Set(bookAttemptState(data.state,lesson).attempts.filter(a=>a.lessonId===lesson.id&&a.answer?.trim()).map(a=>a.exerciseId));
 let tab='theory',step=Math.max(0,lesson.exercises.findIndex(ex=>!answered.has(ex.id))),playRequest=0;
 const noteKey='unit-notes:'+id;
 root.innerHTML=top+`<div class="book-tabs" role="group" aria-label="Разделы урока"><button data-book-tab="theory" class="active" aria-pressed="true">01 <span>Разобраться</span></button><button data-book-tab="practice" aria-pressed="false">02 <span>Попрактиковаться</span></button><button data-book-tab="notes" aria-pressed="false">03 <span>Мой конспект</span></button></div><div class="book-reader-layout"><div id="book-main"></div><aside class="book-outline"><div class="eyebrow">В ЭТОМ ЮНИТЕ</div><nav aria-label="План юнита">${lesson.sections.map((s,i)=>`<button data-book-section="${i}"><span>${String(i+1).padStart(2,'0')}</span>${esc(s.title)}</button>`).join('')}</nav><div class="book-progress" id="book-progress"></div><div class="book-neighbours">${prev?`<a href="#/unit/${prev.id}">← Юнит ${prev.unit}</a>`:''}${next?`<a href="#/unit/${next.id}">Юнит ${next.unit} →</a>`:''}</div></aside></div>`;
 function updateProgress(){const p=progressLesson(lesson,bookAttemptState(data.state,lesson));$('#book-progress',root).innerHTML=`<strong>${p.tried}<span> / ${p.total}</span></strong><p>заданий с твоим ответом</p><div class="progress-track"><span style="width:${p.tried/p.total*100}%"></span></div><small>${p.correct} выполнено верно · ${data.state.read[lesson.id]||data.state.read[canonical]?'теория прочитана':'теория ещё не отмечена'}</small>`;}
 function draw(){
  playRequest++;stopAudio();$$('[data-book-tab]',root).forEach(b=>{b.classList.toggle('active',b.dataset.bookTab===tab);b.setAttribute('aria-pressed',String(b.dataset.bookTab===tab));});
  const main=$('#book-main',root);updateProgress();
  if(tab==='theory'){
   main.innerHTML=`<article class="book-theory">${lesson.formula?`<div class="book-key"><span class="eyebrow">ОПОРНАЯ ИДЕЯ</span><div>${esc(lesson.formula)}</div></div>`:''}${lesson.sections.map((s,i)=>`<section class="book-section" id="book-section-${i}"><div class="book-section-number">${String(i+1).padStart(2,'0')}</div><h2>${esc(s.title)}</h2>${bookParagraphs(s.body)}</section>`).join('')}<section class="book-section"><div class="eyebrow">ОТ СМЫСЛА К ФОРМЕ</div><h2>Разбираем на примерах</h2><div class="book-examples">${lesson.examples.map((ex,i)=>`<article class="book-example"><div class="spread"><span class="small-note">ПРИМЕР ${i+1}</span><div class="actions"><button class="btn ghost small" data-example-speak="${i}" aria-label="Прослушать пример ${i+1}">${icon('sound')}</button><button class="btn ghost small" data-example-card="${i}" aria-label="В карточки: пример ${i+1}">${icon('cards')}</button></div></div><p class="book-en">${esc(ex.en)}</p><p class="book-ru">${esc(ex.ru)}</p><p class="book-why">${esc(ex.why)}</p></article>`).join('')}</div></section><details class="book-source-map"><summary>Что перенесено из этого юнита</summary><p>Самостоятельный разбор по ${esc(book.title)}, юнит ${unit.unit}. Названия ниже связывают материал книги с разделами урока.</p><ul>${lesson.provenance.sourceCoverage.map(c=>`<li><strong>${esc(c.point)}</strong><br><span>${esc(c.sectionTitle)}</span></li>`).join('')}</ul>${lesson.provenance.warnings?.length?`<p class="small-note">Примечания к разбору: ${esc(lesson.provenance.warnings.join(' · '))}</p>`:''}<a class="text-link" href="${pdfLink(book,unit)}" target="_blank" rel="noopener">Свериться с оригиналом →</a></details><div class="book-bottom-actions"><button class="btn" id="book-read">${icon('check')} ${data.state.read[lesson.id]||data.state.read[canonical]?'Теория прочитана':'Отметить прочитанным'}</button><button class="btn primary" id="book-start">Перейти к практике ${icon('arrow')}</button></div></article>`;
   $('.book-examples',main).insertAdjacentHTML('beforebegin','<audio id="book-model-audio" class="audio-preview" controls hidden></audio><p id="book-model-voice" class="small-note" hidden></p>');
   $$('[data-example-speak]',main).forEach(b=>b.onclick=async()=>{
    const audioCurrent=beginAudio(),request=++playRequest,text=lesson.examples[+b.dataset.exampleSpeak].en;
    if(speechVoice('en-US')){speak(text);return;}
    try{const response=await fetch('/book-audio/'+encodeURIComponent(canonical)+'.json');if(!response.ok)throw Error('Аудиопримеры этого урока ещё готовятся.');const samples=await response.json();if(!current()||!audioCurrent()||!b.isConnected||request!==playRequest)return;
     const file=samples.clips?.[text];if(!/^[a-f0-9]{64}\.wav$/.test(file||''))throw Error('Этот аудиопример ещё не готов.');
     const player=$('#book-model-audio',main),label=$('#book-model-voice',main);player.src='/book-audio/'+file;player.hidden=false;label.textContent='Аудиопример: '+samples.voice+' · '+samples.culture;label.hidden=false;
     try{await player.play();}catch{if(audioCurrent()&&b.isConnected)toast('Нажми ▶ в плеере, чтобы прослушать пример.');}
    }catch(error){if(current()&&audioCurrent()&&b.isConnected)toast(error.message,true);}
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
  const ex=lesson.exercises[step],key=lesson.id+':'+ex.id,attempt=bookAttemptState(data.state,lesson).attempts.filter(a=>a.lessonId===lesson.id&&a.exerciseId===ex.id).at(-1);let request=uid(),inputMode='writing';
  main.innerHTML=`<section class="surface book-practice"><div class="book-exercise-nav" role="group" aria-label="Задания">${lesson.exercises.map((e,i)=>{const a=bookAttemptState(data.state,lesson).attempts.filter(a=>a.lessonId===lesson.id&&a.exerciseId===e.id).at(-1);return `<button data-book-exercise="${i}" class="${i===step?'active':a?.feedback.verdict==='correct'?'done':''}" aria-label="Задание ${i+1}" aria-pressed="${i===step}">${i+1}</button>`;}).join('')}</div><div class="eyebrow">${esc(kindName[ex.kind]||'Сформулировать самостоятельно')} · ${step+1} / ${lesson.exercises.length}</div><h2 class="book-prompt">${esc(ex.prompt)}</h2>${ex.context?`<div class="book-task-context">${bookParagraphs(ex.context)}</div>`:''}<label class="field-label" for="answer">Твой ответ на английском</label><textarea id="answer" class="answer-area" rows="9" placeholder="Напиши целый ответ. Допустимые варианты тоже учитываются."></textarea><div class="answer-meta"><span id="book-words"></span><span>Черновик сохраняется</span></div><div class="actions"><button class="btn" id="book-voice">${icon('mic')} Ответить голосом</button><button class="btn primary" id="book-check">Получить разбор ${icon('arrow')}</button></div><audio id="audio-preview" class="audio-preview" controls hidden></audio><p class="small-note book-voice-note">При диктовке проверяется расшифровка: смысл, грамматика и словоупотребление. Произношение по тексту не оценивается.</p>${ex.hint?`<details class="book-hint"><summary>Небольшая подсказка</summary>${bookParagraphs(ex.hint)}</details>`:''}<div id="book-feedback"></div><details class="book-reference"><summary>Разобрать пример ответа</summary>${ex.answers.map(a=>`<p class="book-en">${esc(a)}</p>`).join('')}${bookParagraphs(ex.explanation)}</details><div class="book-bottom-actions"><button class="btn small" id="book-ex-prev" ${step===0?'disabled':''}>← Предыдущее</button><button class="btn small" id="book-ex-next" ${step===lesson.exercises.length-1?'disabled':''}>Следующее →</button></div><p class="small-note">После упражнений: <a href="#/transfer/${lesson.id}">применить тему в новой ситуации</a> или <a href="#/notebook/new/${lesson.id}">сформулировать свою мысль и сохранить её</a>.</p></section>`;
  const target=$('#answer',main),feedback=$('#book-feedback',main),counter=$('#book-words',main);
  target.value=localDraft(key)!==null||Object.prototype.hasOwnProperty.call(data.state.drafts,key)?getDraft(key,data.state):attempt?.answer||'';
  if(attempt&&attempt.answer===target.value.trim()){feedback.innerHTML=feedbackHTML(attempt);inputMode=attempt.mode||'writing';}
  const onInput=()=>{queueDraft(key,target.value);request=uid();counter.textContent=words(target.value)+' слов';feedback.innerHTML='';};
  target.oninput=()=>{inputMode='writing';onInput();};counter.textContent=words(target.value)+' слов';
  $('#book-voice',main).onclick=e=>voice(e.currentTarget,target,data.settings,()=>{inputMode='speaking';onInput();});
  const check=$('#book-check',main);check.onclick=e=>busy(e.currentTarget,async()=>{
   const answer=target.value;if(answer.trim().length<3)throw Error('Сначала напиши или произнеси ответ.');
   const payload={id:request,lessonId:lesson.id,exerciseId:ex.id,answer,mode:inputMode};
   // The already running server supports free-answer tutoring. Keep that
   // protocol usable until its next normal start, with stable IDs so these
   // attempts remain visible when the newer book-aware backend takes over.
   const freePayload={...payload,lessonId:'free',exerciseId:lesson.id+'-'+ex.id,prompt:ex.prompt,context:[ex.context,'Reference answers: '+ex.answers.join('\n'),ex.explanation].join('\n'),level:(lesson.level.match(/[ABC][12]/g)||['B1'])[0]};
   stopAudio();await queueDraft(key,answer,true);let result;
   try{result=await api('/check',versionedChecks?payload:freePayload);}catch(error){if(versionedChecks&&error.status===409)result=await api('/check',freePayload);else throw error;}
   data=await refresh();
   if(!current())return;
   updateProgress();if(target.isConnected&&$('#answer',root)===target&&target.value===answer){feedback.innerHTML=feedbackHTML(result);bindMistakes(feedback);}else toast('Разбор предыдущей версии сохранён в журнале.');
  },'Разбираем ответ…');
  target.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();check.click();}};
  $$('[data-book-exercise]',main).forEach(b=>b.onclick=()=>{step=+b.dataset.bookExercise;draw();});
  $('#book-ex-prev',main).onclick=()=>{step--;draw();};$('#book-ex-next',main).onclick=()=>{step++;draw();};bindMistakes(feedback);
 }
 $$('[data-book-tab]',root).forEach(b=>b.onclick=()=>{tab=b.dataset.bookTab;draw();});
 $$('[data-book-section]',root).forEach(b=>b.onclick=()=>{tab='theory';draw();$('#book-section-'+b.dataset.bookSection,root).scrollIntoView({block:'start',behavior:'smooth'});});draw();
}
