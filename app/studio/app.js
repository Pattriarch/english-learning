import {loadWordImages,lessonWordImagesHTML,bindWordImages} from './word-images.js';
import {loadLessonScenes} from './lesson-scenes.js';
import {mountSpeechPractice} from './speech-practice.js';
import {authoredExerciseID,authoredLessonState,currentAuthoredExercise,isGuidedLesson} from './authored-exercise.js';
import {courseGuideHTML,bindCourseGuide} from './course-guide.js';
import {lessonGuidanceHTML,lessonPrerequisiteHTML} from './lesson-guidance.js';
import {lessonIntroHTML,bindLessonIntro} from './lesson-intro.js';
import {scheduleLessonAdvance} from './lesson-advance.js';
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
import {mountMastery} from './mastery.js';
import {bindShellControls} from './shell-controls.js';
import {openSearch,bindSearchShortcut} from './search.js';
import {mountHub} from './hub.js';
import {dayContext,dayDotsHTML,dayNextHTML,goStep,mountDay} from './day-session.js';
import {lessonParts,nextDayStep,dayWatchKey} from './day-session-model.js';
let data,routeVersion=0;
const titles={today:'Сегодня',roadmap:'Программа A1–C2',practice:'Практика',media:'Медиатека',review:'Повторение',journal:'Мой прогресс',books:'Все учебники',settings:'Настройки',lesson:'Занятие',cinema:'Киноклуб',tenses:'Карта времён',pronunciation:'Чтение и произношение',designs:'Варианты дизайна',unit:'Рабочая тетрадь',coverage:'Карта навыков',focus:'Практика навыка'};
const nav=[['today','home','Сегодня'],['roadmap','map','Программа A1–C2'],['tenses','clock','Все времена'],['pronunciation','sound','Произношение'],['practice','pen','Практика'],['cinema','play','Киноклуб'],['review','cards','Повторение'],['notebook','journal','Мои мысли'],['books','book','Все учебники'],['media','play','Медиатека'],['journal','chart','Мой прогресс'],['designs','spark','Выбрать дизайн'],['settings','settings','Настройки']];
titles.notebook='Мои мысли';
titles.transfer='Закрепление';
titles.lexicon='Живой словарь';
titles.method='Как заниматься';
titles.mastery='Результаты A1–C2';
titles.projects='Проекты и проверки';
titles.conversation='Разговорная практика';
nav.push(['mastery','map','Результаты A1–C2'],['projects','pen','Проекты и проверки']);
nav.splice(6,0,['conversation','mic','Разговоры']);
nav.splice(7,0,['lexicon','book','Живой словарь']);
titles.hub='Практика';
titles.day='Мой день';
const href=r=>'#/'+r;
// Other designs show these in the top bar; every section stays in the drawer.
const topNav=[['today','Сегодня'],['roadmap','Программа'],['lexicon','Слова'],['review','Карточки'],['conversation','Разговор'],['cinema','Кино']];
// «Кадр» keeps only four sections in view. Every page belongs to one of them;
// the rest of the app stays one tap away in the drawer behind the profile button.
const kadrNav=[['today','home','Сегодня'],['roadmap','layers','Курс'],['hub','mic','Практика'],['lexicon','cards','Слова']];
const kadrSection={lesson:'roadmap',unit:'roadmap',tenses:'roadmap',books:'roadmap',mastery:'roadmap',coverage:'roadmap',method:'roadmap',practice:'hub',conversation:'hub',cinema:'hub',pronunciation:'hub',notebook:'hub',transfer:'hub',projects:'hub',focus:'hub',media:'hub',capture:'hub',review:'lexicon',day:'today'};
const isKadr=()=>document.documentElement.dataset.design==='kadr';
async function refresh(){
 data=await api('/bootstrap');
 await Promise.all([loadWordImages(),loadLessonScenes()]);
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
 if(isKadr())return kadrShell(route);
 document.body.classList.remove('focus-mode');
 const mins=Math.floor((data.state.activity[dateKey()]||0)/60),due=dueCount();
 $('#app').innerHTML=`<aside class="sidebar" id="sidebar">
  <a class="brand" href="#/today"><span class="brandmark">e.</span><span class="brand-name">English</span></a><button class="menu-close" id="menu-close" aria-label="Закрыть меню">×</button>
  <div class="nav-group">МАСТЕРСКАЯ</div><nav class="nav" aria-label="Основная навигация">
  ${nav.slice(0,7).map(([r,i,t])=>`<a href="${href(r)}" class="${r===route||(route==='lesson'&&r==='roadmap')?'active':''}" ${r===route?'aria-current="page"':''}>${icon(i)}${t}${r==='review'&&due?`<span class="badge-count">${due}</span>`:''}</a>`).join('')}
  </nav><div class="nav-group" style="margin-top:22px">МОИ МАТЕРИАЛЫ</div><nav class="nav" aria-label="Материалы и настройки">
  ${nav.slice(7).map(([r,i,t])=>`<a href="${href(r)}" class="${r===route?'active':''}">${icon(i)}${t}</a>`).join('')}</nav>
  <div class="sidebar-bottom"><a class="sidebar-route" href="#/roadmap" aria-label="Открыть программу A1–C2"><span class="sidebar-route-label">Твой маршрут</span><span class="sidebar-route-levels"><span>A1</span>${icon('arrow')}<span>C2</span></span><span class="sidebar-route-caption">От основ к свободной речи</span></a></div>
 </aside><button class="menu-backdrop" id="menu-backdrop" aria-label="Закрыть меню" tabindex="-1" hidden></button><div class="content"><header class="topbar">
  <a class="topbar-brand" href="#/today" aria-label="English, план на сегодня"><span class="brandmark" aria-hidden="true">E</span><span>English</span></a>
  <nav class="top-nav" aria-label="Главные разделы">${topNav.map(([r,t])=>{const on=r===route||(r==='roadmap'&&['lesson','unit','tenses'].includes(route));return `<a href="${href(r)}" ${on?'aria-current="page"':''}>${t}${r==='review'&&due?`<span class="badge-count">${due}</span>`:''}</a>`;}).join('')}</nav>
  <button class="mobile-menu" id="menu" aria-label="Открыть меню" aria-controls="sidebar" aria-expanded="false">${icon('menu')}<span class="mobile-menu-label">Все разделы</span></button>
  <div class="crumb"><span class="crumb-prefix">English <span style="padding:0 10px">/</span></span> <strong>${titles[route]||'Сегодня'}</strong></div>
  <div class="top-tools"><span class="save-status" id="save-status">${icon('check')} Прогресс на этом компьютере</span><span class="timer">${icon('clock')} <span id="daily-time">${mins}</span> / <span id="daily-goal">${dailyGoal()}</span> мин</span><a class="appearance-link" href="#/designs" aria-label="Варианты дизайна">${icon('spark')}</a><button class="theme-toggle" id="theme-toggle" aria-label="${appearance().theme==='dark'?'Включить светлую тему':'Включить тёмную тему'}">${appearance().theme==='dark'?'☼':'◐'}</button></div>
 </header><main id="main" class="page" tabindex="-1"></main></div><nav class="mobile-nav" aria-label="Быстрая навигация">${[['today','home','Сегодня'],['roadmap','map','Программа'],['lexicon','book','Слова'],['review','cards','Карточки']].map(([r,i,t])=>`<a href="${href(r)}" ${r===route?'aria-current="page"':''}>${icon(i)}<span>${t}</span></a>`).join('')}<button id="mobile-more" aria-controls="sidebar" aria-expanded="false">${icon('menu')}<span>Ещё</span></button></nav>`;
 bindShellControls();
 $('.skip').onclick=ev=>{ev.preventDefault();$('#main').focus();};
 bindAppearance();
}
// One action per screen: the top bar holds the four sections, search and the
// profile button; a lesson hides it all and shows its own close button.
function kadrShell(route){
 const due=dueCount(),section=kadrSection[route]||route,dark=appearance().theme==='dark';
 document.body.classList.toggle('focus-mode',route==='lesson'||route==='day');
 const tab=([r,i,t])=>`<a href="${href(r)}" ${r===section?'aria-current="page"':''}>${icon(i)}<span>${t}</span>${r==='lexicon'&&due?`<span class="badge-count" aria-label="${due} к повторению">${due}</span>`:''}</a>`;
 $('#app').innerHTML=`<aside class="sidebar" id="sidebar" aria-label="Все разделы">
  <div class="drawer-head"><strong>Все разделы</strong><button class="menu-close" id="menu-close" aria-label="Закрыть меню">${icon('close')}</button></div>
  <nav class="nav" aria-label="Все разделы">${nav.map(([r,i,t])=>`<a href="${href(r)}" class="${r===route?'active':''}" ${r===route?'aria-current="page"':''}>${icon(i)}${t}${r==='review'&&due?`<span class="badge-count">${due}</span>`:''}</a>`).join('')}</nav>
  <div class="sidebar-bottom drawer-tools"><button class="drawer-tool" id="theme-toggle" data-labelled aria-label="${dark?'Включить светлую тему':'Включить тёмную тему'}">${icon(dark?'sun':'moon')}<span>${dark?'Светлая тема':'Тёмная тема'}</span></button><a class="drawer-tool" href="#/designs">${icon('spark')}<span>Другие дизайны</span></a></div>
 </aside><button class="menu-backdrop" id="menu-backdrop" aria-label="Закрыть меню" tabindex="-1" hidden></button><div class="content"><header class="topbar">
  <a class="topbar-brand" href="#/today" aria-label="English, сегодня"><span class="brandmark" aria-hidden="true">E</span><span>English</span></a>
  <nav class="top-nav" aria-label="Главные разделы">${kadrNav.map(tab).join('')}</nav>
  <div class="top-tools"><span class="save-status" id="save-status" role="status">${icon('check')} Прогресс на этом компьютере</span><button class="search-trigger" data-open-search aria-label="Найти слово, урок или раздел">${icon('search')}<span>Найти слово или урок</span><kbd>Ctrl K</kbd></button></div>
  <button class="mobile-menu" id="menu" aria-label="Профиль и все разделы" aria-controls="sidebar" aria-expanded="false">${icon('user')}</button>
 </header><main id="main" class="page" tabindex="-1"></main></div><nav class="mobile-nav" aria-label="Разделы"><div class="mobile-tabs">${kadrNav.map(tab).join('')}</div><button class="mobile-search" data-open-search aria-label="Найти слово, урок или раздел">${icon('search')}</button></nav>`;
 bindShellControls();
 $('.skip').onclick=ev=>{ev.preventDefault();$('#main').focus();};
 $$('[data-open-search]').forEach(button=>button.onclick=()=>openSearch(data));
 bindAppearance();
}
function lesson(id,index){
 const l=data.lessons.find(l=>l.id===id);if(!l){$('#main').innerHTML=empty('Занятие не найдено','Откройте карту и выберите доступную тему.','<a class="btn primary" href="#/roadmap">Карта обучения</a>');return;}
 const {latest}=authoredLessonState(l,data.state.attempts),done=new Set([...latest].filter(([,a])=>a.feedback?.verdict==='correct').map(([id])=>id));
 // Day session: the lesson step shows the guided tasks; the lesson's own writing is the write step.
 const day=dayContext(data,{lessonId:id}),dayParts=day?lessonParts(l):null,dayStepId=!day?'':Number.isInteger(index)&&dayParts.write.includes(l.exercises[index])?'write':'lesson',daySet=day?dayParts[dayStepId==='write'?'write':'guided']:null;
 const first=daySet?l.exercises.indexOf(daySet.find(e=>!done.has(e.id))||daySet[0]):l.exercises.findIndex(e=>!done.has(e.id));let n=index===undefined?Math.max(0,first):index==='complete'?0:Math.min(Math.max(0,index),l.exercises.length-1);
 const e=l.exercises[n],practiceID=authoredExerciseID(e),key=l.id+':'+practiceID;let attempt=latest.get(e.id),inputMode=['speak','write'].includes(e.kind)?'writing':'translation',requestID=crypto.randomUUID();
 const clipPhrase=dayStepId==='write'?(()=>{try{return JSON.parse(getDraft(dayWatchKey(day.day),data.state)||'null')?.phrase||'';}catch{return '';}})():'';
 const guided=isGuidedLesson(l),base='/lesson/'+encodeURIComponent(id),practice=i=>base+'/'+i+'?practice';
 // «Кадр» turns a lesson into a focus screen: close, where you are, one task.
 const kadr=globalThis.document?.documentElement?.dataset?.design==='kadr';
 const leave=day?'#/today':(()=>{try{return sessionStorage.getItem('ew-return')||'#/roadmap';}catch{return '#/roadmap';}})();
 const focusBar=(title,meta)=>`<header class="focus-bar"><a class="focus-close" href="${esc(leave)}"${day?' data-day-stop':''} aria-label="${day?'На сегодня хватит':'Закрыть урок'}">${icon('close')}</a><div class="focus-title">${title?`<strong>${title}</strong>`:''}<span>${meta}</span></div>${day?dayDotsHTML(day,dayStepId):''}</header>`;
 const seq=daySet||l.exercises,pos=seq.indexOf(e),lastDayWrite=dayStepId==='write'&&pos===seq.length-1;
 const header=kadr?`${focusBar('',esc(l.level)+' · '+l.minutes+' мин')}<div class="lesson-head"><div><h1>${esc(l.title)}</h1><span class="small-note">${esc(l.goal)}</span></div></div>`:`<div class="lesson-head"><div><a class="small-note" href="#/roadmap">${icon('back')} Карта обучения</a><h1>${esc(l.title)}</h1><span class="small-note">${esc(l.level)} · ${esc(l.goal)}</span></div></div>`;
 if(guided&&(index===undefined||(index===0&&!latest.size&&!location.hash.endsWith('?practice')))){
  $('#main').innerHTML=`<div class="lesson-flow">${header}${lessonIntroHTML(l,n,data.lessons)}</div>`;
  bindCourseGuide($('#main'),l);bindLessonIntro($('#main'),l);return;
 }
 if(index==='complete'){
  const correct=[...latest.values()].filter(a=>a.feedback?.verdict==='correct').length;
  if(kadr){
   const passed=progressLesson(l,data.state).done,phrases=(l.examples||[]).filter(x=>x?.en).slice(0,3);
   $('#main').innerHTML=`<div class="lesson-flow kadr-done">${focusBar('',esc(l.level))}<section class="lesson-complete"><h1>${passed?'Урок пройден':'Практика завершена'}</h1><p class="kadr-done-goal">${esc(l.goal)}</p>${phrases.length?`<h2>Фразы урока</h2><ul class="done-phrases">${phrases.map((x,i)=>`<li><span><span lang="en">${esc(x.en)}</span><small>${esc(x.ru)}</small></span><button type="button" class="btn ghost small" data-done-speak="${i}" aria-label="Послушать: ${esc(x.en)}">${icon('sound')}</button></li>`).join('')}</ul>`:''}<p class="small-note">Принято ответов: ${correct} из ${l.exercises.length}. Все попытки и разборы сохранены.</p><div class="kadr-done-actions">${day?dayNextHTML(day,'lesson'):`<a class="btn primary" href="#/transfer/${esc(id)}">Скажи о себе ${icon('arrow')}</a><a class="btn ghost" href="#/today">На сегодня всё</a><a class="btn ghost" href="#${practice(0)}">Посмотреть ответы</a>`}</div></section></div>`;
   $$('[data-done-speak]').forEach(b=>b.onclick=()=>speak(phrases[+b.dataset.doneSpeak].en));return;
  }
  $('#main').innerHTML=`<div class="lesson-flow">${header}<section class="card lesson-complete"><h2>Итоги практики</h2><p>Принято ответов: ${correct} из ${l.exercises.length}. Все попытки и разборы сохранены.</p><div class="actions">${day?dayNextHTML(day,'lesson'):`<a class="btn primary" href="#/transfer/${esc(id)}">Применить в своей жизни</a><a class="btn" href="#/roadmap">К программе</a><a class="btn ghost" href="#${practice(0)}">Посмотреть ответы</a>`}</div></section></div>`;return;
 }
 $('#main').innerHTML=`${kadr?focusBar(esc(l.title),esc(l.level)+' · задание '+(daySet?Math.max(0,pos)+1:n+1)+' из '+seq.length):`<div class="lesson-head"><div><a class="small-note" href="#/roadmap">${icon('back')} Карта обучения</a><h1 style="margin:13px 0 8px">${esc(l.title)}</h1><span class="small-note">${esc(l.level)} · ${l.beginner?'Шаг за шагом с нуля':l.guided?'Объяснение → шаги → своя речь':l.generated?'Личная практика':'Объяснение → примеры → твоя практика'}</span></div><a class="btn small" href="#/books">${icon('book')} Учебники</a></div>`}
 ${l.prerequisites?.length?lessonPrerequisiteHTML(l,data.lessons):''}
 <div class="lesson-layout ${l.materials?.length?'with-materials':''} ${guided?'guided-lesson':''}">
  ${guided?`<details class="card theory-panel" ${l.materials?.length&&e.practiceStage!=='guided'?'open':''}><summary>${l.materials?.length&&e.practiceStage!=='guided'?'Материал для этого задания':'Напомнить правило'}</summary><a class="lesson-intro-link" href="#${base}">Вернуться к сцене и объяснению</a>`:'<aside class="card theory-panel">'}<div class="panel-tabs">${l.materials?.length?'<button data-tab="materials">Материалы</button>':''}<button class="active" data-tab="theory">Объяснение</button><button data-tab="examples">Примеры</button></div><div class="theory-content" id="theory"></div>${guided?'</details>':'</aside>'}
  <div><section class="card exercise-card">
   <div class="exercise-top"><span class="exercise-type">${e.kind==='speak'?'Скажи своими словами':e.kind==='write'?'Своя мысль':e.kind==='rewrite'?'Переформулируй':'С русского на английский'}</span><div class="lesson-navigation"><button id="prev" class="btn small ghost" aria-label="Предыдущее задание" ${(daySet?pos<=0:n===0)?'disabled':''}>${icon('back')}</button><div class="steps" aria-label="Задание ${(daySet?Math.max(0,pos):n)+1} из ${seq.length}">${seq.map(ex=>`<span class="step ${done.has(ex.id)?'done':''} ${ex===e?'active':''}"></span>`).join('')}</div><button id="next" class="btn small ghost" aria-label="${(daySet?pos===seq.length-1:n===l.exercises.length-1)?(dayStepId==='write'?'Следующий шаг дня':'Итоги занятия'):'Следующее задание'}">${icon('arrow')}</button></div></div>
   ${lessonGuidanceHTML(l,e,n)}${lessonWordImagesHTML(l,e)}
   ${guided?'<span class="eyebrow">Твоя очередь</span>':''}<p class="prompt">${esc(e.prompt)}</p>${e.context?`<p class="context">${esc(e.context)}</p>`:''}${dayStepId==='write'&&clipPhrase?`<p class="small-note">Можно добавить фразу из ролика: <span lang="en">${esc(clipPhrase)}</span></p>`:''}
   <div class="answer-input-header"><label for="answer" class="field-label">Твой ответ на английском</label><button type="button" id="voice" class="btn" aria-controls="answer">${icon('mic')} Надиктовать ответ</button></div>
   <textarea id="answer" class="answer-area" spellcheck="false" placeholder="Напиши свою мысль или нажми «Надиктовать ответ»…">${esc(getDraft(key,data.state)||attempt?.answer||'')}</textarea>
   <div class="answer-meta"><span id="word-count"></span><span>Черновик сохраняется автоматически</span></div>
   <div class="exercise-actions"><div class="actions"><button id="hint-button" class="btn ghost small">Подсказка</button></div><button id="check" class="btn primary">Проверить ${icon('arrow')}</button></div>
   <audio id="audio-preview" class="audio-preview" controls hidden></audio>${e.kind==='speak'?'<div id="lesson-speech-practice"></div>':''}<div id="hint" class="hint" hidden>${esc(e.hint)}</div><div id="feedback">${attempt?feedbackHTML(attempt):''}</div>
  </section></div>
 </div>`;
 bindCourseGuide($('#main'),l);
 bindWordImages($('#main'));
 if(e.kind==='speak')mountSpeechPractice($('#lesson-speech-practice'),data.settings,e.answers||[]);
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
 if($('#guidance-listen'))$('#guidance-listen').onclick=()=>speak(e.guidance.example);
 if($('#guidance-toggle'))$('#guidance-toggle').onclick=ev=>{const body=$('#guidance-body');body.hidden=!body.hidden;ev.currentTarget.textContent=body.hidden?'Вернуть объяснение':'Убрать опору';ev.currentTarget.setAttribute('aria-expanded',String(!body.hidden));};
 let cancelAdvance=()=>{};
 const target=$('#answer'),onText=()=>{cancelAdvance();queueDraft(key,target.value);$('#word-count').textContent=words(target.value)+' слов';requestID=crypto.randomUUID();$('#feedback').innerHTML='';};
 if(localDraft(key)!==null||Object.prototype.hasOwnProperty.call(data.state.drafts,key))target.value=getDraft(key,data.state);
 if(attempt&&target.value!==attempt.answer)$('#feedback').innerHTML='';
 $('#word-count').textContent=words(target.value)+' слов';target.oninput=()=>{inputMode=['speak','write'].includes(e.kind)?'writing':'translation';onText();};
 $('#voice').onclick=ev=>voice(ev.currentTarget,target,data.settings,()=>{inputMode='speaking';onText();});
 $('#hint-button').onclick=()=>$('#hint').hidden=!$('#hint').hidden;
 $('#check').onclick=ev=>busy(ev.currentTarget,async()=>{
   if(target.value.trim().length<2)throw Error('Сначала напишите или произнесите ответ.');
   cancelAdvance();const submitted=target.value,submittedID=requestID,submittedRoute=location.hash,payload={id:requestID,lessonId:id,exerciseId:practiceID,answer:submitted,mode:inputMode};stopAudio();await queueDraft(key,submitted,true);const a=await api('/check',payload);
   await refresh();const isCurrent=()=>$('#answer')===target&&target.value===submitted&&requestID===submittedID&&location.hash===submittedRoute&&currentAuthoredExercise(data.lessons.find(l=>l.id===id),a.exerciseId);
   if(isCurrent()){
    const feedback=$('#feedback'),correct=a.feedback?.verdict==='correct'&&!lastDayWrite;
    feedback.innerHTML=(correct?'<div class="lesson-success" role="status"><span id="advance-status">Верно! Переходим дальше…</span><button type="button" class="btn small ghost" id="stay-feedback">Остаться и послушать</button><button type="button" class="btn small" id="continue-feedback" hidden>Продолжить →</button></div>':'')+feedbackHTML(a)+(dayStepId==='write'?`<div class="day-after"><p class="small-note">Перепиши самое слабое предложение и проверь ещё раз.</p>${lastDayWrite?dayNextHTML(day,'write'):''}</div>`:'');bindMistakes(feedback);
    feedback.scrollIntoView({behavior:'smooth',block:'nearest'});
    if(correct){cancelAdvance=scheduleLessonAdvance({isCurrent,advance:()=>{$('#next').click();},onCancel:()=>{if($('#feedback')===feedback&&$('#stay-feedback')){$('#advance-status').textContent='Верно. Можно послушать ответ и прочитать разбор.';$('#stay-feedback').hidden=true;$('#continue-feedback').hidden=false;}}});feedback.onpointerdown=()=>cancelAdvance();feedback.onfocusin=()=>cancelAdvance();$('#stay-feedback').onclick=()=>cancelAdvance();$('#continue-feedback').onclick=()=>$('#next').click();}
   }else toast('Разбор предыдущей версии сохранён в журнале.');
 },data.settings.provider==='offline'?'Сравниваем…':'Разбираем ответ…');
 target.onkeydown=ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();$('#check').click();}};
 $('#prev').onclick=()=>{cancelAdvance();stopAudio();location.hash=practice(daySet?l.exercises.indexOf(seq[Math.max(0,pos-1)]):n-1);};
 $('#next').onclick=()=>{cancelAdvance();stopAudio();
  if(daySet){const after=seq[pos+1];if(after)location.hash=practice(l.exercises.indexOf(after));else if(dayStepId==='write'){const step=nextDayStep(day.plan,'write');if(step)goStep(day.plan,step);else location.hash='#/today';}else location.hash=base+'/complete';return;}
  location.hash=n<l.exercises.length-1?practice(n+1):base+'/complete';};
 bindMistakes();
}
async function render(){
 const version=++routeVersion;unmountMedia();stopAudio();
 try{await refresh();if(version!==routeVersion)return;const parts=location.hash.replace(/^#\/?/,'').split('/'),r=parts[0]||'today';shell(r);const main=$('#main');
  if(r!=='lesson'&&r!=='day')try{sessionStorage.setItem('ew-return',location.hash||'#/today');}catch{}
  // A new screen eases in once; later re-renders of the same screen stay still.
  if(isKadr()){main.dataset.enter='';setTimeout(()=>delete main.dataset.enter,1200);}
  if(r==='today')await mountDashboard(main,data,refresh);else if(r==='roadmap')mountRoadmap(main,data,parts[1]);else if(r==='lesson'){const step=parts[2]?.split('?')[0];lesson(parts[1],step==='complete'?'complete':/^\d+$/.test(step||'')&&Number.isSafeInteger(+step)?+step:undefined);}
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
  else if(r==='hub')mountHub(main,data);
  else if(r==='day')await mountDay(main,data,refresh,parts[1]||'');
  else if(r==='review')mountReview(main,data,refresh);
  else if(r==='journal')mountJournal(main,data);
  else if(r==='notebook')mountNotebook(main,data,refresh,parts[1],parts[2]);
  else if(r==='transfer')await mountTransfer(main,data,refresh,parts[1]);
  else if(r==='lexicon')await mountLexicon(main,data,refresh,parts[1]);
  else if(r==='method')await mountMethod(main);
  else if(r==='mastery')await mountMastery(main,data,refresh,parts[1]);
  else if(r==='projects'){const {mountProjects}=await import('./projects.js');await mountProjects(main,data,refresh,parts[1]);}
  else if(r==='conversation'){const {mountConversation}=await import('./conversation.js');await mountConversation(main,data,refresh,parts[1],parts[2]);}
  else if(r==='settings')mountSettings(main,data,refresh);
  else if(r==='books')await mountLibrary(main,data);
  else if(r==='media'||r==='capture')mountMedia(main,data,r==='media'?parts[1]||'':'');
  else await mountDashboard(main,data,refresh);if(version!==routeVersion)return;
  // Day mode on pages without their own «Дальше»: one quiet bar under the page.
  const dayOwn={review:'recall',transfer:'transfer',pronunciation:'sound'}[r],dayHere=dayOwn&&dayContext(data);
  if(dayHere&&dayHere.plan.blocks.some(b=>b.step===dayOwn))main.insertAdjacentHTML('afterend',`<div class="day-bar">${dayNextHTML(dayHere,dayOwn,{mark:dayOwn==='recall'})}</div>`);if($('#daily-goal'))$('#daily-goal').textContent=dailyGoal();document.body.classList.toggle('capture-mode',r==='capture');window.scrollTo(0,0);
 }catch(e){if(version!==routeVersion)return;$('#app').innerHTML=`<div class="boot">Не удалось открыть мастерскую.<p class="small-note">${esc(e.message)}</p><button class="btn primary" id="retry">Повторить</button></div>`;$('#retry').onclick=render;}
}
window.addEventListener('hashchange',render);
let lastInput=Date.now(),lastTick=Date.now();['pointerdown','keydown','wheel'].forEach(t=>document.addEventListener(t,()=>lastInput=Date.now(),{passive:true}));
setInterval(async()=>{const now=Date.now(),seconds=Math.min(20,Math.floor((now-lastTick)/1000));lastTick=now;if(!data||document.hidden||isStudyBreak()||now-lastInput>90000||seconds<1)return;
 try{const day=dateKey();await api('/activity',{day,seconds});data.state.activity[day]=(data.state.activity[day]||0)+seconds;if($('#daily-time'))$('#daily-time').textContent=Math.floor(data.state.activity[day]/60);window.dispatchEvent(new CustomEvent('ew-activity',{detail:{day,seconds:data.state.activity[day]}}));}catch{saveStatus(false,'Нет связи с сервером');}
},20000);
window.addEventListener('online',()=>retryPendingDrafts());
bindSearchShortcut(()=>data);
render();
retryPendingDrafts();
