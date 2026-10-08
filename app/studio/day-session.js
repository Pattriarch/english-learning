import {$,esc,icon,dateKey,getDraft,queueDraft,toast} from './core.js';
import {speak,stopAudio,recordOnly} from './audio.js';
import {authoredLessonState} from './authored-exercise.js';
import {dailyPlanProgress} from './planner-model.js';
import {dayPlanFrom,dayStep,nextDayStep,dayProgressKey,lessonParts,previousNotes,recallPhrases,DAY_LABELS} from './day-session-model.js';

// Day mode lives in this tab only: it starts on #/day and ends with «На сегодня хватит».
const FLAG='ew-day';
let current=null;
const parse=raw=>{try{return JSON.parse(raw||'null');}catch{return null;}};
export function dayFlag(){try{return sessionStorage.getItem(FLAG)||'';}catch{return '';}}
export function setDayFlag(day){try{if(day)sessionStorage.setItem(FLAG,day);else sessionStorage.removeItem(FLAG);}catch{}}
/** Today's day session when this tab is in day mode (and, if given, for that lesson). */
export function dayContext(data,{lessonId='',force=false}={}){
 const day=dateKey();if(!data?.state||(!force&&dayFlag()!==day))return null;
 const plan=dayPlanFrom(getDraft('planner:day:'+day,data.state),day);if(!plan||(lessonId&&plan.daySession.lessonId!==lessonId))return null;
 const manual=parse(getDraft('planner:manual:'+day,data.state))||{},progress=dailyPlanProgress(plan,data.state,manual);
 current={day,plan,progress,data,lesson:(data.lessons||[]).find(l=>l.id===plan.daySession.lessonId)||null};return current;
}
export function markDayStep(data,day,step){
 const key=dayProgressKey(day),value=parse(getDraft(key,data.state))||{};value[step]=new Date().toISOString();
 data.state.drafts={...data.state.drafts,[key]:{text:JSON.stringify(value),at:value[step]}};
 return queueDraft(key,JSON.stringify(value),true);
}
export function goStep(plan,block){
 setDayFlag(plan.day);window.dispatchEvent(new CustomEvent('planner-start',{detail:{plan,block}}));
 location.hash='#/day/'+block.step;
}
export function dayDotsHTML(ctx,step){
 if(!ctx)return '';
 return `<ol class="day-dots" aria-label="Шаги дня">${ctx.progress.blocks.map(b=>`<li class="${b.done?'is-done':''} ${b.step===step?'is-current':''}" title="${esc(b.label||b.title)}"${b.step===step?' aria-current="step"':''}><span class="visually-hidden">${esc(b.label||b.title)}${b.done?', готово':''}</span></li>`).join('')}</ol>`;
}
export function dayHeader(ctx,step,meta=''){
 const block=dayStep(ctx.plan,step);
 return `<header class="focus-bar day-bar-top"><a class="focus-close" href="#/today" data-day-stop aria-label="На сегодня хватит">${icon('close')}</a><div class="focus-title"><strong>${esc(block?.label||DAY_LABELS[step]||'Мой день')}</strong><span>${esc(meta||(block?block.minutes+' мин':ctx.plan.minutes+' мин'))}</span></div>${dayDotsHTML(ctx,step)}</header>`;
}
/** One primary «Дальше» to the next step and a quiet way out. `mark` records this step as done first. */
export function dayNextHTML(ctx,step,{mark=false}={}){
 if(!ctx)return '';const next=nextDayStep(ctx.plan,step),markAttr=mark?` data-day-mark="${esc(step)}"`:'';
 return `<div class="day-next">${next?`<a class="btn primary" href="#/day/${esc(next.step)}" data-day-go="${esc(next.step)}"${markAttr}>Дальше: ${esc(next.label||next.title)} · ${next.minutes} мин ${icon('arrow')}</a><a class="btn ghost" href="#/today" data-day-stop>На сегодня хватит</a>`:`<a class="btn primary" href="#/today" data-day-stop${markAttr}>Завершить день ${icon('check')}</a>`}</div>`;
}
globalThis.document?.addEventListener?.('click',async event=>{
 const target=event.target?.closest?.('[data-day-stop],[data-day-go]');if(!target||event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 if(target.hasAttribute('data-day-stop')){if(target.dataset.dayMark&&current){event.preventDefault();await markDayStep(current.data,current.day,target.dataset.dayMark).catch(()=>{});location.hash='#/today';}setDayFlag('');return;}
 if(!current)return;const block=dayStep(current.plan,target.dataset.dayGo);if(!block)return;event.preventDefault();
 if(target.dataset.dayMark)await markDayStep(current.data,current.day,target.dataset.dayMark).catch(error=>toast(error.message,true));
 goStep(current.plan,block);
});
// Where a step really happens: day screens render here, others open their own page.
function destination(ctx,step){
 const {plan,lesson,data}=ctx,block=dayStep(plan,step),id=encodeURIComponent(plan.daySession.lessonId);
 if(step==='lesson')return '#/lesson/'+id;
 if(step==='write'){
  if(block?.practiceTask)return `#/practice/writing/${plan.day}/${block.id}`;
  const {latest}=authoredLessonState(lesson,data.state.attempts),tasks=lessonParts(lesson).write,next=tasks.find(e=>latest.get(e.id)?.feedback?.verdict!=='correct')||tasks[0];
  return next?`#/lesson/${id}/${lesson.exercises.indexOf(next)}?practice`:'';
 }
 if(step==='speak'&&data.settings?.provider!=='offline')return `#/conversation/lesson-${id}/${plan.daySession.speakId}`;
 if(['transfer','sound'].includes(step))return block?.href||'';
 return '';
}
export async function mountDay(root,data,refresh,step=''){
 const ctx=dayContext(data,{force:true});
 if(!ctx){root.innerHTML=`<div class="lesson-flow day-flow"><section class="day-screen"><h1>План дня ещё не собран</h1><p class="small-note">Открой «Сегодня» — там соберётся занятие на день.</p><div class="day-next"><a class="btn primary" href="#/today">К плану на сегодня ${icon('arrow')}</a></div></section></div>`;return;}
 setDayFlag(ctx.day);
 if(!ctx.lesson&&step&&step!=='notes'&&step!=='recall'){root.innerHTML=`<div class="lesson-flow day-flow">${dayHeader(ctx,step)}<section class="day-screen"><h1>Урок дня не найден</h1><p class="small-note">Возможно, курс обновился. Пересобери план на странице «Сегодня».</p>${dayNextHTML(ctx,step)}</section></div>`;return;}
 const href=step?destination(ctx,step):'';if(href){location.replace(href);return;}
 if(step==='watch'&&dayStep(ctx.plan,'watch')){const {mountDayWatch}=await import('./day-watch.js');return mountDayWatch(root,ctx,refresh);}
 if(step==='notes'){const {mountDayNotes}=await import('./day-notes.js');return mountDayNotes(root,ctx,refresh);}
 if(step==='recall')return recall(root,ctx);
 if(step==='speak'||step==='retell')return retell(root,ctx);
 overview(root,ctx);
}
// One short line per step on the overview; the full instruction waits on the step itself.
const stepLook={recall:['cards','Вчерашние фразы и карточки'],speak:['mic','Разговор на тему урока'],retell:['mic','Пересказ трижды, каждый раз быстрее'],watch:['play','Короткое видео с формой урока'],write:['pen','Своё сообщение с формой урока'],transfer:['loop','Старая тема в новой ситуации'],sound:['sound','Один звук: слушай и повторяй'],notes:['journal','Правило, лучшая фраза, план на завтра']};
// The day's steps as one grouped list; on Today each row also opens its step.
export function dayStepsHTML(blocks,first,links=false){
 const row=b=>{const [ic,line]=b.step==='lesson'?['book','Объяснение и задания по шагам']:stepLook[b.step]||['spark',b.instruction];const inner=`<span class="day-step-icon" aria-hidden="true">${icon(b.done?'check':ic)}</span><span class="day-step-text"><strong>${esc(b.label||b.title)}</strong><small>${esc(line)}</small></span><span class="day-step-time">${b.minutes} мин</span>`;return `<li class="${b.done?'is-done':''}${b===first?' is-next':''}">${links?`<a href="#/day/${esc(b.step)}" data-day-go="${esc(b.step)}">${inner}</a>`:inner}</li>`;};
 return `<ol class="day-steps${links?' is-links':''}">${blocks.map(row).join('')}</ol>`;
}
function overview(root,ctx){
 const {plan,progress,lesson}=ctx,first=progress.blocks.find(b=>!b.done)||progress.blocks[0];
 root.innerHTML=`<div class="lesson-flow day-flow">${dayHeader(ctx,'',plan.level+' · '+plan.minutes+' мин')}<section class="day-screen day-overview"><h1>Твой день</h1>${lesson?`<p class="day-lead">${esc(lesson.title)}</p>`:''}${dayStepsHTML(progress.blocks,first)}<div class="day-next"><a class="btn primary" href="#/day/${esc(first.step)}" data-day-go="${esc(first.step)}">${progress.done?'Продолжить':'Начать'} ${icon('arrow')}</a></div></section></div>`;
}
// Step 0: yesterday's phrases one at a time, then the due cards.
function recall(root,ctx){
 const items=recallPhrases(previousNotes(ctx.data.state,ctx.day)),due=(ctx.data.state.cards||[]).filter(c=>Date.parse(c.due)<=Date.now()).length;let i=0,shown=false;
 function draw(){
  const item=items[i];let body;
  if(item)body=`<p class="day-count">${i+1} из ${items.length}</p><p class="day-cue">${esc(item.cue)}</p>${shown?`<p class="day-reveal" lang="en">${esc(item.en)}</p><button type="button" class="btn ghost small" id="recall-listen">${icon('sound')} Послушать</button>`:'<p class="small-note">Скажи вслух, потом проверь себя.</p>'}<div class="day-next"><button type="button" class="btn primary" id="recall-go">${shown?(i<items.length-1?'Следующая':'Готово'):'Показать'} ${icon('arrow')}</button></div>`;
  else if(due)body=`<p class="day-cue">Карточки, которым пора вернуться: ${due}.</p><p class="small-note">Сначала вспомни, потом переворачивай.</p><div class="day-next"><a class="btn primary" href="#/review">Повторить карточки · ${due} ${icon('arrow')}</a><a class="btn ghost" href="#/today" data-day-stop>На сегодня хватит</a></div>`;
  else body=`<p class="day-cue">Вчерашнее вспомнили.</p>${dayNextHTML(ctx,'recall',{mark:true})}`;
  root.innerHTML=`<div class="lesson-flow day-flow">${dayHeader(ctx,'recall')}<section class="day-screen"><h1>Вспомнить вчерашнее</h1>${body}</section></div>`;
  if($('#recall-listen',root))$('#recall-listen',root).onclick=()=>speak(item.en);
  if($('#recall-go',root))$('#recall-go',root).onclick=()=>{stopAudio();if(!shown){shown=true;}else{shown=false;i++;}draw();};
 }
 draw();
}
// Offline speaking: tell the lesson's speaking task three times, each time faster (4/3/2).
function retell(root,ctx){
 const lesson=ctx.lesson,task=lessonParts(lesson).speak[0],rounds=['A1','A2'].includes(lesson.level)?[90,60,45]:[180,120,60];
 const prompt=task?.prompt||`Расскажи о себе и своём дне. Используй: ${lesson.keyRule?.rule||lesson.formula||lesson.goal}`;
 const mic=Boolean(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);let round=0,left=0,timer=null,running=false;
 const clock=n=>n>=60?`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`:`${n} с`;
 root.innerHTML=`<div class="lesson-flow day-flow">${dayHeader(ctx,'speak')}<section class="day-screen"><h1>Расскажи трижды</h1><p class="day-cue">${esc(prompt)}</p><p class="small-note">Одно и то же — три раза, каждый раз короче по времени. Не читай с листа; ${mic?'каждый круг записывается, последний можно послушать.':'говори вслух.'}</p><p class="day-count" id="retell-round"></p><p class="day-clock" id="retell-clock" aria-live="polite"></p><div class="day-next" id="retell-actions"><button type="button" class="btn primary" id="retell-go"></button></div><button type="button" id="retell-rec" hidden></button><audio id="retell-audio" class="audio-preview" controls hidden></audio><div id="retell-done"></div></section></div>`;
 const go=$('#retell-go',root),rec=$('#retell-rec',root),audio=$('#retell-audio',root);
 const label=()=>{$('#retell-round',root).textContent=`Круг ${Math.min(round+1,3)} из 3`;$('#retell-clock',root).textContent=clock(running?left:rounds[round]);go.innerHTML=running?'Готово':`Начать круг ${round+1} · ${clock(rounds[round])}`;};
 const stop=async()=>{clearInterval(timer);running=false;if(mic&&rec.classList.contains('recording'))recordOnly(rec,audio);round++;
  if(round<3){label();return;}
  $('#retell-actions',root).remove();$('#retell-round',root).textContent='Три круга позади';$('#retell-clock',root).textContent='';
  await markDayStep(ctx.data,ctx.day,'speak').catch(()=>{});$('#retell-done',root).innerHTML=dayNextHTML(ctx,'speak');};
 go.onclick=()=>{if(running){stop();return;}running=true;left=rounds[round];if(mic)recordOnly(rec,audio,null);label();timer=setInterval(()=>{left--;if(!root.isConnected){clearInterval(timer);return;}if(left<=0)stop();else $('#retell-clock',root).textContent=clock(left);},1000);};
 window.addEventListener('hashchange',()=>clearInterval(timer),{once:true});
 label();
}
