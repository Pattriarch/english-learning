import test from 'node:test';
import assert from 'node:assert/strict';
import {plannerPreferences,validDailyPlan,plannerManual,plannerJSON,plannerBookRequests,loadPlannerBookLessons} from '../planner.js';

const day='2026-09-10',at=new Date(day+'T12:00:00').toISOString();
const snapshot=()=>({version:1,day,createdAt:at,level:'B1',minutes:90,domain:'culture',blocks:[{id:'today-writing',skill:'writing',title:'Write a scene',instruction:'Describe a disagreement.',why:'Connect an idea with your own words.',minutes:20,href:'#/practice/writing/2026-09-10/today-writing',target:{kind:'attempts',count:1,exerciseIds:['planned-writing']},practiceTask:{id:'planned-writing',mode:'writing',level:'B1',title:'A scene',prompt:'Describe a disagreement.'}}]});

test('Daily planner preferences retain all six agreed domains and supported durations',()=>{
 for(const domain of ['everyday','work','travel','culture','science','society'])for(const minutes of [30,60,90,120,180])assert.deepEqual(plannerPreferences({level:'C1',minutes,domain}),{version:1,level:'C1',minutes,domain});
 assert.deepEqual(plannerPreferences({level:'C3',minutes:999,domain:'unknown'}),{version:1,level:'B1',minutes:90,domain:'everyday'});
 assert.equal(plannerPreferences(null).level,'B1');
 assert.equal(plannerPreferences(null,120).minutes,120);assert.equal(plannerPreferences(null,110).minutes,120);assert.equal(plannerPreferences({minutes:30},120).minutes,30);
});

test('Book metadata requests include started matching grammar units and only eight unstarted units',()=>{
 const units=Array.from({length:20},(_,i)=>({id:'grammar-intermediate-'+String(i+1).padStart(3,'0')}));
 const data={library:{books:[{id:'grammar-intermediate',level:'B1–B2',units},{id:'vocabulary-advanced',level:'C1',units:[{id:'vocab-001'}]},{id:'grammar-copy',duplicateOf:'grammar-intermediate',level:'B1–B2',units:[{id:'copy-001',equivalentUnitId:units[18].id}]}]},state:{attempts:[{lessonId:'book-'+units[19].id,answer:'Started'},{lessonId:'free',exerciseId:'book-copy-001-e1--deadbeef01234567',answer:'Legacy'}]},bookStatus:{units:Object.fromEntries(units.map(unit=>[unit.id,{status:'ready'}]))}};
 const ids=plannerBookRequests(data,'B1');assert.deepEqual(ids,[units[18].id,units[19].id,...units.slice(0,8).map(unit=>unit.id)]);assert.deepEqual(plannerBookRequests(data,'C2'),[]);
});

test('Book metadata loading limits concurrency, checks provenance, and keeps only exercise metadata',async t=>{
 const original=globalThis.fetch;let active=0,peak=0;
 t.after(()=>globalThis.fetch=original);
 const units=Array.from({length:10},(_,i)=>({id:'grammar-intermediate-'+String(i+1).padStart(3,'0')}));
 const data={library:{books:[{id:'grammar-intermediate',level:'B1–B2',units}]},state:{attempts:[]},bookStatus:{units:Object.fromEntries(units.map(unit=>[unit.id,{status:'ready'}]))}};
 globalThis.fetch=async url=>{active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;const id=url.split('/').at(-1).replace('.json','');return{ok:true,json:async()=>({id:'book-'+id,title:'Lesson',level:'B1',provenance:{unitId:id.endsWith('002')?'mismatch':id},sections:[{body:'Private full text'}],exercises:[{id:'e1',kind:'write',prompt:'Long prompt'}]})};};
 const lessons=await loadPlannerBookLessons(data,'B1');assert.equal(peak,4);assert.equal(lessons.length,7);assert.equal(lessons.some(lesson=>lesson.id.endsWith('002')),false);assert.deepEqual(lessons[0].exercises,[{id:'e1',kind:'write'}]);assert.equal(lessons[0].sections,undefined);
});

test('A saved daily snapshot preserves the exact planned task and deep route',()=>{
 const plan=snapshot(),stored=JSON.parse(plannerJSON(plan));
 assert.equal(validDailyPlan(stored,day),true);assert.deepEqual(stored,plan);
 assert.equal(validDailyPlan(stored,'2026-09-11'),false);
 for(const href of ['https://example.org','#/practice/writing?task=changed','#/practice/<script>'])assert.equal(validDailyPlan({...plan,blocks:[{...plan.blocks[0],href}]},day),false);
 assert.equal(validDailyPlan({...plan,blocks:[plan.blocks[0],plan.blocks[0]]},day),false);
});

test('Manual completion belongs only to a known block on its own local day',()=>{
 const plan=snapshot(),wrongDay=new Date('2026-09-09T12:00:00').toISOString();
 assert.deepEqual(plannerManual({'today-writing':{done:true,at},unknown:{done:true,at}},plan),{'today-writing':{done:true,at,source:'outside'}});
 for(const entry of [{done:false,at},{done:true,at:wrongDay},{done:true,at:'invalid'},true])assert.deepEqual(plannerManual({'today-writing':entry},plan),{});
 assert.deepEqual(plannerManual({},plan),{});
});

test('JSON persistence enforces the server byte budget for Russian as well as ASCII',()=>{
 assert.ok(new TextEncoder().encode(plannerJSON(snapshot())).length<19500);
 assert.doesNotThrow(()=>plannerJSON({text:'я'.repeat(9500)}));
 assert.throws(()=>plannerJSON({text:'я'.repeat(10000)}),/большим/);
 assert.throws(()=>plannerJSON({text:'a'.repeat(20000)}),/большим/);
});
