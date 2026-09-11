import test from 'node:test';
import assert from 'node:assert/strict';
import {createDailyPlan,dailyPlanProgress} from '../planner-model.js';

const now=new Date('2026-09-11T12:00:00'),data={state:{attempts:[],cards:[],reviews:[],drafts:{}},lessons:[{id:'first-topic',title:'First topic',level:'B1',group:'Grammar',exercises:[{id:'e1',kind:'translate',prompt:'Describe today.',answers:['Today is Friday.']}]}]};

test('a fresh learner starts real practice before closing recall; due cards still lead',()=>{
 const plan=createDailyPlan(data,{level:'B1',minutes:120},now),progress=dailyPlanProgress(plan,data.state);
 assert.notEqual(plan.blocks[0].skill,'review');assert.notEqual(progress.next.skill,'review');
 assert.equal(plan.blocks.at(-1).skill,'review');assert.equal(plan.blocks.at(-1).target.kind,'manual');
 assert.match(plan.blocks.at(-1).title,/в конце/);assert.equal(plan.blocks.reduce((n,b)=>n+b.minutes,0),120);
 const due=createDailyPlan({...data,state:{...data.state,cards:[{id:'due',due:new Date('2026-09-10T12:00:00').toISOString()}]}},{level:'B1',minutes:120},now);
 assert.equal(due.blocks[0].target.kind,'reviews');assert.equal(dailyPlanProgress(due,data.state).next.id,due.blocks[0].id);
});

test('an old saved empty review block does not trap the primary action before actual practice',()=>{
 const plan=createDailyPlan(data,{level:'B1',minutes:120},now);plan.blocks.unshift(plan.blocks.pop());const snapshot=structuredClone(plan);
 assert.equal(plan.blocks[0].target.kind,'manual');assert.notEqual(dailyPlanProgress(plan,data.state).next.id,plan.blocks[0].id);assert.deepEqual(plan,snapshot);
 const manual=Object.fromEntries(plan.blocks.slice(1).map(b=>[b.id,{done:true,at:now.toISOString()}]));
 assert.equal(dailyPlanProgress(plan,data.state,manual).next.id,plan.blocks[0].id);
});
