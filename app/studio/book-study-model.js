export const bookStudyStageIDs=['diagnostic','input','practice','production','revision','transfer'];
const text=value=>typeof value==='string'&&!!value.trim();
const sameIDs=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((id,i)=>id===b[i]);

export function validBookStudyPlan(plan,exercises){
 if(!plan||!Array.isArray(plan.stages)||plan.stages.length!==6||!Array.isArray(exercises))return false;
 const byID=new Map(exercises.map(ex=>[ex.id,ex])),seen=new Set();
 if(byID.size!==exercises.length)return false;
 for(const [i,stage]of plan.stages.entries()){
  if(stage?.id!==bookStudyStageIDs[i]||!text(stage.title)||!text(stage.purpose)||!Number.isInteger(stage.minutes)||stage.minutes<1||stage.minutes>180||!Array.isArray(stage.exerciseIds)||!stage.exerciseIds.length||stage.exerciseIds.length>30)return false;
  for(const id of stage.exerciseIds){
   if(!byID.has(id)||seen.has(id))return false;seen.add(id);
   const kind=byID.get(id).kind;
   if(stage.id==='revision'&&!['rewrite','write'].includes(kind)||stage.id==='transfer'&&!['write','speak'].includes(kind))return false;
  }
  if(stage.id==='production'&&!['write','speak'].every(kind=>stage.exerciseIds.some(id=>byID.get(id).kind===kind)))return false;
 }
 return seen.size===exercises.length&&sameIDs(plan.revisionExerciseIds,plan.stages[4].exerciseIds)&&sameIDs(plan.transfer?.exerciseIds,plan.stages[5].exerciseIds)&&Number.isInteger(plan.transfer?.delayDays)&&plan.transfer.delayDays>=7&&plan.transfer.delayDays<=60;
}

export function remapBookStudyPlan(plan,originalExercises,exercises){
 if(!plan)return null;
 if(!Array.isArray(originalExercises)||!Array.isArray(exercises)||originalExercises.length!==exercises.length)return null;
 const ids=new Map();
 for(const [i,ex]of originalExercises.entries()){
  const next=exercises[i]?.id;if(!text(ex.id)||!text(next))return null;
  for(const id of [ex.id,ex.id.replace(/--[a-f0-9]{16}$/,''),next]){
   if(ids.has(id)&&ids.get(id)!==next)return null;ids.set(id,next);
  }
 }
 const map=values=>Array.isArray(values)?values.map(id=>ids.get(id)):null;
 const mapped={...plan,stages:Array.isArray(plan.stages)?plan.stages.map(stage=>({...stage,exerciseIds:map(stage.exerciseIds)})):null,revisionExerciseIds:map(plan.revisionExerciseIds),transfer:{...plan.transfer,exerciseIds:map(plan.transfer?.exerciseIds)}};
 return validBookStudyPlan(mapped,exercises)?mapped:null;
}

export function bookStudyTimestamp(value,now=Date.now()){
 const match=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);if(!match)return null;
 const [,year,month,day,hour,minute,second]=match.map(Number);
 if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)return null;
 const at=Date.parse(value);return Number.isFinite(at)&&Number.isFinite(now)&&at<=now?at:null;
}
export const meaningfulBookAnswer=answer=>typeof answer==='string'&&(answer.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)||[]).length>=3;
const reviewed=attempt=>attempt?.feedback?.verdict==='correct'&&['codex','claude','ollama','compatible'].includes(attempt.feedback.source);

export function bookStudyProgress(lesson,state,now=Date.now()){
 const plan=lesson.studyPlan;if(!validBookStudyPlan(plan,lesson.exercises))return null;
 const byID=new Map(lesson.exercises.map(ex=>[ex.id,ex])),attemptByID={},timeByID={};
 for(const attempt of state.attempts||[]){
  let id=attempt.exerciseId;
  if(attempt.lessonId==='free'&&typeof id==='string'&&id.startsWith(lesson.id+'-'))id=id.slice(lesson.id.length+1);
  else if(attempt.lessonId!==lesson.id)continue;
  const at=bookStudyTimestamp(attempt.at??attempt.createdAt,now);
  if(!byID.has(id)||at===null||at<(timeByID[id]??-Infinity))continue;
  attemptByID[id]=attempt;timeByID[id]=at;
 }
 const submitted=id=>meaningfulBookAnswer(attemptByID[id]?.answer)&&(byID.get(id).kind!=='speak'||attemptByID[id].mode==='speaking');
 const production=plan.stages[3],produced=production.exerciseIds.every(submitted);
 const productionAt=produced?Math.max(...production.exerciseIds.map(id=>timeByID[id])):null;
 const revised=id=>produced&&submitted(id)&&reviewed(attemptByID[id])&&timeByID[id]>productionAt;
 const revisionComplete=plan.revisionExerciseIds.every(revised);
 const revisedAt=revisionComplete?Math.max(...plan.revisionExerciseIds.map(id=>timeByID[id])):null;
 const dueAt=revisedAt===null?null:revisedAt+plan.transfer.delayDays*86400000;
 const transferReady=dueAt!==null&&now>=dueAt;
 const accepted=id=>plan.revisionExerciseIds.includes(id)?revised(id):plan.transfer.exerciseIds.includes(id)?transferReady&&submitted(id)&&reviewed(attemptByID[id])&&timeByID[id]>=dueAt:submitted(id);
 const stages=plan.stages.map(stage=>({...stage,completed:stage.exerciseIds.filter(accepted).length,total:stage.exerciseIds.length,complete:stage.exerciseIds.every(accepted),locked:stage.id==='transfer'&&!transferReady}));
 const nextStage=stages.find(stage=>!stage.complete);
 return{stages,attemptByID,timeByID,acceptedExerciseIds:lesson.exercises.filter(ex=>accepted(ex.id)).map(ex=>ex.id),productionAttempts:production.exerciseIds.map(id=>({exercise:byID.get(id),attempt:attemptByID[id]||null,submitted:submitted(id)})),produced,productionAt,revisionComplete,revisedAt,dueAt,transferReady,complete:stages.every(stage=>stage.complete),completed:stages.reduce((n,stage)=>n+stage.completed,0),total:lesson.exercises.length,nextExerciseId:nextStage?.exerciseIds.find(id=>!accepted(id))||null};
}
