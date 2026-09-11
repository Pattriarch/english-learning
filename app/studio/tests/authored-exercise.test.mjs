import test from 'node:test';
import assert from 'node:assert/strict';
import {authoredExerciseID,authoredLessonState,currentAuthoredExercise} from '../authored-exercise.js';
import {progressLesson} from '../core.js';
import {createDailyPlan,dailyPlanProgress} from '../planner-model.js';
import {indicatorProgress} from '../mastery-model.js';
import {transferTopics} from '../transfer-model.js';

const now=new Date('2026-09-11T12:00:00Z');
const lesson={id:'source-mediation',title:'Sources',level:'C1',exercises:[{id:'e1',kind:'write',prompt:'Original question'},{id:'e2',revision:1,kind:'write',prompt:'New question'}]};
const answer=(exerciseId,extra={})=>({id:exerciseId,lessonId:lesson.id,exerciseId,answer:'These sources use the same dataset.',at:'2026-09-11T10:00:00Z',prompt:exerciseId==='e1'?'Original question':'New question',feedback:{verdict:'correct',source:'codex'},...extra});
const stale=[answer('e1'),answer('e2',{prompt:'Previous question'})];
const data=attempts=>({lessons:[lesson],state:{attempts,read:{},drafts:{}}});

test('only an explicit revision changes practice identity; current lookup never strips unknown versions',()=>{
 assert.equal(authoredExerciseID(lesson.exercises[0]),'e1');
 assert.equal(authoredExerciseID(lesson.exercises[1]),'e2--revision-1');
 for(const revision of [-1,1.5,'1',1000001])assert.equal(authoredExerciseID({id:'e2',revision}),null);
 for(const id of ['e2','e2--revision-2','e1--revision-1'])assert.equal(currentAuthoredExercise(lesson,id),null);
 assert.equal(currentAuthoredExercise(lesson,'e2--revision-1'),lesson.exercises[1]);
});

test('navigation, restored feedback and completion exclude obsolete responses without mutating history',()=>{
 const attempts=[...stale,answer('e2--revision-2')],before=JSON.stringify(attempts);
 let state=authoredLessonState(lesson,attempts);
 assert.deepEqual([...state.tried],['e1']);assert.equal(state.latest.get('e2'),undefined);
 assert.deepEqual(progressLesson(lesson,{attempts,read:{}}),{tried:1,correct:1,total:2,read:false,done:false});
 const current=answer('e2--revision-1');state=authoredLessonState(lesson,[...attempts,current]);
 assert.equal(state.latest.get('e2'),current);assert.equal(progressLesson(lesson,{attempts:[...attempts,current],read:{}}).done,true);
 assert.equal(JSON.stringify(attempts),before);
});

test('new daily work targets the current revision while historical saved plans remain snapshots',()=>{
 const d=data(stale),p=createDailyPlan(d,{level:'C1',minutes:120},now),grammar=p.blocks.find(b=>b.skill==='grammar');
 assert.deepEqual(grammar.target.exerciseIds,['e2--revision-1']);
 assert.equal(dailyPlanProgress(p,d.state).blocks.find(b=>b.skill==='grammar').done,false);
 const currentData=data([...stale,answer('e2--revision-1')]);
 assert.equal(dailyPlanProgress(p,currentData.state).blocks.find(b=>b.skill==='grammar').done,true);
 assert.equal(dailyPlanProgress({...p,blocks:[{...grammar,target:{...grammar.target,exerciseIds:['e2']}}]},d.state).blocks[0].done,true);
});

test('revision-aware input planning links to the original task position',()=>{
 const l={...lesson,id:'source-reading',materials:[{id:'source',kind:'reading'}],exercises:lesson.exercises.map(e=>({...e,materialIds:['source']}))};
 const p=createDailyPlan({lessons:[l],state:{attempts:[{...stale[0],lessonId:l.id}]}},{level:'C1',minutes:120},now),reading=p.blocks.find(b=>b.skill==='reading');
 assert.equal(reading.href,'#/lesson/source-reading/1');assert.deepEqual(reading.target.exerciseIds,['e2--revision-1']);
});

test('mastery uses original curriculum references but only current practice revisions',()=>{
 const indicator={domain:'mediation',evidence:[{lessonId:lesson.id,exerciseIds:['e1','e2']}],demonstration:{minAttempts:2}};
 assert.equal(indicatorProgress(indicator,data(stale),now).accepted,1);
 const progress=indicatorProgress(indicator,data([...stale,answer('e2--revision-1')]),now);
 assert.equal(progress.accepted,2);assert.equal(progress.status,'reviewed');
});

test('obsolete authored output alone cannot seed a new transfer cycle',()=>{
 assert.equal(transferTopics(data([stale[1]])).length,0);
 assert.equal(transferTopics(data([answer('e2--revision-1')])).length,1);
 assert.equal(transferTopics(data([stale[0]])).length,1,'unchanged historical work remains useful');
});

test('new correction plans skip obsolete authored revisions without altering historical errors or saved plans',()=>{
 const obsolete=answer('e2',{feedback:{verdict:'partial',source:'codex'},prompt:'Previous question'}),current=answer('e2--revision-1',{feedback:{verdict:'partial',source:'codex'}});
 const d=data([obsolete]),before=JSON.stringify(d),newPlan=createDailyPlan(d,{level:'C1',minutes:120},now);
 assert.notEqual(newPlan.blocks.find(b=>b.id==='review').target.kind,'corrections','current lesson cannot submit the retired bare ID');
 const nextPlan=createDailyPlan(data([obsolete,current]),{level:'C1',minutes:120},now),review=nextPlan.blocks.find(b=>b.id==='review');
 assert.deepEqual(review.target.tasks.map(task=>task.exerciseId),['e2--revision-1']);
 const saved={...nextPlan,blocks:[{...review,target:{...review.target,tasks:[{lessonId:lesson.id,exerciseId:'e2',after:obsolete.at}]}}]};
 assert.equal(dailyPlanProgress(saved,{attempts:[obsolete,answer('e2--revision-1',{at:'2026-09-11T11:00:00Z'})]}).blocks[0].automatic,false,'a different revision cannot retroactively complete the original saved question');
 assert.equal(JSON.stringify(d),before,'history is retained');
 const legacy={...lesson,exercises:lesson.exercises.map(ex=>({...ex,revision:0}))};
 assert.deepEqual(createDailyPlan({...d,lessons:[legacy]},{level:'C1',minutes:120},now).blocks.find(b=>b.id==='review').target.tasks.map(task=>task.exerciseId),['e2']);
});
