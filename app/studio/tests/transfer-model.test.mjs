import test from 'node:test';
import assert from 'node:assert/strict';
import {transferTopics,transferQueue,transferProgress,transferSnapshot,transferIdentity,transferExerciseId,transferReviewKey,transferTask,transferTargetEvidence} from '../transfer-model.js';
import {createDailyPlan,dailyPlanProgress} from '../planner-model.js';

process.env.TZ='America/New_York';
const now=new Date(2026,8,10,12),at=(d=10,h=9)=>new Date(2026,8,d,Math.floor(h),(h%1)*60).toISOString();
const lesson={id:'topic-one',title:'Meaningful contrast',level:'B2',goal:'Make your intended meaning clear.',formula:'A contrast with a purpose.',exercises:[{id:'e1',kind:'write'},{id:'gap',kind:'fill'}]};
const seed={id:'seed',lessonId:lesson.id,exerciseId:'e1',at:at(),answer:'I would like to explain my own example.',mode:'writing',feedback:{verdict:'correct'}};
const data=()=>({lessons:[lesson],state:{attempts:[seed],drafts:{},read:{},activity:{}},settings:{}});
const topic=()=>transferTopics(data())[0];
let serial=0;
const answer=(round,stage,d=10,h=10,verdict='correct',overrides={})=>({id:'a'+(++serial),lessonId:'free',exerciseId:transferExerciseId(lesson.id,round,stage),prompt:'A captured original task.',answer:`Here is my own ${stage} response number ${serial}, with a meaningful choice.`,at:at(d,h),mode:stage==='speak'?'speaking':'writing',feedback:{verdict},...overrides});
const initial=(verdict='correct')=>['recall','write','speak'].map((s,i)=>answer(0,s,10,10+i/4,verdict));

test('read, time, fragments and legacy fill-ins do not seed a topic',()=>{
 const d=data();d.state.read[lesson.id]=at();d.state.activity['2026-09-10']=7200;d.state.attempts=[];
 assert.equal(transferTopics(d).length,0);
 d.state.attempts=[{...seed,answer:'yes'},{...seed,exerciseId:'gap'}];assert.equal(transferTopics(d).length,0);
 d.state.attempts.push(seed);assert.equal(transferTopics(d).length,1);
});
test('ordinary and canonical/legacy book responses share stable topic identities',()=>{
 const d=data();d.library={books:[{id:'grammar-intermediate',level:'B1–B2',units:[{id:'grammar-intermediate-001',title:'Present continuous'}]},{id:'duplicate',duplicateOf:'grammar-intermediate',units:[{id:'grammar-intermediate-ebook-001',equivalentUnitId:'grammar-intermediate-001'}]}]};
 d.state.attempts.push({...seed,id:'b1',lessonId:'free',exerciseId:'book-grammar-intermediate-ebook-001-e1--0123456789abcdef'},{...seed,id:'b2',lessonId:'book-grammar-intermediate-001',exerciseId:'e2--fedcba9876543210'});
 assert.deepEqual(transferTopics(d).map(t=>t.lessonId).sort(),['book-grammar-intermediate-001','topic-one']);
 assert.deepEqual(transferIdentity(answer(2,'write')),{lessonId:lesson.id,round:2,stage:'write'});
 assert.equal(transferIdentity({...seed,exerciseId:'notebook-note'}),null);
});
test('a cycle needs retrieval, an original message and actual voice evidence',()=>{
 const state={attempts:[seed,answer(0,'recall'),answer(0,'write'),answer(0,'speak',10,11,'correct',{mode:'writing'})],drafts:{}};
 let p=transferProgress(topic(),state,now);assert.equal(p.next,'speak');assert.equal(p.completedRounds,0);
 state.attempts.push(answer(0,'speak',10,11.5));p=transferProgress(topic(),state,now);
 assert.equal(p.completedRounds,1);assert.equal(p.dueDay,'2026-09-11');assert.equal(p.due,false);
});
test('negative feedback requires a different full revision and never implies mastery',()=>{
 const attempts=initial('partial'),state={attempts:[seed,...attempts],drafts:{}};
 assert.equal(transferProgress(topic(),state,now).next,'revise');
 state.attempts.push(answer(0,'revise',10,11,'correct',{answer:attempts[2].answer}));
 assert.equal(transferProgress(topic(),state,now).completedRounds,0);
 state.attempts.push(answer(0,'revise',10,11.5,'partial'));
 const p=transferProgress(topic(),state,now);assert.equal(p.completedRounds,1);assert.equal(p.history[0].needsWork,true);assert.equal(p.history[0].interval,1);assert.equal('mastered' in p,false);
});
test('an explicit ungraded self-check is separate evidence tied to exact submitted versions',()=>{
 const attempts=initial('ungraded'),state={attempts:[seed,...attempts],drafts:{}};
 assert.equal(transferProgress(topic(),state,now).next,'revise');
 const review={version:1,kind:'self-check',checked:true,at:at(10,11),note:'I checked the intended meaning and examples.',attemptIds:attempts.map(a=>a.id)};
 state.drafts[transferReviewKey(lesson.id,0)]={text:JSON.stringify(review)};
 let p=transferProgress(topic(),state,now);assert.equal(p.completedRounds,1);assert.equal(p.history[0].selfChecked,true);assert.equal(p.history[0].ungraded,true);
 state.attempts.push(answer(0,'speak',10,11.5,'ungraded'));assert.equal(transferProgress(topic(),state,now).completedRounds,0,'a late self-check cannot certify a newer response');
 attempts[1].feedback.verdict='incorrect';assert.equal(transferProgress(topic(),state,now).next,'revise');
});
test('late completion reschedules from actual work without accumulating missed rounds',()=>{
 const state={attempts:[seed,...initial()],drafts:{}};
 let p=transferProgress(topic(),state,new Date(2026,10,1,12));assert.equal(p.round,1);assert.equal(p.next,'recall');assert.equal(p.completedRounds,1);
 state.attempts.push(answer(1,'recall',40,10),answer(1,'speak',40,11));
 p=transferProgress(topic(),state,new Date(2026,10,1,12));assert.equal(p.round,2);assert.equal(p.dueDay,'2026-10-13');assert.equal(p.history[1].interval,3);
});
test('future work and stages submitted before their prerequisites do not advance',()=>{
 const state={attempts:[seed,answer(0,'speak',10,8),answer(0,'write',10,8.5),answer(0,'recall',10,10),answer(0,'write',11,10)],drafts:{}};
 const p=transferProgress(topic(),state,now);assert.equal(p.next,'write');assert.equal(p.completedRounds,0);
});
test('saved meaning stays frozen after source edits',()=>{
 const d=data(),snapshot=transferSnapshot(topic(),lesson,now);d.state.drafts['transfer:topic:'+lesson.id]={text:JSON.stringify(snapshot)};
 d.lessons=[{...lesson,title:'A changed title',formula:'A new rule'}];
 const t=transferTopics(d)[0];assert.equal(t.title,lesson.title);assert.equal(t.snapshot.context,snapshot.context);
});
test('queue caps attention rather than multiplying overdue occurrences',()=>{
 const d=data();for(let i=0;i<8;i++){d.lessons.push({...lesson,id:'extra-'+i});d.state.attempts.push({...seed,id:'seed-'+i,lessonId:'extra-'+i});}
 const q=transferQueue(d,new Date(2027,1,1),{limit:2});assert.equal(q.due.length,2);assert.equal(q.dueCount,9);assert.ok(q.topics.every(t=>t.round===0));
});
test('new planner budgets one concrete step and keeps old snapshots unchanged',()=>{
 for(const minutes of [30,60,90,120,180]){
  const p=createDailyPlan(data(),{minutes},now),block=p.blocks.find(b=>b.id==='transfer');assert.ok(block);assert.ok(block.minutes<=15);assert.equal(p.blocks.reduce((n,b)=>n+b.minutes,0),minutes);
  const saved=JSON.stringify(p),state={...data().state,attempts:[seed,answer(0,'recall',10,10)]};
  assert.equal(dailyPlanProgress(p,state).blocks.find(b=>b.id==='transfer').current,1);assert.equal(JSON.stringify(p),saved);
  assert.equal(dailyPlanProgress(p,data().state,{'transfer':true}).blocks.find(b=>b.id==='transfer').current,0);
 }
});
test('planned transfer progress requires the captured stage on the plan date',()=>{
 const spec={lessonId:lesson.id,anchorAt:seed.at,round:0,stage:'speak'},state={attempts:[seed,...initial()],drafts:{}};
 assert.equal(transferTargetEvidence(spec,state,'2026-09-10'),1);assert.equal(transferTargetEvidence(spec,state,'2026-09-11'),0);
});
test('new prompts supply original tasks, American default, and an explicit speech boundary',()=>{
 const t=transferSnapshot(topic(),lesson,now);
 for(const stage of ['write','speak','revise'])assert.match(transferTask(t,0,stage).prompt,/American English/);
 assert.match(transferTask(t,0,'speak').prompt,/different situation/);assert.match(transferTask(t,0,'speak').prompt,/cannot establish pronunciation/);
 assert.notEqual(transferTask(t,0,'write').prompt,transferTask(t,2,'write').prompt);
});
