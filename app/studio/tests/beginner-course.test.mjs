import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDailyPlan,dailyPlanProgress} from '../planner-model.js';
import {validDailyPlan,plannerJSON} from '../planner.js';
import {lessonSequence} from '../lesson-sequence.js';
import {authoredExerciseID} from '../authored-exercise.js';
import {indicatorProgress} from '../mastery-model.js';
import {transferTopics,transferTask} from '../transfer-model.js';
import {studyUI} from './study-ui-fixture.mjs';
import {dateKey} from '../core.js';

const read=name=>JSON.parse(readFileSync(new URL('../../content/'+name,import.meta.url),'utf8'));
const lessons=read('courses/foundation.json'),learningPath=read('learning-path.json'),beginner=lessons.filter(l=>l.beginner);
const now=new Date('2026-09-20T12:00:00'),at=new Date('2026-09-20T10:00:00').toISOString();
const data=()=>({lessons,learningPath,settings:{},state:{attempts:[],cards:[],reviews:[],drafts:{},read:{}}});
const attempt=(lesson,ex,overrides={})=>({id:lesson.id+ex.id,lessonId:lesson.id,exerciseId:authoredExerciseID(ex),prompt:ex.prompt,answer:ex.answers[0],at,feedback:{verdict:'correct',source:'codex'},...overrides});

test('the beginner route teaches the first tiny answer before asking for it; all 30 units are gradual',()=>{
 assert.equal(beginner.length,30);assert.equal(beginner.reduce((n,l)=>n+l.exercises.length,0),244);
 const sequence=lessonSequence(lessons,learningPath).filter(r=>r.lesson.beginner).map(r=>r.lesson);
 assert.deepEqual(sequence.slice(0,4).map(l=>l.id),['path-be','path-articles-basic','path-plurals','path-present-simple']);
 for(const [i,l] of sequence.entries()){
  assert.deepEqual(l.prerequisites,i?[sequence[i-1].id]:[]);
  assert.ok(l.exercises.slice(0,-2).every(e=>e.practiceStage==='guided'));
  assert.ok(l.exercises.slice(-2).every(e=>e.practiceStage==='independent'&&!e.guidance));
  for(const e of l.exercises){
   assert.ok(e.revision>=1,l.id+e.id);
   if(e.guidance){for(const k of ['title','body','example','translation'])assert.ok(e.guidance[k]?.trim(),l.id+e.id+k);assert.ok(e.guidance.body.split(/\s+/).length<=90,l.id+e.id);}
  }
 }
 const first=sequence[0].exercises[0];assert.equal(first.answers[0],'I am tired.');assert.equal(first.guidance.example,'I am ready.');assert.match(first.prompt,/tired = устал/);assert.match(first.guidance.body,/По-русски/);
 const map=read('curriculum-mastery-map.json');for(const level of map.levels)for(const item of level.indicators)for(const e of item.evidence){const l=beginner.find(l=>l.id===e.lessonId);if(l)for(const id of e.exerciseIds)assert.equal(l.exercises.find(e=>e.id===id)?.practiceStage,'independent');}
});

test('beginner plans follow prerequisites for all budgets without generic essays or advanced projects',()=>{
 for(const level of ['A1','A2'])for(const minutes of [30,60,90,120,180])for(const reviews of [false,true]){
  const d=data();if(reviews)d.state.cards=[{id:'due',due:new Date('2026-09-19').toISOString()}];
  const plan=createDailyPlan(d,{level,minutes,domain:'work'},now);
  assert.equal(plan.beginner,true);assert.equal(plan.blocks.reduce((n,b)=>n+b.minutes,0),minutes);
  assert.equal(validDailyPlan(JSON.parse(plannerJSON(plan)),dateKey(now)),true);
  const study=plan.blocks.filter(b=>b.id!=='review');
  assert.equal(study[0].href,`#/lesson/${level==='A1'?'path-be':'path-past-simple'}/0`);
  for(const b of study){assert.equal(b.target.kind,'attempts');assert.equal(b.target.exactExerciseIds,true);assert.ok(b.target.count>=8);assert.equal(b.practiceTask,undefined);}
 }
});

test('saved old revisions and unsuccessful answers cannot silently skip beginner steps',()=>{
 const d=data(),l=beginner.find(l=>l.id==='path-be');
 d.state.attempts=l.exercises.map(e=>attempt(l,e,{exerciseId:e.id}));
 assert.equal(createDailyPlan(d,{level:'A1',minutes:30},now).blocks[0].href,'#/lesson/path-be/0');
 d.state.attempts=l.exercises.map(e=>attempt(l,e));
 assert.match(createDailyPlan(d,{level:'A1',minutes:30},now).blocks[0].href,/path-articles-basic/);
 d.state.attempts.push(attempt(l,l.exercises[2],{id:'retry',at:new Date('2026-09-20T11:00:00').toISOString(),feedback:{verdict:'partial'}}));
 d.state.attempts.push(attempt(l,l.exercises[2],{id:'bad-date',at:'invalid'}));
 const plan=createDailyPlan(d,{level:'A1',minutes:30},now);
 assert.equal(plan.blocks[0].href,'#/lesson/path-be/2');assert.deepEqual(plan.blocks[0].target.exerciseIds,[authoredExerciseID(l.exercises[2])]);
 const empty={...d.state,attempts:[]};assert.equal(dailyPlanProgress(plan,empty).blocks[0].current,0);
});

test('following a visible model is not independent mastery or a transfer prerequisite',()=>{
 const d=data(),l=beginner.find(l=>l.id==='path-be'),guided=l.exercises.find(e=>e.practiceStage==='guided');
 d.state.attempts=[attempt(l,guided,{answer:'I am very tired today.'})];
 const indicator={evidence:[{lessonId:l.id,exerciseIds:l.exercises.map(e=>e.id)}]};
 assert.equal(indicatorProgress(indicator,d,now).answers,0);assert.deepEqual(transferTopics(d),[]);
 d.state.attempts.push(attempt(l,l.exercises.at(-1)));
 assert.equal(indicatorProgress(indicator,d,now).answers,1);assert.equal(transferTopics(d).length,1);
 for(const stage of ['recall','write','speak']){const task=transferTask(transferTopics(d)[0],0,stage,d.state);assert.doesNotMatch(task.prompt,/80–120|60–90|140–190|workplace|argument/);}
});

test('replacing a legacy beginner daily plan archives it first and survives an archive failure',async t=>{
 const d=data(),today=dateKey(),plan={version:1,day:today,createdAt:new Date().toISOString(),level:'A1',minutes:30,domain:'everyday',blocks:[{id:'legacy-writing',skill:'writing',title:'Old long essay',instruction:'Write a paragraph',why:'Old task',minutes:30,href:'#/roadmap',target:{kind:'manual',count:1}}]};
 d.state.drafts['planner:day:'+today]={text:JSON.stringify(plan)};
 const f=await studyUI(t,'planner.js',{'book-reader':{loadBookStatus:async()=>({units:{}}),bookExerciseID:async ex=>ex.id}});
 location.hash='#/today';const events=new EventTarget(),writes=[];
 for(const name of ['addEventListener','removeEventListener','dispatchEvent'])window[name]=events[name].bind(events);
 f.api=async()=>({projects:[]});let fail=true;
 f.saveDraftConfirmed=async(key,text)=>{writes.push(key);if(fail)throw Error('Не удалось сохранить архив');const draft={text,at:new Date().toISOString()};d.state.drafts[key]=draft;return draft;};
 try{
  await f.module.mountDailyPlanner(f.root,d,async()=>d);
  await f.root.querySelector('#beginner-plan-refresh').click();assert.deepEqual(JSON.parse(d.state.drafts['planner:day:'+today].text),plan);assert.equal(writes.length,1);
  fail=false;writes.length=0;await f.root.querySelector('#beginner-plan-refresh').click();
  assert.equal(writes.length,2);assert.match(writes[0],/^planner:archive:/);assert.equal(writes[1],'planner:day:'+today);
  assert.deepEqual(JSON.parse(d.state.drafts[writes[0]].text),plan);assert.equal(JSON.parse(d.state.drafts[writes[1]].text).beginner,true);assert.equal(f.root.querySelector('#beginner-plan-refresh'),null);
 }finally{events.dispatchEvent(new Event('hashchange'));}
});
