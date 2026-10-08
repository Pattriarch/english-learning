import {authoredExerciseID} from './authored-exercise.js';
import {transferQueue} from './transfer-model.js';
// A day session: one anchor lesson, then speak, watch, write and sum up around it.
// Pure functions; the saved plan stays a snapshot and progress is read from evidence.
const arr=v=>Array.isArray(v)?v:[];
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const parse=raw=>{try{return JSON.parse(typeof raw==='string'?raw:raw?.text||'null');}catch{return null;}};
const hash=value=>{let h=2166136261;for(const c of value){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');};
const dayOf=v=>{const t=Date.parse(v);if(!Number.isFinite(t))return '';const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const DAY_LABELS={recall:'Вспомнить',lesson:'Урок',speak:'Говорим',watch:'Смотрим',write:'Пишем',transfer:'Закрепление',sound:'Звук',notes:'Итог дня'};
const ORDER=['recall','lesson','speak','watch','write','transfer','sound','notes'];
const TIME={30:{recall:2,lesson:12,speak:5,watch:5,write:4,notes:2},60:{recall:5,lesson:20,speak:10,watch:12,write:10,notes:3},90:{recall:5,lesson:25,speak:12,watch:20,write:12,transfer:8,sound:5,notes:3}};
export const dayNotesKey=day=>'day:notes:'+day;
export const dayProgressKey=day=>'day:progress:'+day;
export const dayWatchKey=day=>'day:watch:'+day;
export const daySpeakID=(day,lessonId)=>('day-'+day+'-'+String(lessonId||'')).slice(0,96);
export const isDayPlan=plan=>plan?.daySession?.version===1&&typeof plan.daySession.lessonId==='string';
// The lesson's own free write/speak tasks move to the day's write and speak steps.
export const independentTask=e=>e?.practiceStage==='independent'||(!e?.practiceStage&&['write','speak'].includes(e?.kind));
export function lessonParts(lesson){
 const all=arr(lesson?.exercises).filter(e=>authoredExerciseID(e)),own=all.filter(e=>!independentTask(e));
 return {guided:own.length?own:all,write:own.length?all.filter(e=>independentTask(e)&&e.kind==='write'):[],speak:all.filter(e=>independentTask(e)&&e.kind==='speak')};
}
const safeEmbed=url=>typeof url==='string'&&/^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[A-Za-z0-9_-]{6,20}(\?[A-Za-z0-9_=&.-]*)?$/.test(url)?url:'';
// Clip for the lesson: authored clip → cinema episode → lesson listening → none.
export function lessonClip(data,lesson){
 if(!lesson)return null;
 const clip=obj(obj(data?.lessonClips).clips)[lesson.id];
 if(clip&&(safeEmbed(clip.embed)||/^https:\/\//.test(clip.url||''))&&typeof clip.shadowLine==='string'&&clip.shadowLine.trim())
  return {kind:'clip',title:String(clip.title||'Ролик'),source:String(clip.source||''),url:/^https:\/\//.test(clip.url||'')?clip.url:'',embed:safeEmbed(clip.embed),question:clip.question?.prompt?{prompt:String(clip.question.prompt),answer:String(clip.question.answer||'')}:null,lookFor:String(clip.lookFor||lesson.formula||''),shadowLine:clip.shadowLine.trim(),lines:arr(clip.lines).filter(l=>typeof l==='string').slice(0,40)};
 for(const series of arr(data?.cinema?.series))for(const ep of arr(series?.episodes))if(arr(ep?.lessonIds).includes(lesson.id)){
  const phrase=String(arr(ep.lexicon)[0]||'').split(' — ')[0].trim();
  if(phrase)return {kind:'cinema',title:`${series.title} · ${ep.title}`,source:String(series.subtitle||''),text:String(ep.watch||ep.synopsis||''),question:null,lookFor:String(ep.grammar||ep.focus||''),shadowLine:phrase,lines:[]};
 }
 const m=arr(lesson.materials).find(m=>['listening','dialogue'].includes(m?.kind)&&typeof m.text==='string'&&m.text.trim());
 if(m){const sentences=m.text.match(/[^.!?]+[.!?]+/g)||[m.text];return {kind:'audio',title:String(m.title||'Запись'),source:String(m.source||''),text:m.text,question:null,lookFor:lesson.formula?'Найди, где звучит: '+lesson.formula:'',shadowLine:(sentences.find(s=>s.trim().split(/\s+/).length>=4)||sentences[0]).trim(),lines:[]};}
 return null;
}
// The latest notes before today (up to a week back) feed tomorrow's recall.
export function previousNotes(state,day){
 const drafts=obj(state?.drafts),keys=Object.keys(drafts).filter(k=>k.startsWith('day:notes:')&&k.slice(10)<day).sort().reverse();
 for(const k of keys.slice(0,7)){const n=parse(drafts[k]);if(n&&[n.best,n.fix,n.phrase].some(v=>typeof v==='string'&&v.trim()))return {...n,day:k.slice(10)};}
 return null;
}
export function recallPhrases(notes){
 if(!notes)return [];const out=[],text=v=>typeof v==='string'?v.trim():'';
 const fix=text(notes.fix),parts=fix.split(/\s*(?:→|->)\s*/);
 if(parts.length>1&&parts[1])out.push({cue:'Вчерашняя ошибка: «'+parts[0]+'». Как правильно?',en:parts.slice(1).join(' ')});
 if(text(notes.phrase))out.push({cue:'Фраза из вчерашнего ролика. Вспомни её целиком.',en:text(notes.phrase)});
 if(text(notes.best))out.push({cue:'Твоё лучшее предложение вчера. Скажи его снова.',en:text(notes.best)});
 return out.slice(0,3);
}
function budget(minutes){
 const base=minutes<=30?TIME[30]:minutes<=60?TIME[60]:TIME[90];if(minutes<=90)return {...base};
 const k=minutes/90,out=Object.fromEntries(Object.entries(base).map(([s,m])=>[s,Math.max(1,Math.round(m*k))]));
 out.lesson+=minutes-Object.values(out).reduce((a,b)=>a+b,0);return out;
}
const writePrompt=(lesson,basic,recycled)=>`Напиши 5 коротких предложений о своём сегодняшнем дне: 3 — с формой урока «${lesson.title}» (${lesson.formula||lesson.goal}), 1 — с фразой из ролика, которую ты сохранил, 1 — с ${recycled?`прошлой темой «${recycled.title}»`:'любой прошлой темой'}. ${basic?'Простые фразы — это нормально.':'Пиши о том, что правда было.'} После разбора перепиши самое слабое предложение.`;
/** Build the ordered steps for a day around one lesson. `pending(e)` says an exercise still needs an answer. */
export function createDaySession(data={},{lesson,level,minutes,domain,now,beginner=false,pending=()=>true,skill='grammar'}={}){
 if(!lesson?.id)return null;
 const date=new Date(now),day=dayOf(date.toISOString()),state=obj(data.state),time=budget(minutes),basic=['A1','A2'].includes(level),parts=lessonParts(lesson);
 const due=arr(state.cards).filter(c=>c?.id&&Date.parse(c.due)<=date.getTime()).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due)).slice(0,minutes<=30?8:15);
 const recall=recallPhrases(previousNotes(state,day)),clip=lessonClip(data,lesson),guided=parts.guided.filter(pending),write=parts.write.filter(pending);
 const recycled=arr(lesson.recycles).map(id=>arr(data.lessons).find(l=>l?.id===id)).find(Boolean);
 const transfer=time.transfer?transferQueue(data,date,{limit:1}).due[0]:null;
 const sounds=arr(data.pronunciation?.lessons).filter(l=>typeof l?.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(l.id)),tried=new Set(arr(state.attempts).filter(a=>a?.lessonId==='pronunciation').map(a=>a.exerciseId));
 const sound=time.sound?sounds.find(l=>String(l.level||'').includes(level)&&!tried.has(l.id))||sounds.find(l=>!tried.has(l.id)):null;
 const step=(id,skillName,title,instruction,why,target,extra={})=>({id:'day-'+id,step:id,skill:skillName,title,label:DAY_LABELS[id],instruction,why,minutes:time[id]||1,href:'#/day/'+id,target,...extra});
 const steps=[];
 if(due.length||recall.length)steps.push(step('recall','review','Вспомнить вчерашнее',`${recall.length?'Вспомни '+recall.length+' фразы из вчерашнего итога. ':''}${due.length?'Повтори карточки: '+due.length+'.':''}`.trim(),'Короткое вспоминание до подсказки закрепляет вчерашнее лучше, чем повторное чтение.',due.length?{kind:'reviews',cardIds:due.map(c=>c.id),count:due.length}:{kind:'day',step:'recall',count:1}));
 if(guided.length)steps.push(step('lesson',skill,lesson.title,'Объяснение и задания с опорой. Свои сообщение и речь будут дальше, отдельными шагами.','Сначала одна конструкция с подсказкой, потом — своя речь.',{kind:'attempts',exactExerciseIds:true,lessonIds:[lesson.id],exerciseIds:guided.map(authoredExerciseID),count:guided.length},{lessonId:lesson.id}));
 steps.push(step('speak','speaking','Говорим','Короткий разговор, где нужна форма урока. Без собеседника — перескажи задание урока трижды, каждый раз быстрее.','Форма закрепляется, когда её приходится достать из памяти в разговоре.',{kind:'day',step:'speak',lessonId:lesson.id,count:1},{lessonId:lesson.id}));
 if(clip)steps.push(step('watch','listening','Смотрим: '+clip.title,'Посмотри без субтитров, ответь на вопрос, найди форму урока, повтори одну реплику и сохрани её.','Живая речь показывает ту же форму в настоящем темпе.',{kind:'day',step:'watch',count:1},{lessonId:lesson.id}));
 const writeBlock=write.length?step('write','writing','Пишем',`Своё сообщение из урока: ${write.length===1?'одно задание':write.length+' задания'}. После разбора перепиши самое слабое предложение.`,'Самостоятельный текст показывает, что форма уже твоя.',{kind:'attempts',exactExerciseIds:true,lessonIds:[lesson.id],exerciseIds:write.map(authoredExerciseID),count:write.length},{lessonId:lesson.id}):null;
 if(writeBlock)steps.push(writeBlock);
 else{const prompt=writePrompt(lesson,basic,recycled),task={id:`daily-${day}-day-write-${hash(JSON.stringify([level,lesson.id,prompt]))}`,title:'Пишем о своём дне',prompt,passage:'',level,mode:'writing'};
  steps.push(step('write','writing','Пишем о своём дне','Пять предложений о своём дне с формой урока. После разбора перепиши самое слабое.','Самостоятельный текст показывает, что форма уже твоя.',{kind:'attempts',count:1,lessonIds:['free'],exerciseIds:['writing-'+task.id]},{practiceTask:task}));}
 if(transfer)steps.push({...step('transfer',transfer.next==='speak'?'speaking':'writing','Закрепление: '+transfer.title,'Примени прошлую тему в новой ситуации.','Тема возвращается после паузы — так она остаётся надолго.',{kind:'transfer',count:1,lessonId:transfer.lessonId,anchorAt:transfer.anchorAt,round:transfer.round,stage:transfer.next}),href:'#/transfer/'+transfer.lessonId});
 if(sound)steps.push({...step('sound','pronunciation','Звук: '+String(sound.title||'произношение'),'Послушай, повтори, запиши себя и отметь одно отличие.','Один звук или ударение за день.',{kind:'attempts',count:1,lessonIds:['pronunciation'],exerciseIds:[sound.id]}),href:'#/pronunciation/'+sound.id});
 steps.push(step('notes','writing','Итог дня','Правило своими словами, лучшее предложение, ошибка и исправление, план на завтра.','Короткий итог завтра станет разминкой.',{kind:'day',step:'notes',count:1}));
 // Skipped steps give their minutes to speaking and writing.
 const used=steps.reduce((n,b)=>n+b.minutes,0),spare=minutes-used;
 if(spare>0){const s=steps.find(b=>b.step==='speak'),w=steps.find(b=>b.step==='write');s.minutes+=Math.ceil(spare/2);w.minutes+=Math.floor(spare/2);}
 steps.sort((a,b)=>ORDER.indexOf(a.step)-ORDER.indexOf(b.step));
 return {version:1,...(beginner?{beginner:true}:{}),day,createdAt:date.toISOString(),level,minutes,domain,daySession:{version:1,lessonId:lesson.id,speakId:daySpeakID(day,lesson.id)},blocks:steps};
}
/** Evidence for kind:'day' steps; never a quality claim. */
export function dayStepEvidence(spec,state,day){
 const drafts=obj(state?.drafts),marks=obj(parse(drafts[dayProgressKey(day)]));
 if(spec.step==='notes'){const n=parse(drafts[dayNotesKey(day)]);return n?.savedAt&&['rule','best','fix','next'].some(k=>typeof n[k]==='string'&&n[k].trim())?1:0;}
 if(spec.step==='watch'){const w=parse(drafts[dayWatchKey(day)]);return w?.done||marks.watch?1:0;}
 if(spec.step==='speak'){
  if(marks.speak)return 1;const id=daySpeakID(day,spec.lessonId),talk=parse(drafts['conversation:v1:'+id]);
  if(arr(talk?.turns).length>=3)return 1;
  return arr(state?.attempts).some(a=>dayOf(a?.at)===day&&((a.lessonId==='conversation'&&String(a.exerciseId).startsWith(id+'-'))||(a.lessonId===spec.lessonId&&a.mode==='speaking')))?1:0;
 }
 return marks[spec.step]?1:0;
}
export function dayPlanFrom(raw,day){const plan=parse(raw);return plan?.day===day&&isDayPlan(plan)?plan:null;}
export function dayStep(plan,id){return arr(plan?.blocks).find(b=>b.step===id)||null;}
export function nextDayStep(plan,id){const blocks=arr(plan?.blocks),i=blocks.findIndex(b=>b.step===id);return i>=0?blocks[i+1]||null:null;}
