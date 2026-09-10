import {$,$$,esc,icon,busy,toast,dateKey,getDraft,queueDraft} from './core.js';
import {loadBookStatus} from './book-reader.js';
import {createDailyPlan,dailyPlanProgress,weeklySummary} from './planner-model.js';
import {transferQueue} from './transfer-model.js';
import {transferState} from './transfer.js';

const levels=['A1','A2','B1','B2','C1','C2'],durations=[30,60,90,120,180];
const domains={everyday:'Повседневная жизнь',work:'Работа и общение',travel:'Путешествия',culture:'Культура и истории',science:'Наука и технологии',society:'Общество и идеи'};
const skills={grammar:{label:'Грамматика',icon:'book'},vocabulary:{label:'Словарь',icon:'cards'},reading:{label:'Чтение',icon:'journal'},listening:{label:'Аудирование',icon:'sound'},speaking:{label:'Речь',icon:'mic'},writing:{label:'Письмо',icon:'pen'},pronunciation:{label:'Произношение',icon:'sound'},review:{label:'Повторение',icon:'loop'}};
const targets={attempts:'Свои ответы',reviews:'Повторённые карточки',cards:'Новые карточки',corrections:'Возврат к ошибкам',transfer:'Применение своими словами',manual:'Самостоятельная практика'};
const mounts=new WeakMap(),dayKey=day=>'planner:day:'+day,manualKey=day=>'planner:manual:'+day;
const dateLabel=(day,options)=>new Date(day+'T12:00:00').toLocaleDateString('ru-RU',options);

export function plannerPreferences(value,defaultMinutes=90){
 const fallback=durations.reduce((best,m)=>Math.abs(m-defaultMinutes)<Math.abs(best-defaultMinutes)?m:best,30);
 return{version:1,level:levels.includes(value?.level)?value.level:'B1',minutes:durations.includes(value?.minutes)?value.minutes:fallback,domain:Object.hasOwn(domains,value?.domain)?value.domain:'everyday'};
}
export function validDailyPlan(value,day){
 return value?.version===1&&value.day===day&&Number.isFinite(Date.parse(value.createdAt))&&levels.includes(value.level)&&durations.includes(value.minutes)&&Object.hasOwn(domains,value.domain)&&Array.isArray(value.blocks)&&value.blocks.length>0&&value.blocks.length<=16&&new Set(value.blocks.map(b=>b?.id)).size===value.blocks.length&&value.blocks.every(b=>typeof b?.id==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(b.id)&&Object.hasOwn(skills,b.skill)&&[b.title,b.instruction,b.why].every(text=>typeof text==='string'&&text.trim())&&Number.isFinite(b.minutes)&&b.minutes>0&&b.minutes<=180&&typeof b.href==='string'&&/^#\/[a-zA-Z0-9/_-]+$/.test(b.href)&&b.target&&typeof b.target.kind==='string'&&Number.isFinite(b.target.count)&&b.target.count>0);
}
export function plannerManual(value,plan){
 const result={};if(!value||typeof value!=='object'||Array.isArray(value))return result;
 for(const block of plan.blocks){const entry=value[block.id];if(entry?.done===true&&Number.isFinite(Date.parse(entry.at))&&dateKey(new Date(entry.at))===plan.day)result[block.id]={done:true,at:entry.at,source:entry.source==='session'?'session':'outside'};}
 return result;
}
export function plannerJSON(value){const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>19500)throw Error('План получился слишком большим для сохранения. Попробуй выбрать меньше времени.');return text;}
function stored(key,state){try{return JSON.parse(getDraft(key,state)||'null');}catch{return null;}}
function recentDays(now){return Array.from({length:7},(_,i)=>{const d=new Date(now);d.setDate(d.getDate()-6+i);return dateKey(d);});}
export function plannerBookRequests(data,level){
 const books=data.library?.books||[],aliases=new Map(books.flatMap(book=>(book.units||[]).map(unit=>[unit.id,unit.equivalentUnitId||unit.id]))),started=new Set();
 for(const attempt of data.state?.attempts||[]){const lesson=attempt.lessonId==='free'?attempt.exerciseId?.match(/^(book-.+-\d{3})-/)?.[1]:attempt.lessonId;if(typeof lesson==='string'&&lesson.startsWith('book-')&&attempt.answer?.trim())started.add(aliases.get(lesson.slice(5))||lesson.slice(5));}
 const seen=new Set(),ready=[];
 for(const book of books){const range=(book.level?.match(/[ABC][12]/g)||[]).map(value=>levels.indexOf(value)),index=levels.indexOf(level);if(book.duplicateOf||!book.id.startsWith('grammar-')||!range.length||index<Math.min(...range)||index>Math.max(...range))continue;
  for(const unit of book.units||[]){const id=unit.equivalentUnitId||unit.id;if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id)||seen.has(id)||data.bookStatus?.units?.[id]?.status!=='ready')continue;seen.add(id);ready.push(id);}
 }
 return [...ready.filter(id=>started.has(id)).slice(0,300),...ready.filter(id=>!started.has(id)).slice(0,8)];
}
export async function loadPlannerBookLessons(data,level,isCurrent=()=>true){
 const ids=plannerBookRequests(data,level),lessons=[];
 for(let offset=0;offset<ids.length&&isCurrent();offset+=4){
  const results=await Promise.allSettled(ids.slice(offset,offset+4).map(async id=>{const response=await fetch('/book-content/'+encodeURIComponent(id)+'.json');if(!response.ok)return null;const lesson=await response.json();if(lesson?.id!=='book-'+id||lesson.provenance?.unitId!==id||!Array.isArray(lesson.exercises)||!lesson.exercises.length)return null;return{id:lesson.id,title:lesson.title,level:lesson.level,exercises:lesson.exercises.filter(ex=>typeof ex.id==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(ex.id)).map(ex=>({id:ex.id,kind:ex.kind}))};}));
  for(const result of results)if(result.status==='fulfilled'&&result.value?.exercises.length)lessons.push(result.value);
 }
 return lessons;
}

export async function mountDailyPlanner(root,data,refresh){
 data={...data,state:transferState(data)};
 mounts.get(root)?.dispose?.();const token={},route=location.hash;mounts.set(root,token);
 const current=()=>mounts.get(root)===token&&root.isConnected&&location.hash===route;
 const now=new Date(),today=dateKey(now),days=recentDays(now);let selected=today,preferences=plannerPreferences(stored('planner:preferences',data.state),Number(data.settings?.dailyMinutes)||120),editing={...preferences},refreshVersion=0;
 root.innerHTML='<div class="planner-loading" role="status">Собираем твой день с английским…</div>';
 async function save(key,value){const text=plannerJSON(value);await queueDraft(key,text,true);data={...data,state:{...data.state,drafts:{...data.state.drafts,[key]:{text,at:new Date().toISOString()}}}};}
 let todayPlan=stored(dayKey(today),data.state);
 if(!validDailyPlan(todayPlan,today)){
  const bookStatus=await loadBookStatus(data);if(!current())return;
  data={...data,bookStatus};const bookLessons=await loadPlannerBookLessons(data,preferences.level,current);if(!current())return;data={...data,bookLessons};
  const manualDays={};for(const day of days){const plan=stored(dayKey(day),data.state);if(validDailyPlan(plan,day))manualDays[day]={plan,manual:plannerManual(stored(manualKey(day),data.state),plan)};}
  todayPlan=createDailyPlan(data,{...preferences,manualDays},now);
  if(!validDailyPlan(todayPlan,today))throw Error('Не удалось собрать план с доступными заданиями. Открой карту обучения и попробуй ещё раз.');
  await save(dayKey(today),todayPlan);if(!current())return;
 }
 function history(){const result={};for(const day of days){const plan=day===today?todayPlan:stored(dayKey(day),data.state);if(validDailyPlan(plan,day))result[day]={plan,manual:plannerManual(stored(manualKey(day),data.state),plan)};}return result;}
 function startLink(block,plan,label,cls=''){
  return `<a class="planner-link ${cls}" href="${esc(block.href)}"${plan.day===today?` data-plan-start="${esc(block.id)}"`:''}>${esc(label)} ${icon('arrow')}</a>`;
 }
 function draw(){
  if(!current())return;
  data={...data,state:transferState(data)};
  const saved=history(),entry=saved[selected],plan=entry?.plan,manual=entry?.manual||{},progress=plan?dailyPlanProgress(plan,data.state,manual):null,weekly=weeklySummary(data,now,saved),historical=selected!==today;
  const actualMinutes=Math.floor(Math.max(0,Number(data.state.activity?.[selected])||0)/60),next=progress?.next,dates=weekly.days||[],transfers=historical?null:transferQueue(data,new Date());
  root.innerHTML=`<div class="daily-planner">
   <header class="planner-top"><div class="planner-date">${icon('home')} <time datetime="${today}">${esc(dateLabel(today,{weekday:'long',day:'numeric',month:'long'}))}</time></div><nav aria-label="Учебные материалы"><a href="#/method">Как заниматься</a><a href="#/roadmap">Карта обучения</a><a href="#/books">Учебники</a><a href="#/cinema">${icon('play')} Киноклуб</a><a href="#/journal">Мои работы ${icon('arrow')}</a></nav></header>
   <section class="planner-hero" aria-labelledby="planner-title"><div class="planner-hero-copy"><span class="planner-kicker">${historical?'ИСТОРИЯ ЗАНЯТИЙ':'АНГЛИЙСКИЙ · ШАГ ЗА ШАГОМ'}</span><h1 id="planner-title">${historical?'Твой план на '+esc(dateLabel(selected,{day:'numeric',month:'long'})):'Вот твой план на сегодня'}</h1><p>${historical?'Можно вернуться к материалам. Здесь сохранён план этого дня.':'Понять новое, вспомнить знакомое и выразить свою мысль. Начни с одного конкретного шага.'}</p>
    ${plan?`<div class="planner-tags"><span>${esc(plan.level)}</span><span>${plan.minutes} мин в плане</span><span>${esc(domains[plan.domain])}</span></div>`:''}
    <div class="planner-main-action">${historical?'<button class="planner-link planner-primary" data-plan-today>Вернуться к сегодняшнему плану '+icon('arrow')+'</button>':next?`<div><small>СЛЕДУЮЩИЙ ШАГ</small><strong>${esc(next.title)}</strong></div>${startLink(next,plan,progress.done?'Продолжить занятие':'Начать занятие','planner-primary')}`:`<div><small>НА СЕГОДНЯ ГОТОВО</small><strong>Все блоки сегодняшнего плана отмечены.</strong></div><a class="planner-link planner-primary" href="#/journal">Посмотреть свои работы ${icon('arrow')}</a>`}</div>
   </div><div class="planner-hero-progress"><div class="planner-progress-heading"><span>${historical?'Сохранённый план':'Сегодняшний план'}</span>${icon('chart')}</div><div class="planner-big-number">${progress?.done||0}<span> / ${progress?.total||0}</span></div><p>блоков практики выполнено</p><div class="planner-progress-track" role="progressbar" aria-label="Выполненные блоки" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress?.percent||0}"><span style="width:${progress?.percent||0}%"></span></div><div class="planner-time-fact"><strong><b id="planner-actual-minutes">${actualMinutes}</b><span> мин</span></strong><span>зафиксировано<br>в приложении</span></div><small>Выполнение показывает работу, а не присвоенный уровень.</small></div></section>
   <div class="planner-layout"><section class="planner-agenda" aria-labelledby="planner-agenda-title"><div class="planner-section-heading"><div><span class="planner-kicker">${historical?'ПЛАН ИЗ ИСТОРИИ':'ТВОЙ МАРШРУТ'}</span><h2 id="planner-agenda-title">${historical?'Задания этого дня':'Занятия по порядку'}</h2></div><span>${plan?plan.blocks.length+' блоков':'План не сохранён'}</span></div>
    <div class="planner-blocks">${progress?progress.blocks.map((block,i)=>blockHTML(block,i,plan,manual,historical)).join(''):`<div class="planner-empty">${icon('journal')}<h3>На этот день нет сохранённого плана</h3><p>Это не пропуск и не долг. Ответы и время занятий остаются в журнале.</p><a class="planner-link" href="#/journal">Открыть журнал ${icon('arrow')}</a></div>`}</div>
    ${transfers?.due.length?`<section class="planner-block"><div class="eyebrow">ЖИВАЯ ОЧЕРЕДЬ · 5–15 МИНУТ ЗА ПОДХОД</div><h3>Из урока — в свою жизнь</h3><p>Вспомни тему без опоры, используй её в своём письме и голосом. Через несколько дней она вернётся в другой ситуации. Сегодня достаточно одного следующего шага.</p>${transfers.due.map(t=>`<div class="planner-block-bottom"><div><strong>${esc(t.title)}</strong><p>${t.completedRounds?'Возврат после паузы':'Первое самостоятельное применение'}</p></div><a class="planner-link" href="#/transfer/${esc(t.lessonId)}">Применить ${icon('arrow')}</a></div>`).join('')}<p class="small-note">Эта очередь обновляется по твоим ответам. Сохранённый план дня остаётся прежним; пропущенные даты не превращаются в серию обязательных повторов.</p><a class="planner-link" href="#/transfer">Все темы и следующие даты ${icon('arrow')}</a></section>`:''}
    <div class="planner-break">${icon('pause')}<p><strong>Оставь место для перерыва.</strong> Если занимаешься подряд, отдохни примерно через 40–50 минут. План можно пройти за несколько подходов.</p></div>
   </section><aside class="planner-sidebar"><section class="planner-week" aria-labelledby="planner-week-title"><div class="planner-section-heading"><div><span class="planner-kicker">ПОСЛЕДНИЕ 7 ДНЕЙ</span><h2 id="planner-week-title">Твой ритм</h2></div>${icon('clock')}</div><div class="planner-week-days">${days.map(day=>{const facts=dates.find(d=>d.day===day),active=Boolean(facts&&(facts.minutes||facts.attempts||facts.reviews||facts.cards)||Object.values(saved[day]?.manual||{}).length);return `<button data-plan-day="${day}" class="${day===selected?'selected ':''}${active?'has-activity':''}" aria-pressed="${day===selected}" aria-label="${esc(dateLabel(day,{weekday:'long',day:'numeric',month:'long'}))}${saved[day]?', есть сохранённый план':''}"><span>${esc(dateLabel(day,{weekday:'short'}))}</span><strong>${new Date(day+'T12:00:00').getDate()}</strong><i aria-hidden="true"></i></button>`;}).join('')}</div><div class="planner-week-facts"><div><strong><b id="planner-week-active-days">${weekly.totals?.activeDays||0}</b><small> / 7</small></strong><span>дней с практикой</span></div><div><strong><b id="planner-week-minutes">${Math.floor(weekly.totals?.minutes||0)}</b><small> мин</small></strong><span>в приложении</span></div></div><p class="planner-note">Вернуться можно в любой день. Пропущенные дни не создают долг.</p></section>
    <section class="planner-balance" aria-labelledby="planner-balance-title"><div class="planner-section-heading"><div><span class="planner-kicker">РАЗНЫЕ СТОРОНЫ ЯЗЫКА</span><h2 id="planner-balance-title">Баланс недели</h2></div></div>${balanceHTML(weekly)}<p class="planner-note">Сохранённые действия и твои отметки. Количество не оценивает уровень или качество произношения.</p></section>
    <section class="planner-followup planner-cinema"><span class="planner-kicker">${icon('play')} АНГЛИЙСКИЙ ЧЕРЕЗ ИСТОРИИ</span><h3>Лучше звоните Солу</h3><p>Одна сцена, несколько живых выражений и твой пересказ. В киноклубе есть план работы с эпизодами.</p><a class="planner-link" href="#/cinema">Открыть киноклуб ${icon('arrow')}</a></section>
   </aside></div>
   <details class="planner-settings" id="planner-settings"><summary><span>${icon('settings')} Настроить новые дни</span><span>Уровень, время и интересы ${icon('plus')}</span></summary><div class="planner-settings-body"><p>Сегодняшний план уже сохранён. Эти настройки будут использованы при создании плана нового дня.</p><form id="planner-preferences"><div class="planner-settings-fields"><label>Мой уровень<select id="planner-level">${levels.map(level=>`<option value="${level}" ${level===editing.level?'selected':''}>${level}</option>`).join('')}</select></label><label>О чём мне интересно говорить<select id="planner-domain">${Object.entries(domains).map(([value,label])=>`<option value="${value}" ${value===editing.domain?'selected':''}>${esc(label)}</option>`).join('')}</select></label><fieldset><legend>Сколько времени выделить</legend><div class="planner-durations">${durations.map(minutes=>`<button type="button" data-plan-minutes="${minutes}" aria-pressed="${editing.minutes===minutes}" class="${editing.minutes===minutes?'selected':''}">${minutes}<span> мин</span></button>`).join('')}</div></fieldset></div><div class="planner-settings-save"><button class="planner-link planner-primary" type="submit">Сохранить для новых дней ${icon('check')}</button><span id="planner-preferences-status" role="status"></span></div></form></div></details>
  </div>`;
  $$('[data-plan-start]',root).forEach(link=>link.onclick=event=>{if(event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const block=plan.blocks.find(b=>b.id===link.dataset.planStart);if(block)window.dispatchEvent(new CustomEvent('planner-start',{detail:{plan,block}}));});
  $$('[data-plan-day]',root).forEach(button=>button.onclick=()=>{selected=button.dataset.planDay;draw();});$$('[data-plan-today]',root).forEach(button=>button.onclick=()=>{selected=today;draw();});
  $$('[data-plan-manual]',root).forEach(input=>input.onchange=()=>updateManual(input.dataset.planManual,input.checked));
  $$('[data-plan-undo]',root).forEach(button=>button.onclick=()=>updateManual(button.dataset.planUndo,false));
  async function updateManual(id,done){
   if(historical||!plan.blocks.some(b=>b.id===id))return;
   const value=plannerManual(stored(manualKey(today),data.state),todayPlan);if(done)value[id]={done:true,at:new Date().toISOString(),source:'outside'};else delete value[id];
   await save(manualKey(today),value);if(!current())return;draw();window.dispatchEvent(new CustomEvent('planner-updated',{detail:{day:today,plan:todayPlan,manual:value,source:'daily-planner'}}));
  }
  $('#planner-level',root).onchange=e=>{editing.level=e.target.value;};$('#planner-domain',root).onchange=e=>{editing.domain=e.target.value;};
  $$('[data-plan-minutes]',root).forEach(button=>button.onclick=()=>{editing.minutes=+button.dataset.planMinutes;$$('[data-plan-minutes]',root).forEach(b=>{const selected=+b.dataset.planMinutes===editing.minutes;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});});
  $('#planner-preferences',root).onsubmit=event=>{event.preventDefault();const button=event.submitter||$('button[type="submit"]',event.currentTarget);return busy(button,async()=>{preferences=plannerPreferences(editing);await save('planner:preferences',preferences);if(!current())return;$('#planner-preferences-status',root).textContent='Сохранено. Сегодняшний план остаётся прежним.';},'Сохраняем…');};
 }
 function blockHTML(block,index,plan,manual,historical){
  const skill=skills[block.skill]||skills.grammar,entry=manual[block.id],kind=block.targetSpec?.kind||plan.blocks.find(b=>b.id===block.id)?.target.kind;
  return `<article class="planner-block ${block.done?'is-done':''}" data-planner-block="${esc(block.id)}"><div class="planner-block-top"><span class="planner-skill">${icon(skill.icon)} ${esc(skill.label)}</span><span class="planner-block-minutes">${block.minutes} мин <span aria-hidden="true">·</span> ${String(index+1).padStart(2,'0')}</span></div><h3>${esc(block.title)}</h3><p class="planner-instruction">${esc(block.instruction)}</p><details class="planner-why"><summary>Почему это в плане</summary><p>${esc(block.why)}</p></details><div class="planner-block-bottom"><div class="planner-target"><span>${esc(targets[kind]||'Выполненные действия')}</span><strong>${block.current} <small>/ ${block.target}</small></strong>${block.automatic?`<small class="planner-auto">${icon('check')} Выполнено в приложении</small>`:''}</div>${startLink(block,plan,historical?'Открыть материал':block.done?'Вернуться к заданию':'Открыть задание')}</div>${historical?entry?'<div class="planner-manual-note">Отмечено тобой</div>':'':entry?`<div class="planner-manual-note">${icon('check')} ${entry.source==='session'?'Отмечено после занятия':'Выполнено вне приложения'}<button data-plan-undo="${esc(block.id)}">Отменить отметку</button></div>`:!block.automatic?`<label class="planner-manual"><input type="checkbox" data-plan-manual="${esc(block.id)}"><span>Выполнил вне приложения<small>Твоя отметка, без автоматической оценки навыка</small></span></label>`:''}</article>`;
 }
 function balanceHTML(weekly){
  const rows=Object.entries(skills).filter(([id])=>id!=='review').map(([id,skill])=>{const ids=id==='vocabulary'?['vocabulary','review']:[id],found=(weekly.skills||[]).filter(row=>ids.includes(row.id));return{id,label:skill.label,count:found.reduce((n,row)=>n+(row.count||0),0),manual:found.reduce((n,row)=>n+(row.manualCount||0),0)};}),maximum=Math.max(1,...rows.map(row=>row.count+row.manual));
  return `<div class="planner-skill-balance">${rows.map(row=>`<div class="planner-balance-row"><div><span>${esc(row.label)}</span><strong>${row.count}${row.manual?` <small>+ ${row.manual} по отметке</small>`:''}</strong></div><div class="planner-balance-track" aria-label="${esc(row.label)}: ${row.count} сохранённых действий${row.manual?', '+row.manual+' по твоим отметкам':''}"><span style="width:${row.count/maximum*100}%"></span><i style="width:${row.manual/maximum*100}%"></i></div></div>`).join('')}</div>${weekly.recommendations?.length?`<div class="planner-week-advice"><span>НА ЭТОЙ НЕДЕЛЕ</span>${weekly.recommendations.slice(0,2).map(item=>`<p><strong>${esc(item.title)}.</strong> ${esc(item.reason)}</p>`).join('')}</div>`:''}`;
 }
 const onUpdate=async event=>{if(event.detail?.source==='daily-planner')return;if(!current()){dispose();return;}const version=++refreshVersion;try{const updated=await refresh();if(current()&&version===refreshVersion){data=updated;draw();}}catch(error){if(current())toast(error.message,true);}};
 const onActivity=event=>{
  if(!current()){dispose();return;}const {day,seconds}=event.detail||{};if(!days.includes(day)||!Number.isFinite(seconds)||seconds<0)return;
  data={...data,state:{...data.state,activity:{...data.state.activity,[day]:seconds}}};
  if(day===selected)$('#planner-actual-minutes',root).textContent=String(Math.floor(seconds/60));
  const saved=history(),weekly=weeklySummary(data,now,saved);$('#planner-week-minutes',root).textContent=String(Math.floor(weekly.totals.minutes));$('#planner-week-active-days',root).textContent=String(weekly.totals.activeDays);
  const facts=weekly.days.find(d=>d.day===day),button=$$('[data-plan-day]',root).find(b=>b.dataset.planDay===day);button?.classList.toggle('has-activity',Boolean(facts&&(facts.minutes||facts.attempts||facts.reviews||facts.cards)||Object.values(saved[day]?.manual||{}).length));
 };
 let rollingOver=false;
 const checkDay=async()=>{if(!current()){dispose();return;}if(dateKey()===today||rollingOver)return;rollingOver=true;try{const updated=await refresh();if(current())await mountDailyPlanner(root,updated,refresh);}catch(error){if(current())toast(error.message,true);}finally{rollingOver=false;}};
 const onVisibility=()=>{if(!document.hidden)void checkDay();};
 const dayTimer=setInterval(()=>void checkDay(),30000);
 const dispose=()=>{clearInterval(dayTimer);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('planner-updated',onUpdate);window.removeEventListener('ew-activity',onActivity);window.removeEventListener('hashchange',dispose);};token.dispose=dispose;
 window.addEventListener('planner-updated',onUpdate);window.addEventListener('ew-activity',onActivity);window.addEventListener('hashchange',dispose,{once:true});document.addEventListener('visibilitychange',onVisibility);draw();
}
