import {authoredExerciseID} from './authored-exercise.js';
import {lessonSequence} from './lesson-sequence.js';

// Practice completion is not a CEFR or mastery claim. Old revisions and failed
// answers do not move a beginner past a construction they have not practiced.
export function beginnerPlan(data,{level,minutes,domain},now){
 if(!['A1','A2'].includes(level))return null;
 const lessons=lessonSequence(data.lessons,data.learningPath).filter(r=>r.level===level&&r.lesson.beginner).map(r=>r.lesson);
 const latest=new Map();for(const a of data.state?.attempts||[]){const at=Date.parse(a.at);if(!Number.isFinite(at)||at>now.getTime())continue;const key=a.lessonId+':'+a.exerciseId,previous=latest.get(key);if(!previous||at>=Date.parse(previous.at))latest.set(key,a);}
 const pending=lesson=>lesson.exercises.filter(e=>{const a=latest.get(lesson.id+':'+authoredExerciseID(e));return !a?.answer?.trim()||['partial','incorrect'].includes(a.feedback?.verdict);});
 const remaining=lessons.filter(l=>pending(l).length);if(!remaining.length)return null;
 const day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const selected=remaining.slice(0,Math.max(1,Math.floor(minutes/30)));
 const due=(data.state?.cards||[]).filter(c=>c.id&&Date.parse(c.due)<=now.getTime()).slice(0,10);
 const reviewMinutes=due.length?5:0,lessonBudget=minutes-reviewMinutes;
 const blocks=selected.map((lesson,i)=>{const tasks=pending(lesson),index=lesson.exercises.indexOf(tasks[0]);return{
  id:'beginner-'+lesson.id,skill:lesson.id==='path-sound-basics'?'pronunciation':lesson.id==='path-listening-routine'?'listening':'grammar',
  title:lesson.title,minutes:Math.floor(lessonBudget/selected.length/5)*5+(i===0?lessonBudget% (selected.length*5):0),
  href:'#/lesson/'+lesson.id+'/'+index,
  instruction:'Иди по шагам: короткое объяснение → послушай образец → напиши или надиктуй одну фразу. В конце попробуй два задания без опоры. К следующей теме переходи после этой.',
  why:'Новые формы объясняются до задания. Сначала тренируем одну конструкцию, затем применяем её самостоятельно. Время — ориентир, а не требование сидеть до конца таймера.',
  target:{kind:'attempts',exactExerciseIds:true,lessonIds:[lesson.id],exerciseIds:tasks.map(authoredExerciseID),count:tasks.length}
 };});
 if(due.length)blocks.unshift({id:'review',skill:'review',title:'Повторить знакомые карточки',minutes:reviewMinutes,href:'#/review',instruction:'Вспомни фразы, которые ты уже сохранил. Новые слова сегодня появятся внутри уроков.',why:'Повторяем знакомое после паузы.',target:{kind:'reviews',cardIds:due.map(c=>c.id),count:due.length}});
 return{version:1,beginner:true,day,createdAt:now.toISOString(),level,minutes,domain,blocks};
}
