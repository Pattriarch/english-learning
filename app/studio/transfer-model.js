import {currentAuthoredExercise} from './authored-exercise.js';
import {hasStructuredBookStudy} from './planner-coursebooks.js';
// Practice evidence is separate from reading, study time and self-assessment.
export const TRANSFER_VERSION=1;
export const TRANSFER_INTERVALS=[1,3,7,21,60];
const array=value=>Array.isArray(value)?value:[];
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const time=value=>typeof value==='string'?Date.parse(value):NaN;
const day=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const addDays=(at,n)=>{const d=new Date(at);d.setDate(d.getDate()+n);return day(d);};
const base=id=>String(id||'').replace(/--[a-f0-9]{16}$/i,'');
const words=text=>String(text||'').trim().split(/\s+/).filter(Boolean).length;
const normalize=text=>String(text||'').trim().replace(/\s+/g,' ').toLowerCase();
const meaningful=a=>a&&typeof a.answer==='string'&&words(a.answer)>=4&&(a.answer.match(/\p{L}/gu)||[]).length>=12&&Number.isFinite(time(a.at));
const verdict=a=>a?.feedback?.verdict||'ungraded';
export const transferTopicKey=id=>'transfer:topic:'+id;
export const transferReviewKey=(id,round)=>`transfer:self:${id}:${round}`;
export const transferExerciseId=(id,round,stage)=>`transfer-v1-${id}-r${round}-${stage}`;
export const transferAnswerKey=(id,round,stage)=>`transfer:answer:${id}:${round}:${stage}`;
export function transferIdentity(attempt){
 if(attempt?.lessonId!=='free')return null;
 const m=String(attempt.exerciseId||'').match(/^transfer-v1-([A-Za-z0-9_-]+)-r(\d{1,4})-(recall|write|speak|revise)$/);
 return m&&safeId(m[1])?{lessonId:m[1],round:Number(m[2]),stage:m[3]}:null;
}
export function transferLessonIdentity(attempt){
 if(attempt?.lessonId==='free')return base(attempt.exerciseId).match(/^(book-.+-\d{3})-.+$/)?.[1]||null;
 return safeId(attempt?.lessonId)&&!['free','research','pronunciation'].includes(attempt.lessonId)?attempt.lessonId:null;
}
function parse(raw){try{return JSON.parse(typeof raw==='string'?raw:raw?.text||'null');}catch{return null;}}
export function validTransferSnapshot(value,id){
 return value?.version===1&&value.lessonId===id&&safeId(id)&&typeof value.title==='string'&&value.title.trim()&&typeof value.context==='string'&&value.context.trim()&&typeof value.anchorAt==='string'&&Number.isFinite(time(value.anchorAt))&&['A1','A2','B1','B2','C1','C2'].includes(value.level)&&typeof value.href==='string'&&/^#\/(lesson|unit)\/[A-Za-z0-9_-]+$/.test(value.href);
}
export function transferSnapshot(topic,lesson,now=new Date()){
 const level=(String(lesson?.level||topic.level).match(/[ABC][12]/)||['B1'])[0];
 const title=String(lesson?.title||topic.title).slice(0,240);
 const context=[`Topic: ${title}`,`Purpose: ${String(lesson?.goal||topic.goal||'').slice(0,900)}`,`Meaning and usage: ${String(lesson?.formula||'').slice(0,1400)}`,...array(lesson?.sections).slice(0,3).map(s=>`${String(s.title||'').slice(0,120)}: ${String(s.body||'').slice(0,1000)}`)].join('\n\n');
 return {version:1,lessonId:topic.lessonId,title,level,context,href:topic.href,anchorAt:topic.anchorAt,createdAt:new Date(now).toISOString(),sourceHash:lesson?.provenance?.sourceHash||null};
}
/** Discover only lessons with an actual sentence-length response. This is not a mastery threshold. */
export function transferTopics(data={}){
 const known=new Map(),aliases=new Map();
 for(const l of array(data.lessons))if(safeId(l?.id)&&array(l.exercises).length)known.set(l.id,{lessonId:l.id,title:l.title||l.id,goal:l.goal||'',level:l.level,href:'#/lesson/'+l.id,lesson:l});
 for(const b of array(data.library?.books))for(const u of array(b?.units)){
  const id=u.equivalentUnitId||u.id;if(!safeId('book-'+id))continue;aliases.set('book-'+u.id,'book-'+id);
  if(!known.has('book-'+id)||!b.duplicateOf)known.set('book-'+id,{lessonId:'book-'+id,title:u.titleRu||u.title||id,level:b.level,href:'#/unit/'+id,book:true});
 }
 const found=new Map();
 for(const a of array(data.state?.attempts)){
  if(!meaningful(a))continue;const original=transferLessonIdentity(a),id=aliases.get(original)||original,meta=known.get(id);if(!meta)continue;
  // A legacy fill-in/token task does not seed a transfer cycle.
  if(meta.lesson){const ex=currentAuthoredExercise(meta.lesson,a.exerciseId);if(!ex||!['translate','rewrite','write','speak','correct','explain','contrast'].includes(ex.kind))continue;}
  const previous=found.get(id);if(!previous||time(a.at)<time(previous.anchorAt))found.set(id,{...meta,anchorAt:a.at,anchorId:a.id});
 }
 return [...found.values()].map(topic=>{const saved=parse(data.state?.drafts?.[transferTopicKey(topic.lessonId)]);return validTransferSnapshot(saved,topic.lessonId)?{...topic,...saved,snapshot:saved}:topic;});
}
export function transferStages(round){return round===0?['recall','write','speak']:['recall',round%2?'speak':'write'];}
function stageAttempt(state,id,round,stage,after,before){
 const matches=array(state.attempts).filter(a=>a.lessonId==='free'&&a.exerciseId===transferExerciseId(id,round,stage)&&meaningful(a)&&time(a.at)>=after&&time(a.at)<=before&&(stage!=='speak'||a.mode==='speaking'));
 return matches.sort((a,b)=>time(a.at)-time(b.at)).at(-1)||null;
}
function reviewFor(state,id,round,attempts,after,before){
 const value=parse(state.drafts?.[transferReviewKey(id,round)]),ids=attempts.map(a=>a.id).sort();
 return value?.version===1&&value.kind==='self-check'&&value.checked===true&&time(value.at)>=after&&time(value.at)<=before&&typeof value.note==='string'&&words(value.note)>=4&&JSON.stringify(array(value.attemptIds).sort())===JSON.stringify(ids)?value:null;
}
/** Late work never creates several overdue repetitions of the same topic. */
export function transferProgress(topic,state={},now=new Date()){
 const stamp=new Date(now),before=stamp.getTime(),today=day(stamp),id=topic.lessonId;
 let dueDay=day(new Date(topic.anchorAt)),after=time(topic.anchorAt),round=0;
 const history=[];
 // A round requires saved work. This bound follows existing evidence, not elapsed days.
 const rounds=Math.min(1000,array(state.attempts).filter(a=>transferIdentity(a)?.lessonId===id).length+1);
 for(;round<rounds;round++){
  const stages=transferStages(round),attempts=[],stageRows=[];
  let next=null,last=after;
  for(const stage of stages){
   const attempt=next?null:stageAttempt(state,id,round,stage,Math.max(last,time(dueDay+'T00:00:00')),before);
   stageRows.push({stage,attempt,done:!!attempt});
   if(!attempt){next ||= stage;continue;}attempts.push(attempt);last=Math.max(last,time(attempt.at));
  }
  let revision=null,selfCheck=null,needsWork=attempts.some(a=>['partial','incorrect'].includes(verdict(a))),ungraded=attempts.some(a=>verdict(a)==='ungraded');
  if(!next&&(needsWork||ungraded)){
   revision=stageAttempt(state,id,round,'revise',last,before);
   // Re-sending the exact previous output is not a revision.
   if(revision&&attempts.some(a=>normalize(a.answer)===normalize(revision.answer)))revision=null;
   selfCheck=reviewFor(state,id,round,attempts,last,before);
   // A self-check is a separate report; it cannot erase specific negative feedback.
   if(!revision&&!(ungraded&&!needsWork&&selfCheck))next='revise';
   stageRows.push({stage:'revise',attempt:revision,done:!!revision||!!(selfCheck&&!needsWork),selfCheck:!!selfCheck});
  }
  if(next||dueDay>today)return {...topic,round,dueDay,due:dueDay<=today,next:next||stages[0],stages:stageRows,attempts,needsWork,ungraded,selfCheck,history,completedRounds:history.length,complete:false};
  const at=revision?.at||selfCheck?.at||attempts.at(-1)?.at;
  if(!at)break;
  const difficult=revision?['partial','incorrect'].includes(verdict(revision)):needsWork;
  const nominal=TRANSFER_INTERVALS[Math.min(round,TRANSFER_INTERVALS.length-1)],interval=difficult?1:ungraded||selfCheck?Math.max(1,Math.round(nominal/2)):nominal;
  history.push({round,at,interval,needsWork:difficult,selfChecked:!!selfCheck,ungraded:revision?verdict(revision)==='ungraded':ungraded,attemptIds:[...attempts,revision].filter(Boolean).map(a=>a.id)});
  dueDay=addDays(at,interval);after=time(at);
 }
 return {...topic,round,dueDay,due:dueDay<=today,next:'recall',stages:[],attempts:[],history,completedRounds:history.length,needsWork:false,ungraded:false};
}
export function transferQueue(data={},now=new Date(),options={}){
 // A six-stage chapter already owns recall, production, revision and delayed
 // transfer. Keep legacy generic history accessible, but do not prescribe a
 // second concurrent cycle for the same chapter in automatic queues.
 const topics=transferTopics(data).filter(t=>!hasStructuredBookStudy(data,t.lessonId)&&time(t.anchorAt)<=new Date(now).getTime()).map(t=>transferProgress(t,data.state,now));
 topics.sort((a,b)=>a.dueDay.localeCompare(b.dueDay)||a.lessonId.localeCompare(b.lessonId));
 const due=topics.filter(t=>t.due),limit=Math.max(1,Math.min(3,Number(options.limit)||2));
 return {topics,due:due.slice(0,limit),dueCount:due.length,upcoming:topics.filter(t=>!t.due),limit};
}
export function transferTargetEvidence(spec,state,dayKey){
 if(!safeId(spec?.lessonId)||!Number.isFinite(time(spec.anchorAt))||!/^\d{4}-\d{2}-\d{2}$/.test(dayKey||''))return 0;
 const progress=transferProgress({lessonId:spec.lessonId,anchorAt:spec.anchorAt},state,new Date(dayKey+'T23:59:59.999'));
 const ids=new Set(progress.history.find(h=>h.round===spec.round)?.attemptIds||[]);
 if(progress.round===spec.round){const row=progress.stages.find(s=>s.stage===spec.stage);if(row?.done&&row.attempt)ids.add(row.attempt.id);}
 return array(state.attempts).some(a=>ids.has(a.id)&&a.exerciseId===transferExerciseId(spec.lessonId,spec.round,spec.stage)&&day(new Date(a.at))===dayKey)?1:0;
}
export function transferTask(topic,round,stage,state={}){
 const level=(String(topic.level).match(/[ABC][12]/)||['B1'])[0],advanced=/C[12]/.test(level),basic=/A[12]/.test(level);
 const length=basic?'4–6 connected sentences':advanced?'140–190 words':'80–120 words';
 const scenarios=['a personal plan or a decision at work','a disagreement about shared time or resources','a recommendation to someone whose priorities differ from yours','a request to change an arrangement','an explanation of a past decision and its consequences','a choice between realistic alternatives'];
 const situation=scenarios[round%scenarios.length];
 const premise=`Target topic: ${topic.title}. Use American English as your default; other standard varieties are valid. Apply this topic naturally and accurately. If the topic is a contrast, choose a situation where the contrast changes the meaning; do not force incompatible forms into one sentence.`;
 let prompt,context=topic.context||`Topic: ${topic.title}`;
 if(stage==='recall')prompt=`Without opening your notes, explain when and why you would use the topic “${topic.title}”. Give one situation where it helps you communicate and one case where a different form or expression would change the meaning. Add two original complete English examples. You may explain your reasoning in Russian or English. Do not copy the lesson's examples.`;
 if(stage==='write')prompt=`${premise} Write ${length} as a complete message to a real or fictional person about ${situation}. State your purpose, give the recipient enough context, and make one clear request or recommendation. Use at least two meaningful examples of the target topic. Then add one short sentence explaining why these choices fit your intended meaning. Create your own details; do not present an invented event as something from a source text. ${advanced?'Make the register consistent, address a reasonable objection, and qualify a claim where necessary.':''}`;
 if(stage==='speak')prompt=`${premise} Speak for ${basic?'30–60 seconds':'1–2 minutes'} to a person who needs your advice about ${scenarios[(round+2)%scenarios.length]}. Use a different situation from your written message. Explain the problem, propose a solution, and respond to one likely objection. Use the topic in at least two complete thoughts. Finish with a question for the listener. Speak from ideas, not from a written script. The transcript is checked for meaning and language; it cannot establish pronunciation quality.`;
 if(stage==='revise'){
  const current=transferProgress(topic,state),previous=current.attempts||[],focus=[...previous].reverse().find(a=>['partial','incorrect'].includes(verdict(a)))||[...previous].reverse().find(a=>a.mode==='speaking')||previous.at(-1);
  prompt=`${premise} Revise your previous response below after considering the feedback. Keep the original purpose and relevant facts; correct the target topic and improve one unclear connection. Submit the complete revised response, not isolated corrections. Then briefly explain at least one meaningful change in Russian or English. If feedback was ungraded, use the topic notes to check the meaning yourself; no accuracy grade is implied. Do not copy a suggested answer verbatim.`;
  if(focus)context+=`\n\nOriginal task: ${focus.prompt||''}\nYour previous response: ${focus.answer}\nFeedback: ${focus.feedback?.summary||''}\n${focus.feedback?.explanation||''}\n${array(focus.feedback?.mistakes).map(m=>`${m.original} → ${m.correction}: ${m.why}`).join('\n')}`;
 }
 return {version:1,lessonId:topic.lessonId,round,stage,exerciseId:transferExerciseId(topic.lessonId,round,stage),title:topic.title,level,prompt,context,mode:stage==='speak'?'speaking':'writing'};
}
