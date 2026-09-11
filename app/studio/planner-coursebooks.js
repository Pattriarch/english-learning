import {bookStudyProgress,bookStudyTimestamp,validBookStudyPlan} from './book-study-model.js';

const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value);
const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const isPlannerCoursebook=id=>/^(clear-speech|great-writing|viewpoint)-/.test(id||'');
export function hasStructuredBookStudy(data,lessonId){
 if(typeof lessonId!=='string'||!lessonId.startsWith('book-'))return false;
 const loaded=(Array.isArray(data.bookLessons)?data.bookLessons:[]).find(lesson=>lesson?.id===lessonId);
 if(loaded?.studyPlan)return validBookStudyPlan(loaded.studyPlan,loaded.exercises);
 // These registered coursebook families use the six-stage publication contract.
 // This also works in bootstrap-only views before the bounded chapter fetch.
 return (data.library?.books||[]).some(book=>isPlannerCoursebook(book.id)&&(book.units||[]).some(unit=>'book-'+(unit.equivalentUnitId||unit.id)===lessonId));
}
export function coursebookExerciseSkill(lesson,exercise,stage){
 const materials=(lesson.materials||[]).filter(m=>exercise.materialIds?.includes(m.id));
 if(['production','revision','transfer'].includes(stage))return exercise.kind==='speak'?'speaking':'writing';
 if(materials.some(m=>m.inputSkill==='listening'||['listening','dialogue'].includes(m.kind)))return 'listening';
 if(materials.some(m=>m.kind==='reading'))return 'reading';
 if(/^book-clear-speech-/.test(lesson.id))return 'pronunciation';
 if(exercise.kind==='speak')return 'speaking';
 return 'writing';
}
export function coursebookQueue(data,now=new Date(),limit=6){
 const date=new Date(now),time=date.getTime(),due=[],ready=[],waiting=[],complete=[];
 if(!Number.isFinite(time))return{due,ready,waiting,complete};
 for(const lesson of Array.isArray(data.bookLessons)?data.bookLessons:[]){
  const unitId=lesson?.id?.slice(5);
  if(!safe(unitId)||!lesson.id.startsWith('book-')||data.bookStatus?.units?.[unitId]?.status!=='ready')continue;
  const progress=bookStudyProgress(lesson,data.state||{},time);if(!progress)continue;
  if(progress.complete){complete.push({lesson,progress});continue;}
  const stage=progress.transferReady&&!progress.stages[5].complete?progress.stages[5]:progress.stages.find(stage=>!stage.complete),nextID=stage.exerciseIds.find(id=>!progress.acceptedExerciseIds.includes(id)),exercise=lesson.exercises.find(ex=>ex.id===nextID);if(!exercise)continue;
  const record={lesson,progress,stage,exercise,unitId,href:`#/unit/${unitId}/${exercise.id}`,skill:coursebookExerciseSkill(lesson,exercise,stage.id),started:Object.keys(progress.attemptByID).length>0,last:Math.max(0,...Object.values(progress.timeByID))};
  if(stage.id==='transfer'){
   if(progress.transferReady)due.push(record);else waiting.push(record);
  }else ready.push(record);
 }
 due.sort((a,b)=>a.progress.dueAt-b.progress.dueAt||a.lesson.id.localeCompare(b.lesson.id));
 ready.sort((a,b)=>Number(b.started)-Number(a.started)||b.last-a.last||a.lesson.id.localeCompare(b.lesson.id));
 waiting.sort((a,b)=>(a.progress.dueAt??Infinity)-(b.progress.dueAt??Infinity)||a.lesson.id.localeCompare(b.lesson.id));
 return{due:due.slice(0,limit),ready:ready.slice(0,limit),waiting:waiting.slice(0,limit),complete};
}
export function coursebookPlanTarget(record){
 const lesson=record.lesson;
 return{kind:'book-study',count:1,lessonId:lesson.id,exerciseIds:[record.exercise.id],stage:record.stage.id,
  study:{id:lesson.id,exercises:lesson.exercises.map(ex=>({id:ex.id,kind:ex.kind})),studyPlan:{stages:lesson.studyPlan.stages.map(stage=>({id:stage.id,title:stage.title.slice(0,80),purpose:stage.purpose.slice(0,160),minutes:stage.minutes,exerciseIds:[...stage.exerciseIds]})),revisionExerciseIds:[...lesson.studyPlan.revisionExerciseIds],transfer:{exerciseIds:[...lesson.studyPlan.transfer.exerciseIds],delayDays:lesson.studyPlan.transfer.delayDays}}}};
}
export function coursebookTargetEvidence(spec,state,day,now=Date.now()){
 if(spec?.kind!=='book-study'||!spec.study||spec.lessonId!==spec.study.id||!validBookStudyPlan(spec.study.studyPlan,spec.study.exercises)||!Array.isArray(spec.exerciseIds)||spec.exerciseIds.length!==1||!/^\d{4}-\d{2}-\d{2}$/.test(day))return 0;
 const end=new Date(day+'T00:00:00');if(!Number.isFinite(now)||!Number.isFinite(end.getTime())||dayKey(end)!==day)return 0;end.setDate(end.getDate()+1);
 const cutoff=Math.min(now,end.getTime()-1),progress=bookStudyProgress(spec.study,state,cutoff);
 const stage=progress.stages.find(stage=>stage.id===spec.stage);
 const id=spec.exerciseIds[0],attempt=progress.attemptByID[id],at=bookStudyTimestamp(attempt?.at??attempt?.createdAt,cutoff);
 return stage?.exerciseIds.includes(id)&&progress.acceptedExerciseIds.includes(id)&&at!==null&&dayKey(new Date(at))===day?1:0;
}
