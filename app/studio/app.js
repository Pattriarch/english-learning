import {$,$$,esc,icon,api,toast,busy,dateKey,words,getDraft,localDraft,queueDraft,retryPendingDrafts,progressLesson,feedbackHTML,bindMistakes,cardModal,empty,saveStatus} from './core.js';
import {voice,speak,stopAudio} from './audio.js';
import {mountPractice,plannedPractice,mountReview,mountJournal,mountSettings} from './pages.js';
import {mountMedia,unmountMedia} from './media.js';
import {mountDashboard,mountDesigns,appearance,bindAppearance} from './design.js';
import {mountRoadmap,mountTenses,mountLibrary,mountUnit} from './journey.js';
import {mountCinema} from './cinema.js';
import {mountCoverage,mountFocus} from './research.js';
import {mountPronunciation} from './pronunciation.js';
import {initStudySession,isStudyBreak} from './study-session.js';
import {mountLessonMaterials} from './lesson-materials.js';
import {mountNotebook} from './notebook.js';
import {mountTransfer} from './transfer.js';
import {mountLexicon} from './lexicon.js';
import {mountMethod} from './method.js';
let data,routeVersion=0;
const titles={today:'Сегодня',roadmap:'Программа A1–C2',practice:'Практика',media:'Медиатека',review:'Повторение',journal:'Мой прогресс',books:'Все учебники',settings:'Настройки',lesson:'Занятие',cinema:'Киноклуб',tenses:'Карта времён',pronunciation:'Чтение и произношение',designs:'Варианты дизайна',unit:'Рабочая тетрадь',coverage:'Карта навыков',focus:'Практика навыка'};
const nav=[['today','home','Сегодня'],['roadmap','map','Программа A1–C2'],['tenses','clock','Все времена'],['pronunciation','sound','Произношение'],['practice','pen','Практика'],['cinema','play','Киноклуб'],['review','cards','Повторение'],['notebook','journal','Мои мысли'],['books','book','Все учебники'],['media','play','Медиатека'],['journal','chart','Мой прогресс'],['designs','spark','Выбрать дизайн'],['settings','settings','Настройки']];
titles.notebook='Мои мысли';
titles.transfer='Закрепление';
titles.lexicon='Живой словарь';
titles.method='Как заниматься';
nav.splice(7,0,['lexicon','book','Живой словарь']);
const href=r=>'#/'+r;
async function refresh(){
 data=await api('/bootstrap');
 initStudySession(data.state);
 const link=$('.nav a[href="#/review"]');
 if(link){const count=dueCount(),badge=$('.badge-count',link);if(badge){if(count)badge.textContent=count;else badge.remove();}else if(count)link.insertAdjacentHTML('beforeend',`<span class="badge-count">${count}</span>`);}
 return data;
}
window.addEventListener('planner-updated',()=>{if(data&&$('#daily-goal'))$('#daily-goal').textContent=dailyGoal();});
window.addEventListener('ew-refresh',()=>refresh().catch(e=>toast(e.message,true)));
function dailyGoal(){try{const plan=JSON.parse(getDraft('planner:day:'+dateKey(),data.state));if(plan?.version===1&&Number.isFinite(plan.minutes))return plan.minutes;}catch{}return data.settings.dailyMinutes;}
function dueCount(){return data.state.cards.filter(c=>Date.parse(c.due)<=Date.now()).length;}
function shell(route){
 const mins=Math.floor((data.state.activity[dateKey()]||0)/60),due=dueCount();
 $('#app').innerHTML=`<aside class="sidebar" id="sidebar">
  <a class="brand" href="#/today"><span class="brandmark">e.</span><span class="brand-name">English</span></a>
  <div class="nav-group">МАСТЕРСКАЯ</div><nav class="nav" aria-label="Основная навигация">
  ${nav.slice(0,7).map(([r,i,t])=>`<a href="${href(r)}" class="${r===route||(route==='lesson'&&r==='roadmap')?'active':''}" ${r===route?'aria-current="page"':''}>${icon(i)}${t}${r==='review'&&due?`<span class="badge-count">${due}</span>`:''}</a>`).join('')}
  </nav><div class="nav-group" style="margin-top:22px">МОИ МАТЕРИАЛЫ</div><nav class="nav" aria-label="Материалы и настройки">
  ${nav.slice(7).map(([r,i,t])=>`<a href="${href(r)}" class="${r===route?'active':''}">${icon(i)}${t}</a>`).join('')}</nav>
  <div class="sidebar-bottom"><a class="sidebar-route" href="#/roadmap" aria-label="Открыть программу A1–C2"><span class="sidebar-route-label">Твой маршрут</span><span class="sidebar-route-levels"><span>A1</span>${icon('arrow')}<span>C2</span></span><span class="sidebar-route-caption">От основ к свободной речи</span></a></div>
 </aside><div class="content"><header class="topbar">
  <button class="mobile-menu" id="menu" aria-label="Открыть меню">${icon('menu')}</button>
  <div class="crumb">Мастерская <span style="padding:0 10px;color:#b3bacb">/</span> <strong>${titles[route]||'Сегодня'}</strong></div>
  <div class="top-tools"><span class="save-status" id="save-status">${icon('check')} Прогресс на этом компьютере</span><span class="timer">${icon('clock')} <span id="daily-time">${mins}</span> / <span id="daily-goal">${dailyGoal()}</span> мин</span><a class="appearance-link" href="#/designs" aria-label="Шесть вариантов дизайна">${icon('spark')}</a><button class="theme-toggle" id="theme-toggle" aria-label="${appearance().theme==='dark'?'Включить светлую тему':'Включить тёмную тему'}">${appearance().theme==='dark'?'☼':'◐'}</button></div>
 </header><main id="main" class="page" tabindex="-1"></main></div>`;
 $('#menu').onclick=()=>$('#sidebar').classList.toggle('open');
 $('.skip').onclick=ev=>{ev.preventDefault();$('#main').focus();};
 bindAppearance();
}
function lesson(id,index){
 const l=data.lessons.find(l=>l.id===id);if(!l){$('#main').innerHTML=empty('Занятие не найдено','Откройте карту и выберите доступную тему.','<a class="btn primary" href="#/roadmap">Карта обучения</a>');return;}
 const done=new Set(data.state.attempts.filter(a=>a.lessonId===id).map(a=>a.exerciseId));
 const first=l.exercises.findIndex(e=>!done.has(e.id));let n=index===undefined?Math.max(0,first):Math.min(Math.max(0,index),l.exercises.length-1);
 const e=l.exercises[n],key=l.id+':'+e.id;let attempt=data.state.attempts.filter(a=>a.lessonId===id&&a.exerciseId===e.id).at(-1),inputMode=['speak','write'].includes(e.kind)?'writing':'translation',requestID=crypto.randomUUID();
 $('#main').innerHTML=`<div class="lesson-head"><div><a class="small-note" href="#/roadmap">${icon('back')} Карта обучения</a><h1 style="margin:13px 0 8px">${esc(l.title)}</h1><span class="small-note">${esc(l.units)} · ${esc(l.level)} · ${l.generated?'Создано помощником':'Авторское занятие по теме'}</span></div><a class="btn small" href="#/books">${icon('book')} Учебники</a></div>
 <div class="lesson-layout ${l.materials?.length?'with-materials':''}">
  <aside class="card theory-panel"><div class="panel-tabs">${l.materials?.length?'<button data-tab="materials">Материалы</button>':''}<button class="active" data-tab="theory">Объяснение</button><button data-tab="examples">Примеры</button></div><div class="theory-content" id="theory"></div></aside>
  <div><section class="card exercise-card">
   <div class="exercise-top"><span class="exercise-type">${e.kind==='speak'?'Скажи своими словами':e.kind==='write'?'Своя мысль':e.kind==='rewrite'?'Переформулируй':'С русского на английский'}</span><div class="steps" aria-label="Задание ${n+1} из ${l.exercises.length}">${l.exercises.map((ex,i)=>`<span class="step ${done.has(ex.id)?'done':''} ${i===n?'active':''}"></span>`).join('')}</div></div>
   <p class="prompt">${esc(e.prompt)}</p><p class="context">${esc(e.context)}</p>
   <label for="answer" class="field-label">Твой ответ на английском</label><div style="height:9px"></div>
   <textarea id="answer" class="answer-area" spellcheck="false" placeholder="Сформулируй всю мысль своими словами…">${esc(getDraft(key,data.state)||attempt?.answer||'')}</textarea>
   <div class="answer-meta"><span id="word-count"></span><span>Черновик сохраняется автоматически</span></div>
   <div class="exercise-actions"><div class="actions"><button id="voice" class="btn">${icon('mic')} Ответить голосом</button><button id="hint-button" class="btn ghost small">Подсказка</button></div><button id="check" class="btn primary">Проверить ${icon('arrow')}</button></div>
   <audio id="audio-preview" class="audio-preview" controls hidden></audio><div id="hint" class="hint" hidden>${esc(e.hint)}</div><div id="feedback">${attempt?feedbackHTML(attempt):''}</div>
   <div class="lesson-bottom"><span>Задание ${n+1} из ${l.exercises.length} <span class="kbd">Ctrl + Enter</span></span><div class="actions"><button id="prev" class="btn small ghost" ${n===0?'disabled':''}>${icon('back')}</button><button id="next" class="btn small">${n===l.exercises.length-1?'Завершить занятие':'Следующее'} ${icon('arrow')}</button></div></div>
  </section><div class="note-card"><strong>Здесь нет единственной правильной формулировки.</strong><br>${data.settings.provider==='offline'?'Сейчас доступно сравнение с примерами. Подключи помощника в настройках, чтобы получать оценку других вариантов.':'Помощник проверяет смысл, грамматику и естественность. Если ответ принят, изучи объяснение и попробуй применить конструкцию в новой ситуации.'}<br>После диктовки проверь расшифровку: разбор текста не оценивает произношение.<p class="actions"><a class="btn small" href="#/transfer/${esc(l.id)}">Применить тему в своей жизни</a><a class="btn small ghost" href="#/notebook/new/${esc(l.id)}">Моя мысль по этой теме</a></p></div></div>
 </div>`;
 const showTheory=tab=>{
  stopAudio();
  $$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  $('#theory').classList.toggle('has-materials',tab==='materials');
  if(tab==='materials'){
   $('#theory').innerHTML='<section class="lesson-materials" id="lesson-materials" aria-label="Материалы задания"></section>';
   mountLessonMaterials($('#lesson-materials'),l,e,data.state);return;
  }
  $('#theory').innerHTML=tab==='theory'?`<div class="eyebrow">Чему ты научишься</div><p>${esc(l.goal)}</p><div class="formula">${esc(l.formula)}</div>${l.sections.map(s=>`<h3>${esc(s.title)}</h3><p>${esc(s.body)}</p>`).join('')}<button class="btn full" id="mark-read">${icon('check')} ${data.state.read[id]?'Теория прочитана':'Я разобрался с объяснением'}</button>`:l.examples.map((ex,i)=>`<div class="example"><div class="spread"><div class="english">${esc(ex.en)}</div><button class="btn small ghost" data-speak="${i}" aria-label="Прослушать пример">${icon('sound')}</button></div><p>${esc(ex.ru)}</p><small>${esc(ex.why)}</small></div>`).join('');
  if($('#mark-read'))$('#mark-read').onclick=ev=>busy(ev.currentTarget,async()=>{await api('/read',{id});data.state.read[id]=new Date().toISOString();toast('Теория отмечена. Теперь попробуй применить её.');showTheory('theory');});
  $$('[data-speak]').forEach(b=>b.onclick=()=>speak(l.examples[+b.dataset.speak].en));
 };
 showTheory(l.materials?.length?'materials':'theory');$$('[data-tab]').forEach(b=>b.onclick=()=>showTheory(b.dataset.tab));
 const target=$('#answer'),onText=()=>{queueDraft(key,target.value);$('#word-count').textContent=words(target.value)+' слов';requestID=crypto.randomUUID();$('#feedback').innerHTML='';};
 if(localDraft(key)!==null||Object.prototype.hasOwnProperty.call(data.state.drafts,key))target.value=getDraft(key,data.state);
 if(attempt&&target.value!==attempt.answer)$('#feedback').innerHTML='';
 $('#word-count').textContent=words(target.value)+' слов';target.oninput=()=>{inputMode=['speak','write'].includes(e.kind)?'writing':'translation';onText();};
 $('#voice').onclick=ev=>voice(ev.currentTarget,target,data.settings,()=>{inputMode='speaking';onText();});
 $('#hint-button').onclick=()=>$('#hint').hidden=!$('#hint').hidden;
 $('#check').onclick=ev=>busy(ev.currentTarget,async()=>{
   if(target.value.trim().length<2)throw Error('Сначала напишите или произнесите ответ.');
   const submitted=target.value,payload={id:requestID,lessonId:id,exerciseId:e.id,answer:submitted,mode:inputMode};stopAudio();await queueDraft(key,submitted,true);const a=await api('/check',payload);
   await refresh();if($('#answer')===target&&target.value===submitted){$('#feedback').innerHTML=feedbackHTML(a);bindMistakes($('#feedback'));$('#feedback').scrollIntoView({behavior:'smooth',block:'nearest'});}else toast('Разбор предыдущей версии сохранён в журнале.');
 },data.settings.provider==='offline'?'Сравниваем…':'Разбираем ответ…');
 target.onkeydown=ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();$('#check').click();}};
 $('#prev').onclick=()=>{stopAudio();location.hash='/lesson/'+encodeURIComponent(id)+'/'+(n-1);};
 $('#next').onclick=()=>{stopAudio();if(n<l.exercises.length-1){location.hash='/lesson/'+encodeURIComponent(id)+'/'+(n+1);}else{location.hash='/roadmap';toast('Занятие сохранено. К любому заданию можно вернуться.');}};
 bindMistakes();
}
async function render(){
 const version=++routeVersion;unmountMedia();stopAudio();
 try{await refresh();if(version!==routeVersion)return;const parts=location.hash.replace(/^#\/?/,'').split('/'),r=parts[0]||'today';shell(r);const main=$('#main');
  if(r==='today')await mountDashboard(main,data,refresh);else if(r==='roadmap')mountRoadmap(main,data,parts[1]);else if(r==='lesson')lesson(parts[1],/^\d+$/.test(parts[2]||'')&&Number.isSafeInteger(+parts[2])?+parts[2]:undefined);
  else if(r==='tenses')mountTenses(main,data);
  else if(r==='pronunciation')mountPronunciation(main,data,parts[1],refresh);
  else if(r==='designs')mountDesigns(main);
  else if(r==='cinema')mountCinema(data,refresh);
  else if(r==='coverage')mountCoverage(main,data);
  else if(r==='focus')mountFocus(main,data,parts[1],refresh);
  else if(r==='unit')await mountUnit(main,data,parts[1],refresh);
  else if(r==='practice'){
   const mode=parts[1]||'writing',planned=parts[2]?plannedPractice(getDraft('planner:day:'+parts[2],data.state),mode,parts[2],parts[3]):null;
   if(parts[2]&&!planned)main.innerHTML=empty('Задание плана не найдено','Открой сохранённый план и выбери задание ещё раз.','<a class="btn primary" href="#/today">К плану на сегодня</a>');
   else mountPractice(main,data,mode,refresh,planned);
  }
  else if(r==='review')mountReview(main,data,refresh);
  else if(r==='journal')mountJournal(main,data);
  else if(r==='notebook')mountNotebook(main,data,refresh,parts[1],parts[2]);
  else if(r==='transfer')await mountTransfer(main,data,refresh,parts[1]);
  else if(r==='lexicon')await mountLexicon(main,data,refresh,parts[1]);
  else if(r==='method')await mountMethod(main);
  else if(r==='settings')mountSettings(main,data,refresh);
  else if(r==='books')await mountLibrary(main,data);
  else if(r==='media'||r==='capture')mountMedia(main,data,r==='media'?parts[1]||'':'');
  else await mountDashboard(main,data,refresh);if(version!==routeVersion)return;if($('#daily-goal'))$('#daily-goal').textContent=dailyGoal();document.body.classList.toggle('capture-mode',r==='capture');window.scrollTo(0,0);
 }catch(e){if(version!==routeVersion)return;$('#app').innerHTML=`<div class="boot">Не удалось открыть мастерскую.<p class="small-note">${esc(e.message)}</p><button class="btn primary" id="retry">Повторить</button></div>`;$('#retry').onclick=render;}
}
window.addEventListener('hashchange',render);
let lastInput=Date.now(),lastTick=Date.now();['pointerdown','keydown','wheel'].forEach(t=>document.addEventListener(t,()=>lastInput=Date.now(),{passive:true}));
setInterval(async()=>{const now=Date.now(),seconds=Math.min(20,Math.floor((now-lastTick)/1000));lastTick=now;if(!data||document.hidden||isStudyBreak()||now-lastInput>90000||seconds<1)return;
 try{const day=dateKey();await api('/activity',{day,seconds});data.state.activity[day]=(data.state.activity[day]||0)+seconds;if($('#daily-time'))$('#daily-time').textContent=Math.floor(data.state.activity[day]/60);window.dispatchEvent(new CustomEvent('ew-activity',{detail:{day,seconds:data.state.activity[day]}}));}catch{saveStatus(false,'Нет связи с сервером');}
},20000);
window.addEventListener('online',()=>retryPendingDrafts());
render();
retryPendingDrafts();
