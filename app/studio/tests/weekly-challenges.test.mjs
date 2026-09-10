import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyChallenge} from '../weekly-challenges-model.js';
import {weeklySummary} from '../planner-model.js';
const unit={id:'b1-project',level:'B1',tasks:[{id:'reading',kind:'reading'},{id:'writing',kind:'writing'}],transfer:{delayDays:7}};
test('weekly project continues submitted work and does not assign another level',()=>{
 const catalog={units:[{...unit,id:'a1-project',level:'A1'},unit,{...unit,id:'b1-next'}]};
 const state={attempts:[{id:'a',lessonId:'project-b1-project',exerciseId:'reading',answer:'I read the actual complete source.',at:'2026-01-01T12:00:00Z'}],drafts:{}};
 assert.equal(weeklyChallenge(catalog,state,'B1',Date.parse('2026-01-02')).unit.id,'b1-project');assert.equal(weeklyChallenge(catalog,state,'B1',Date.parse('2026-01-02')).progress.next,'writing');assert.equal(weeklyChallenge(catalog,state,'C1').complete,false);
});
test('project work contributes the actual practiced skill to the weekly balance',()=>{
 const data={state:{attempts:[{id:'a',lessonId:'project-b1-project',exerciseId:'reading',answer:'A complete answer about the source.',at:'2026-01-02T12:00:00Z',mode:'writing'},{id:'b',lessonId:'project-b1-project',exerciseId:'speaking',answer:'I explain the problem in my own words.',at:'2026-01-02T13:00:00Z',mode:'speaking'}],drafts:{}}};
 const s=weeklySummary(data,new Date('2026-01-03T12:00:00Z'));assert.equal(s.skills.find(x=>x.id==='reading').count,1);assert.equal(s.skills.find(x=>x.id==='speaking').count,1);assert.equal(s.skills.find(x=>x.id==='grammar').count,0);
});
