// Course availability and evidence of learning are deliberately independent.
import {transferIdentity} from './transfer-model.js';
import {projectProgress,projectTimestamp} from './projects-model.js';
const list=v=>Array.isArray(v)?v:[];
const time=v=>typeof v==='string'?Date.parse(v):NaN;
const base=v=>String(v||'').replace(/--[a-f0-9]{16}$/i,'');
const normalized=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
const graded=a=>a?.feedback?.verdict==='correct'&&['codex','claude','ollama','compatible'].includes(a.feedback.source);
export const masteryDomains={grammar:'Грамматика',lexical:'Слова и сочетания',reading:'Чтение',listening:'Аудирование',writing:'Письмо',speaking:'Устная речь',interaction:'Диалог',online:'Общение онлайн',mediation:'Передать смысл',phonology:'Произношение',pragmatics:'Уместность речи'};
export const masteryStatuses={new:'Ещё нет ответов',practiced:'Есть практика',reviewed:'Проверено в упражнениях',retained:'Есть отложенное применение',external:'Нужна проверка в живом общении'};
export function evidenceTarget(e){
 if(e.lessonId?.startsWith('pron-'))return {id:'pronunciation',href:'#/pronunciation/'+e.lessonId};
 const id=e.unitId?'book-'+e.unitId:e.lessonId;
 return {id,href:e.unitId?'#/unit/'+e.unitId:id?.startsWith('project-')?'#/projects/'+id.slice(8):id==='pronunciation'?'#/pronunciation':id==='research'?'#/focus/'+(e.exerciseIds?.[0]||''):'#/lesson/'+id};
}
function matches(a,e,data){
 const {id}=evidenceTarget(e);if(a.lessonId!==id)return false;
 const ids=e.lessonId?.startsWith('pron-')?[e.lessonId]:list(e.exerciseIds);if(!ids.length||!ids.includes(base(a.exerciseId)))return false;
 // Current published book versions are available in bootstrap metadata. Do not
 // reuse a successful answer from an older, materially different question.
 if(e.unitId){const pinned=data.masteryBookVersions?.[e.unitId],current=list(pinned||data.bookStatus?.units?.[e.unitId]?.exerciseIds);if((pinned||current.length)&&!current.includes(a.exerciseId))return false;}
 else {const exercise=list(data.lessons).find(l=>l.id===id)?.exercises?.find(x=>x.id===a.exerciseId);if(exercise&&exercise.prompt!==a.prompt)return false;}
 return true;
}
export function indicatorProgress(indicator,data={},now=Date.now()){
 const state=data.state||{},end=Number(new Date(now)),all=list(state.attempts).filter(a=>a?.id&&normalized(a.answer)&&projectTimestamp(a.at,end)!==null);
 const relevant=all.filter(a=>list(indicator.evidence).some(e=>matches(a,e,data)));
 const latest=new Map();for(const a of relevant){const k=a.lessonId+':'+a.exerciseId;if(!latest.has(k)||time(a.at)>=time(latest.get(k).at))latest.set(k,a);}
 const answers=[...latest.values()],accepted=answers.filter(graded);
 const minimum=Math.max(2,indicator.demonstration?.minAttempts||2);
 const enough=accepted.length>=minimum;
 const prerequisites=[...accepted].sort((a,b)=>time(a.at)-time(b.at)).slice(0,minimum);
 const audioPrerequisite=indicator.demonstration?.requiresAudio?accepted.filter(a=>a.mode==='speaking').sort((a,b)=>time(a.at)-time(b.at))[0]:null;
 const first=enough?Math.max(...prerequisites.map(a=>time(a.at)),audioPrerequisite?time(audioPrerequisite.at):0):Infinity;
 const delay=Math.max(7,indicator.demonstration?.delayedDays||7)*86400000;
 const origins=new Set(list(indicator.evidence).map(e=>evidenceTarget(e).id));
 const latestTransfer=new Map();for(const a of all){const t=transferIdentity(a);if(!t&&!(a.lessonId?.startsWith('project-')&&a.exerciseId==='transfer'))continue;const key=a.lessonId+':'+a.exerciseId;if(!latestTransfer.has(key)||time(a.at)>=time(latestTransfer.get(key).at))latestTransfer.set(key,a);}
 const delayed=[...latestTransfer.values()].sort((a,b)=>time(b.at)-time(a.at)).find(a=>{
  if(!enough||!graded(a)||time(a.at)<first+delay||accepted.some(b=>normalized(b.answer)===normalized(a.answer)))return false;
  const t=transferIdentity(a);
  if(t&&origins.has(t.lessonId)&&['write','speak'].includes(t.stage))return true;
  if(origins.has(a.lessonId)&&a.lessonId.startsWith('project-')&&a.exerciseId==='transfer'){
   const unit=list(data.masteryProjects?.units).find(u=>'project-'+u.id===a.lessonId);if(!unit)return false;
   const progress=projectProgress(unit,state,end);return progress.independent&&progress.transfer?.id===a.id;
  }
  return false;
 });
 const external=indicator.domain==='phonology'||indicator.demonstration?.requiresPartner===true;
 // ASR's text mode is useful evidence of speaking practice, never a phonetic test.
 const voice=accepted.some(a=>a.mode==='speaking');
 const ready=enough&&(!indicator.demonstration?.requiresAudio||voice);
 const status=!answers.length?'new':external?'external':ready&&delayed?'retained':ready?'reviewed':'practiced';
 return {status,answers:answers.length,accepted:accepted.length,minimum,voice,delayed:delayed||null,lastAt:relevant.length?new Date(Math.max(...relevant.map(a=>time(a.at)))).toISOString():null};
}
export function masterySummary(level,data,now){
 const indicators=list(level.indicators).map(i=>({...i,progress:indicatorProgress(i,data,now)}));
 return {indicators,total:indicators.length,prepared:indicators.filter(i=>i.coverage==='practice').length,partial:indicators.filter(i=>i.coverage!=='practice').length,practiced:indicators.filter(i=>i.progress.answers>0).length,reviewed:indicators.filter(i=>['reviewed','retained'].includes(i.progress.status)).length,retained:indicators.filter(i=>i.progress.status==='retained').length};
}
