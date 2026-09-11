import {authoredExerciseID} from './authored-exercise.js';
import {coursebookQueue,coursebookPlanTarget} from './planner-coursebooks.js';
import {validBookStudyPlan} from './book-study-model.js';

const items=value=>Array.isArray(value)?value:[];
const baseBook=id=>String(id||'').replace(/--[a-f0-9]{16}$/,'');
const baseAuthored=id=>String(id||'').replace(/--revision-\d+$/,'');
const bookAliases=data=>new Map(items(data.library?.books).flatMap(book=>items(book.units).map(unit=>['book-'+unit.id,'book-'+(unit.equivalentUnitId||unit.id)])));
function studyIdentity(lesson){
 if(!validBookStudyPlan(lesson?.studyPlan,lesson?.exercises))return null;
 return JSON.stringify({id:lesson.id,exercises:lesson.exercises.map(ex=>[ex.id,ex.kind]),stages:lesson.studyPlan.stages.map(stage=>[stage.id,stage.exerciseIds]),revision:lesson.studyPlan.revisionExerciseIds,transfer:[lesson.studyPlan.transfer.exerciseIds,lesson.studyPlan.transfer.delayDays]});
}
function bookStudyChange(block,data,now){
 const saved=block.target.study,id=bookAliases(data).get(block.target.lessonId)||block.target.lessonId,lesson=items(data.bookLessons).find(lesson=>lesson.id===id);
 if(!lesson||!studyIdentity(saved)||!studyIdentity(lesson)||studyIdentity(saved)===studyIdentity(lesson))return null;
 const queue=coursebookQueue({...data,bookLessons:[lesson]},now,1),record=queue.due[0]||queue.ready[0],href='#/unit/'+id.slice(5);
 if(record)return{blockId:block.id,bookStudy:true,status:'ready',href,message:'Глава обновилась. Обнови этот блок, чтобы продолжить с доступного этапа «'+record.stage.title+'».',replacement:{
  href:record.href,target:coursebookPlanTarget(record),skill:record.skill,title:'Практика по главе: '+lesson.title+' · '+record.stage.title,
  instruction:record.stage.purpose+' Выполни один следующий ответ по текущему материалу. '+(record.exercise.kind==='speak'?'Ответь через микрофон; печатная репетиция не завершает устную практику.':'Напиши собственный полный ответ и отправь на разбор.'),
  why:'Глава обновилась. Следующий этап выбран по твоим ответам на текущие задания; прежние версии остаются в истории.'}};
 const waiting=queue.waiting[0],dueAt=waiting?.progress.dueAt;
 return{blockId:block.id,bookStudy:true,status:waiting?'waiting':'unavailable',href,dueAt:dueAt??null,
  message:waiting&&Number.isFinite(dueAt)?'Глава обновилась. Следующее применение будет доступно с '+new Date(dueAt).toLocaleDateString('ru-RU')+'. Сегодня выполнять его рано.':queue.complete.length?'Все этапы текущей главы уже пройдены. Нового задания для замены этого прежнего блока нет; его история сохранена.':'Текущий этап главы пока недоступен. Открой главу, чтобы проверить состояние; прежний блок не засчитывается автоматически.'};
}

export const actionablePlanChange=change=>!change.bookStudy||change.status==='ready';

// Resolve navigation to the current task; this never migrates answer evidence.
function resolver(data){
 const aliases=bookAliases(data);
 const authored=new Map(items(data.lessons).map(lesson=>[lesson.id,lesson]));
 const books=new Map(items(data.bookLessons).map(lesson=>[lesson.id,lesson]));
 return task=>{
  const lessonId=aliases.get(task.lessonId)||task.lessonId,book=books.get(lessonId),lesson=authored.get(lessonId);
  if(book){const matches=items(book.exercises).filter(ex=>baseBook(ex.id)===baseBook(task.exerciseId));return matches.length===1?{lessonId,exerciseId:matches[0].id}:null;}
  if(lesson){const matches=items(lesson.exercises).filter(ex=>ex.id===baseAuthored(task.exerciseId));return matches.length===1?{lessonId,exerciseId:authoredExerciseID(matches[0])}:null;}
  return null; // A failed/omitted fetch is not evidence that the task changed.
 };
}

export function changedPlanBlocks(plan,data,doneIds=[],now=new Date()){
 const resolve=resolver(data),done=new Set(doneIds),changes=[];
 for(const block of items(plan?.blocks)){
  if(done.has(block.id))continue;
  const target=block.target||{},correction=target.kind==='corrections';
  if(target.kind==='book-study'){const change=bookStudyChange(block,data,now);if(change)changes.push(change);continue;}
  const tasks=correction?items(target.tasks):target.kind==='attempts'&&items(target.lessonIds).length===1?items(target.exerciseIds).map(exerciseId=>({lessonId:target.lessonIds[0],exerciseId})):[];
  if(!tasks.length)continue;
  const current=tasks.map(resolve);
  if(current.some(task=>!task?.exerciseId)||!tasks.some((task,i)=>task.lessonId!==current[i].lessonId||task.exerciseId!==current[i].exerciseId))continue;
  changes.push({blockId:block.id,correction,tasks,current});
 }
 return changes;
}

export function reviseChangedPlan(plan,changes,at,previousPlanKey){
 changes=changes.filter(actionablePlanChange);
 if(!Number.isFinite(Date.parse(at))||!changes.length)return plan;
 const byId=new Map(changes.map(change=>[change.blockId,change]));
 return {...plan,revisedAt:at,previousPlanKey,blocks:plan.blocks.map(block=>{
  const change=byId.get(block.id);if(!change)return block;
  if(change.bookStudy)return{...block,...change.replacement};
  const target=change.correction?{...block.target,exactExerciseIds:true,tasks:change.current.map((task,i)=>({...task,after:task.exerciseId===change.tasks[i].exerciseId&&task.lessonId===change.tasks[i].lessonId?change.tasks[i].after:at})),lessonIds:[...new Set(change.current.map(task=>task.lessonId))]}:{...block.target,exactExerciseIds:true,exerciseIds:change.current.map(task=>task.exerciseId),lessonIds:[...new Set(change.current.map(task=>task.lessonId))]};
  const lessonId=change.current[0].lessonId,href=lessonId.startsWith('book-')?'#/unit/'+lessonId.slice(5):'#/lesson/'+lessonId;
  return {...block,href,target,instruction:'Задание в уроке обновилось. Выполни текущую формулировку и отправь свой ответ на проверку. Прежний ответ и его разбор сохранены в «Моих работах».',why:'Этот блок обновлён, чтобы сегодняшнее задание можно было завершить. Прежняя попытка не засчитывается за новую формулировку.'};
 })};
}
