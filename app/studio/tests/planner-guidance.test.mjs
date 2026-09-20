import test from 'node:test';
import assert from 'node:assert/strict';
import {createDailyPlan,weeklySummary,dailyPlanProgress} from '../planner-model.js';

const now=new Date('2026-09-20T12:00:00Z');
const task=(id,extra={})=>({id,kind:'translate',...extra});
const lesson=(id,extra={})=>({id,title:id,level:'B1',courseGuide:{},exercises:[task('prepare-1',{practiceStage:'guided',revision:1}),task('e1',{kind:'write'})],...extra});
const answer=(lessonId,exerciseId,verdict='correct')=>({lessonId,exerciseId,answer:'My own answer.',at:'2026-09-20T11:00:00Z',mode:'writing',feedback:{verdict}});
const options={level:'B1',minutes:120};

test('input preparation is opened before source tasks and is not counted as reading or listening',()=>{
 const reading=lesson('path-reading-practice',{materials:[{id:'m1',kind:'reading'}],exercises:[task('prepare-1',{practiceStage:'guided',revision:1}),task('e1',{kind:'write',materialIds:['m1']})]});
 const data={lessons:[reading],state:{attempts:[]}};
 const initial=createDailyPlan(data,options,now).blocks.find(b=>b.id==='reading');
 assert.equal(initial.skill,'writing');assert.equal(initial.href,'#/lesson/path-reading-practice/0');
 assert.deepEqual(initial.target.exerciseIds,['prepare-1--revision-1']);
 data.state.attempts=[answer(reading.id,'prepare-1')];
 assert.equal(createDailyPlan(data,options,now).blocks.find(b=>b.id==='reading').skill,'writing','old preparation revision does not bypass new preparation');
 data.state.attempts=[answer(reading.id,'prepare-1--revision-1')];
 const next=createDailyPlan(data,options,now).blocks.find(b=>b.id==='reading');
 assert.equal(next.skill,'reading');assert.equal(next.href,'#/lesson/path-reading-practice/1');
 const skills=weeklySummary(data,now).skills;
 assert.equal(skills.find(s=>s.id==='reading').count,0);
 assert.equal(skills.find(s=>s.id==='listening').count,0);
 assert.equal(skills.find(s=>s.id==='writing').count,1);
});

test('a started later topic cannot displace the first unfinished course topic',()=>{
 const first=lesson('path-first'),later=lesson('path-later',{prerequisites:['path-first']});
 const data={lessons:[first,later],state:{attempts:[answer(later.id,'prepare-1--revision-1')]}};
 assert.equal(createDailyPlan(data,options,now).blocks.find(b=>b.id==='grammar').href,'#/lesson/path-first/0');
 data.state.attempts.push(answer(first.id,'prepare-1--revision-1','incorrect'),answer(first.id,'e1'));
 assert.equal(createDailyPlan(data,options,now).blocks.find(b=>b.id==='grammar').href,'#/lesson/path-first/0','failed preparation remains pending');
});

test('a higher level does not skip an unfinished foundational prerequisite',()=>{
 const first=lesson('path-base',{level:'A1',beginner:true}),later=lesson('path-upper',{prerequisites:['path-base']});
 const data={lessons:[first,later],state:{attempts:[]}};
 const plan=createDailyPlan(data,options,now);
 assert.equal(plan.level,'B1');assert.equal(plan.courseLevel,'A1');
 assert.equal(plan.blocks[0].href,'#/lesson/path-base/0');
 const saved={version:1,day:'2026-09-20',blocks:[{id:'old',target:{kind:'attempts',lessonIds:['path-upper'],exerciseIds:['e1'],count:1}}]};
 const before=JSON.stringify(saved);
 dailyPlanProgress(saved,data.state);createDailyPlan(data,options,now);
 assert.equal(JSON.stringify(saved),before,'saved historical plans remain unchanged');
});

test('choosing A2 respects its unfinished A1 prerequisite',()=>{
 const first=lesson('path-base',{level:'A1',beginner:true}),later=lesson('path-second',{level:'A2',prerequisites:['path-base']});
 const data={lessons:[first,later],state:{attempts:[]}};
 assert.equal(createDailyPlan(data,{level:'A2',minutes:30},now).blocks[0].href,'#/lesson/path-base/0');
});
