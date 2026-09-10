import {$,esc,icon,getDraft,localDraft,queueDraft,dateKey,uid,toast} from './core.js';

const storageKey='planner:session';
const dismissalKey='planner:session-dismissed';
let session=null,host=null,owner='',lastTick=0,lastSave=0,initialized=false;
function dismissed(){try{return sessionStorage.getItem(dismissalKey)==='yes';}catch{return false;}}
function dismissPanel(value){try{if(value)sessionStorage.setItem(dismissalKey,'yes');else sessionStorage.removeItem(dismissalKey);}catch{}}
export function restoreStudySession(raw,day,now=Date.now()){
  try{const value=JSON.parse(raw);if(value?.version!==1||value.day!==day||!value.blockId||!value.title||!Number.isFinite(value.minutes))return null;
    return {...value,minutes:Math.max(1,Math.min(180,value.minutes)),seconds:Math.max(0,Number(value.seconds)||0),sinceBreak:Math.max(0,Number(value.sinceBreak)||0),breakSeconds:Math.max(0,Math.min(300,value.stage==='break'&&Number.isFinite(value.breakEndsAt)?(value.breakEndsAt-now)/1000:Number(value.breakSeconds)||0)),stage:value.stage==='break'?'break':'study',totals:value.totals&&typeof value.totals==='object'?value.totals:{},active:false};
  }catch{return null;}
}
export function advanceStudySession(value,delta,visible=true,now){
  if(!value?.active||!Number.isFinite(delta)||delta<=0)return value;
  if(value.stage==='break'){const left=Math.max(0,Number.isFinite(value.breakEndsAt)&&Number.isFinite(now)?(value.breakEndsAt-now)/1000:value.breakSeconds-delta);return {...value,breakSeconds:left,active:left>0};}
  if(!visible)return value;
  const elapsed=Math.min(5,delta);
  const seconds=value.seconds+elapsed;
  return {...value,seconds,sinceBreak:value.sinceBreak+elapsed,totals:{...value.totals,[value.blockId]:seconds}};
}
export const isStudyBreak=()=>session?.stage==='break';
const clock=seconds=>{const n=Math.max(0,Math.ceil(seconds));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
function ownsSession(){return session?.owner===owner&&storedOwner()===owner;}
function persist(takeover=false){
  if(!session||(!takeover&&!ownsSession()))return;
  if(takeover){
    const latest=restoreStudySession(localDraft(storageKey)?.text,session.day);
    if(latest&&latest.owner!==owner){
      const totals={...session.totals};
      for(const [id,value] of Object.entries(latest.totals))if(Number.isFinite(value)&&value>=0)totals[id]=Math.max(Number(totals[id])||0,value);
      session={...session,totals,seconds:Math.max(session.seconds,Number(totals[session.blockId])||0,latest.blockId===session.blockId?latest.seconds:0)};
    }
  }
  queueDraft(storageKey,JSON.stringify({...session,owner,updatedAt:new Date().toISOString()}));lastSave=Date.now();
}
function storedOwner(){try{return JSON.parse(localDraft(storageKey)?.text||'null')?.owner;}catch{return null;}}
function paint(){
  if(!host)return;host.hidden=!session;document.body.classList.toggle('has-study-session',!!session);if(!session)return;
  const breakMode=session.stage==='break',remaining=breakMode?session.breakSeconds:Math.max(0,session.minutes*60-session.seconds),finished=breakMode?remaining===0:session.seconds>=session.minutes*60;
  const title=breakMode?(finished?'Перерыв закончен':'Перерыв — отвлекись от экрана'):session.title;
  host.innerHTML=`<div class="study-session-copy"><span class="study-session-label">${breakMode?'ВОССТАНОВИТЬ ВНИМАНИЕ':session.active?'СЕЙЧАС В ПЛАНЕ':'СЕССИЯ НА ПАУЗЕ'}</span><strong>${esc(title)}</strong><small>${breakMode?'Перерыв не учитывается как время занятий.':finished?'Время блока вышло. Вернись к плану и проверь результат.':session.sinceBreak>=45*60?'Ты занимаешься около 45 минут — можно сделать перерыв.':'Открытие страницы и таймер не засчитывают выполнение задания.'}</small></div><span class="study-session-clock" aria-label="${breakMode?'Осталось перерыва':'Осталось времени блока'}">${clock(remaining)}</span><div class="study-session-controls"><button class="btn small" id="session-pause">${icon(session.active?'pause':'play')}${session.active?'Пауза':breakMode?'Продолжить учиться':'Продолжить'}</button>${breakMode?'':`<button class="btn small ghost" id="session-break">Перерыв 5 мин</button>`}<a class="btn small" href="#/today" id="session-plan">К плану ${icon('arrow')}</a><button class="btn small ghost" id="session-end" aria-label="Закончить сессию">${icon('close')}</button></div>`;
  $('#session-pause',host).onclick=()=>{if(session.stage==='break'&&!session.active){session.stage='study';session.sinceBreak=0;}session.active=!session.active;session.owner=owner;lastTick=Date.now();persist(true);paint();};
  if($('#session-break',host))$('#session-break',host).onclick=()=>{session={...session,owner,stage:'break',breakSeconds:300,breakEndsAt:Date.now()+300000,active:true};lastTick=Date.now();persist(true);paint();};
  $('#session-plan',host).onclick=()=>{session.active=false;persist();window.dispatchEvent(new CustomEvent('planner-updated',{detail:{day:session.day}}));paint();};
  $('#session-end',host).onclick=()=>{const owned=ownsSession();dismissPanel(true);session.active=false;persist();session=null;if(owned)queueDraft(storageKey,'');paint();window.dispatchEvent(new CustomEvent('planner-updated'));};
}
export function initStudySession(state){
  if(initialized)return;initialized=true;owner=uid();host=document.createElement('aside');host.id='study-session';host.className='study-session';host.setAttribute('aria-label','Текущее занятие');document.body.append(host);
  session=dismissed()?null:restoreStudySession(getDraft(storageKey,state),dateKey());paint();lastTick=Date.now();
  window.addEventListener('planner-start',event=>{
    const {plan,block}=event.detail||{};if(!plan||!block||plan.day!==dateKey()||!plan.blocks?.some(b=>b.id===block.id))return;dismissPanel(false);
    const previous=session?.day===plan.day?session:null,totals=previous?.totals||{};
    session={version:1,day:plan.day,blockId:block.id,title:block.title,minutes:block.minutes,href:block.href,seconds:Number(totals[block.id])||0,sinceBreak:previous?.sinceBreak||0,totals,stage:'study',breakSeconds:0,active:true,owner};
    lastTick=Date.now();persist(true);paint();
  });
  window.addEventListener('storage',event=>{if(event.key!=='ew-draft:'+storageKey||!session?.active)return;if(storedOwner()!==owner){session={...session,active:false,owner:null};paint();toast('Таймер продолжен в другой вкладке.');}});
  document.addEventListener('visibilitychange',()=>{lastTick=Date.now();if(session?.owner===owner)persist();});
  window.addEventListener('pagehide',()=>{if(session?.owner===owner)persist();});
  setInterval(()=>{
    const now=Date.now(),delta=(now-lastTick)/1000;lastTick=now;
    if(!session)return;
    if(session.day!==dateKey()){session=null;paint();return;}
    if(session.active&&!ownsSession()){session={...session,active:false,owner:null};paint();return;}
    const before=session;session=advanceStudySession(session,delta,!document.hidden,now);
    if(session!==before){
      if(now-lastSave>=15000||!session.active)persist();
      if(before.active!==session.active||(before.seconds<session.minutes*60&&session.seconds>=session.minutes*60)||(before.sinceBreak<2700&&session.sinceBreak>=2700))paint();
      else {const timer=$('.study-session-clock',host);if(timer)timer.textContent=clock(session.stage==='break'?session.breakSeconds:session.minutes*60-session.seconds);}
    }
  },1000);
}
