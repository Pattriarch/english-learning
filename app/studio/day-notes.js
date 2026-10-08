import {$,$$,esc,icon,getDraft,queueDraft} from './core.js';
import {dayNotesKey,dayWatchKey} from './day-session-model.js';
import {dayHeader,dayNextHTML} from './day-session.js';

const parse=raw=>{try{return JSON.parse(typeof raw==='string'?raw:raw?.text||'null');}catch{return null;}};
const local=at=>{const d=new Date(at);return Number.isFinite(d.getTime())?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:'';};
const fields=[['rule','Правило своими словами','По-русски, одной строкой'],['best','Моё лучшее предложение','Английское предложение, которым доволен'],['fix','Ошибка → исправление','I is ready → I am ready'],['next','Что попробую завтра','Одна конкретная вещь']];
// Today's answers suggest the best sentence and one correction; the learner edits both.
export function dayNotesDraft(state,day,lessonId){
 const today=(state.attempts||[]).filter(a=>local(a.at)===day&&typeof a.answer==='string'&&a.answer.trim()&&(a.lessonId===lessonId||a.lessonId==='free'||a.lessonId==='conversation'));
 const good=today.filter(a=>a.feedback?.verdict==='correct').sort((a,b)=>b.answer.length-a.answer.length)[0]||today.at(-1);
 const mistake=today.flatMap(a=>a.feedback?.mistakes||[]).find(m=>m?.original&&m?.correction);
 return {best:good?(good.feedback?.verdict==='correct'?good.answer:good.feedback?.corrected||good.answer).trim().slice(0,240):'',fix:mistake?`${mistake.original} → ${mistake.correction}`.slice(0,240):''};
}
export function mountDayNotes(root,ctx){
 const key=dayNotesKey(ctx.day),saved=parse(getDraft(key,ctx.data.state)),watch=parse(getDraft(dayWatchKey(ctx.day),ctx.data.state));
 const notes={version:1,lessonId:ctx.plan.daySession.lessonId,rule:'',next:'',...dayNotesDraft(ctx.data.state,ctx.day,ctx.plan.daySession.lessonId),phrase:watch?.phrase||'',...(saved||{})};
 let done=Boolean(saved?.savedAt);
 const write=immediate=>{notes.at=new Date().toISOString();const text=JSON.stringify(notes);ctx.data.state.drafts={...ctx.data.state.drafts,[key]:{text,at:notes.at}};return queueDraft(key,text,immediate);};
 function draw(){
  root.innerHTML=`<div class="lesson-flow day-flow">${dayHeader(ctx,'notes')}<section class="day-screen day-notes"><h1>Итог дня</h1>${ctx.lesson?`<p class="day-lead">${esc(ctx.lesson.title)}</p>`:''}${done?`<dl class="day-notes-list">${fields.filter(([id])=>notes[id]).map(([id,label])=>`<div><dt>${label}</dt><dd${id==='rule'||id==='next'?'':' lang="en"'}>${esc(notes[id])}</dd></div>`).join('')}${notes.phrase?`<div><dt>Фраза из ролика</dt><dd lang="en">${esc(notes.phrase)}</dd></div>`:''}</dl><p class="small-note">Завтра начнём с этих фраз.</p>${dayNextHTML(ctx,'notes')}`:`<form id="day-notes-form" class="day-notes-form">${fields.map(([id,label,hint])=>`<label class="field"><span>${label}</span><input name="${id}" maxlength="240" value="${esc(notes[id])}" placeholder="${esc(hint)}" ${id==='rule'||id==='next'?'lang="ru"':'lang="en" spellcheck="false"'}></label>`).join('')}<div class="day-next"><button class="btn primary" type="submit">Сохранить итог ${icon('check')}</button><a class="btn ghost" href="#/today" data-day-stop>На сегодня хватит</a></div></form>`}<a class="small-note day-journal-link" href="#/journal">Все итоги — в «Моём прогрессе»</a></section></div>`;
  const form=$('#day-notes-form',root);if(!form)return;
  $$('input',form).forEach(input=>input.oninput=()=>{notes[input.name]=input.value;write(false);});
  form.onsubmit=async event=>{event.preventDefault();if(!fields.some(([id])=>String(notes[id]||'').trim())){$('input',form).focus();return;}notes.savedAt=new Date().toISOString();await write(true);done=true;draw();};
 }
 draw();
}
/** Recent day notes for the journal. */
export function dayNotesJournalHTML(state,limit=14){
 const days=Object.keys(state?.drafts||{}).filter(k=>k.startsWith('day:notes:')).map(k=>k.slice(10)).sort().reverse().slice(0,limit);
 const items=days.map(day=>({day,n:parse(getDraft(dayNotesKey(day),state))})).filter(x=>x.n&&fields.some(([id])=>x.n[id]));
 if(!items.length)return '';
 return `<section class="day-journal"><div class="section-heading"><h2>Итоги дней</h2><span class="small-note">${items.length}</span></div>${items.map(({day,n})=>`<article class="card day-journal-entry"><span class="small-note">${esc(new Date(day+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'}))}</span><dl class="day-notes-list">${fields.filter(([id])=>n[id]).map(([id,label])=>`<div><dt>${label}</dt><dd${id==='rule'||id==='next'?'':' lang="en"'}>${esc(n[id])}</dd></div>`).join('')}${n.phrase?`<div><dt>Фраза из ролика</dt><dd lang="en">${esc(n.phrase)}</dd></div>`:''}</dl></article>`).join('')}</section>`;
}
