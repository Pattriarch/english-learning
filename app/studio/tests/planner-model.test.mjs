import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createDailyPlan,dailyPlanProgress,weeklySummary} from '../planner-model.js';

process.env.TZ='Europe/Moscow';
const now=new Date(2026,8,10,12,0,0),day='2026-09-10';
const at=(dayOffset=0,hour=10,minute=0)=>new Date(2026,8,10+dayOffset,hour,minute).toISOString();
const answer=(lessonId,exerciseId,overrides={})=>({id:lessonId+'-'+exerciseId,lessonId,exerciseId,answer:'My own complete answer.',at:at(),mode:'writing',feedback:{verdict:'ungraded'},...overrides});
const lesson=(id,level='B1')=>({id,title:id,level,exercises:[{id:'e1',kind:'translate'},{id:'e2',kind:'write'},{id:'e3',kind:'rewrite'}]});
const block=(id,target)=>({id,skill:id,title:id,instruction:'Practice',why:'Practice',minutes:10,href:'#/review',target});
const plan=(blocks)=>({version:1,day,createdAt:now.toISOString(),level:'B1',minutes:120,domain:'everyday',blocks});
const frozen=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(frozen);}return value;};
const bookData=()=>({library:{books:[{id:'grammar-intermediate',level:'B1–B2',units:[{id:'grammar-intermediate-001',unit:1,title:'First'},{id:'grammar-intermediate-002',unit:2,title:'Second'},{id:'grammar-intermediate-003',unit:3,title:'Third'}]},{id:'grammar-intermediate-ebook',duplicateOf:'grammar-intermediate',level:'B1–B2',units:[{id:'grammar-intermediate-ebook-001',equivalentUnitId:'grammar-intermediate-001'}]}]},bookStatus:{units:{'grammar-intermediate-001':{status:'ready'},'grammar-intermediate-002':{status:'waiting'},'grammar-intermediate-003':{status:'ready'}}},state:{attempts:[],read:{}}});

test('lexicon production records vocabulary and the actual writing or speaking mode',()=>{
 const d={state:{attempts:[answer('free','lexicon-us-op-c1'),answer('free','lexicon-us-imo-c1',{mode:'speaking'})]}};
 const summary=weeklySummary(d,now);
 assert.equal(summary.skills.find(s=>s.id==='vocabulary').count,2);
 assert.equal(summary.skills.find(s=>s.id==='writing').count,1);
 assert.equal(summary.skills.find(s=>s.id==='speaking').count,1);
 const p=createDailyPlan({}, {minutes:120},now);
 assert.equal(p.blocks.find(b=>b.skill==='vocabulary').href,'#/lexicon');
});

test('authentic recordings enter the listening plan and do not create grammar evidence',()=>{
 const natural={...lesson('natural-b2-leadership','B2'),materials:[{id:'m1',kind:'reference',inputSkill:'listening'}],exercises:[{id:'e1',kind:'write',materialIds:['m1']}]};
 const data={lessons:[lesson('path-listening','B2'),natural],state:{attempts:[]}};
 assert.equal(createDailyPlan(data,{level:'B2',minutes:120},now).blocks.find(b=>b.skill==='listening').href,'#/lesson/natural-b2-leadership/0');
 data.state.attempts=[answer(natural.id,'e1')];
 const skills=weeklySummary(data,now).skills;
 assert.equal(skills.find(s=>s.id==='listening').count,1);
 assert.equal(skills.find(s=>s.id==='grammar').count,0);
});

test('all durations balance the budget; long days include input, output and bounded review',()=>{
 for(const minutes of [30,60,90,120,180]) {
  const p=createDailyPlan({}, {minutes}, now);
  assert.equal(p.blocks.reduce((n,b)=>n+b.minutes,0),minutes);
  assert.ok(p.blocks.every(b=>b.minutes>0&&b.minutes%5===0));
  assert.ok(p.blocks.some(b=>['reading','listening'].includes(b.skill)));
  assert.ok(p.blocks.some(b=>['writing','speaking'].includes(b.skill)));
  if(minutes>=90) assert.deepEqual(new Set(p.blocks.map(b=>b.skill)),new Set(['grammar','vocabulary','reading','listening','speaking','writing','pronunciation','review']));
  assert.ok((p.blocks.find(b=>b.skill==='review')?.minutes||0)<=20);
 }
 assert.equal(createDailyPlan({}, {minutes:105}, now).minutes,90);
 assert.equal(createDailyPlan({}, {minutes:999,level:'bogus',domain:'bogus'}, now).minutes,180);
 assert.equal(createDailyPlan({}, {minutes:'bad'}, now).minutes,120);
});

test('deterministic functions do not mutate frozen input or saved snapshots',()=>{
 const data=frozen({lessons:[lesson('topic')],learningPath:{levels:[{id:'B1',lessonIds:['topic']}]},state:{attempts:[answer('topic','e1',{at:at(-1)})],cards:[]}});
 const options=frozen({level:'B1',minutes:120,domain:'work'}),before=JSON.stringify(data);
 const first=createDailyPlan(data,options,now);assert.deepEqual(first,createDailyPlan(data,options,now));
 frozen(first);dailyPlanProgress(first,data.state);weeklySummary(data,now);
 assert.equal(JSON.stringify(data),before);
 const saved=JSON.stringify(first);dailyPlanProgress(first,{attempts:[answer('topic','e2')]});assert.equal(JSON.stringify(first),saved);
});

test('weak data produces usable destinations and a serializable validated snapshot',()=>{
 for(const input of [undefined,null,{}, {lessons:[null,{id:'../bad'}],library:{books:[]}}]) {
  const p=createDailyPlan(input,{minutes:120,domain:'science'},now);
  for(const b of p.blocks) {
   assert.match(b.href,/^#\/[a-zA-Z0-9/_-]+$/);
   assert.ok(b.title&&b.instruction&&b.why&&b.target.count>0);
   if(b.practiceTask) assert.equal(b.target.exerciseIds[0],b.practiceTask.mode+'-'+b.practiceTask.id);
  }
  assert.equal(JSON.parse(JSON.stringify(p)).day,day);
 }
});

test('book planner only selects ready canonical units and continues unanswered work',()=>{
 const data=bookData();data.state.read={'grammar-intermediate-001':at(-1)};
 assert.equal(createDailyPlan(data,{},now).blocks.find(b=>b.skill==='grammar').href,'#/unit/grammar-intermediate-001');
 data.state.attempts=[answer('free','book-grammar-intermediate-003-e1--0123456789abcdef',{at:at(-1)})];
 data.bookLessons=[{id:'book-grammar-intermediate-003',exercises:[{id:'e1'},{id:'e2'},{id:'e3'}]}];
 const b=createDailyPlan(data,{},now).blocks.find(b=>b.skill==='grammar');
 assert.equal(b.href,'#/unit/grammar-intermediate-003');assert.deepEqual(b.target.exerciseIds,['e2','e3']);
 data.state.attempts.push(answer('book-grammar-intermediate-003','e2',{at:at(-1)}),answer('book-grammar-intermediate-003','e3',{at:at(-1)}));
 assert.equal(createDailyPlan(data,{},now).blocks.find(b=>b.skill==='grammar').href,'#/unit/grammar-intermediate-001','all submitted ungraded tasks must allow moving to another topic');
});

test('fallback follows learning-path level order; read is not completion',()=>{
 const data={lessons:[lesson('later'),lesson('first'),lesson('advanced','C2')],learningPath:{levels:[{id:'B1',lessonIds:['first','later']}]},state:{read:{first:at()},attempts:[]}};
 assert.equal(createDailyPlan(data,{},now).blocks.find(b=>b.skill==='grammar').href,'#/lesson/first');
 data.state.attempts=['e1','e2','e3'].map(id=>answer('first',id,{at:at(-1)}));
 assert.equal(createDailyPlan(data,{},now).blocks.find(b=>b.skill==='grammar').href,'#/lesson/later');
});

test('prepared advanced input takes precedence and covered lessons rotate without claiming mastery',()=>{
 const data={lessons:[lesson('path-longform-reading','C1'),lesson('path-lecture-listening','C1'),lesson('path-literary-reading','C2'),lesson('research-discourse-listening','C2')],state:{attempts:[]}};
 const p=createDailyPlan(data,{level:'C2',minutes:120},now);
 assert.equal(p.blocks.find(b=>b.skill==='reading').href,'#/lesson/path-literary-reading/1');
 assert.equal(p.blocks.find(b=>b.skill==='listening').href,'#/lesson/research-discourse-listening/1');
 const movies={lessons:[lesson('listening'),lesson('cinema-bcs-s01e01-listen'),lesson('cinema-bcs-s01e02-listen')],state:{attempts:['e1','e2','e3'].map(id=>answer('cinema-bcs-s01e01-listen',id,{at:at(-1)}))}};
 assert.equal(createDailyPlan(movies,{domain:'culture'},now).blocks.find(b=>b.skill==='listening').href,'#/lesson/cinema-bcs-s01e02-listen/1');
});

test('domain changes real prompts and every fallback domain has three daily contexts',()=>{
 for(const domain of ['everyday','work','travel','culture','science','society']) {
  const texts=new Set(),roles=new Set();
  for(let offset=0;offset<3;offset++) {
   const p=createDailyPlan({}, {domain,minutes:120}, new Date(2026,8,10+offset,12));
   const reading=p.blocks.find(b=>b.skill==='reading').practiceTask,listening=p.blocks.find(b=>b.skill==='listening').practiceTask;
   assert.notEqual(reading.passage,listening.passage);texts.add(reading.passage);roles.add(p.blocks.find(b=>b.skill==='speaking').practiceTask.prompt);
   assert.equal(p.domain,domain);
  }
  assert.equal(texts.size,3);assert.equal(roles.size,3);
 }
 assert.notEqual(createDailyPlan({}, {domain:'work'},now).blocks.find(b=>b.skill==='writing').practiceTask.prompt,createDailyPlan({}, {domain:'science'},now).blocks.find(b=>b.skill==='writing').practiceTask.prompt);
});

test('bundled sources drive input selection and evidence without crediting future dialogue',()=>{
 const rich={...lesson('extended-b1-community'),materials:[{id:'article',kind:'reading'},{id:'later-call',kind:'dialogue'}],exercises:[{id:'e1',kind:'write',materialIds:['article']},{id:'e2',kind:'speak',materialIds:['later-call']}]};
 const data={lessons:[lesson('path-reading'),lesson('path-listening'),rich],state:{attempts:[]}};
 const p=createDailyPlan(data,{level:'B1',minutes:120},now);
 assert.equal(p.blocks.find(b=>b.skill==='reading').href,'#/lesson/extended-b1-community/0');
 assert.deepEqual(p.blocks.find(b=>b.skill==='reading').target.exerciseIds,['e1']);
 assert.equal(p.blocks.find(b=>b.skill==='listening').href,'#/lesson/extended-b1-community/1');
 assert.deepEqual(p.blocks.find(b=>b.skill==='listening').target.exerciseIds,['e2']);
 data.state.attempts=[answer(rich.id,'e1')];
 const summary=weeklySummary(data,now);
 assert.ok(summary.skills.find(s=>s.id==='reading').count>0);
 assert.equal(summary.skills.find(s=>s.id==='listening').count,0);
 assert.equal(summary.skills.find(s=>s.id==='grammar').count,0);
});

test('listening plans begin with a listening source before a later dialogue from a reading lesson',()=>{
 const reading={...lesson('extended-reading'),materials:[{id:'article',kind:'reading'},{id:'followup',kind:'dialogue'}],exercises:[{id:'e1',kind:'write',materialIds:['article']},{id:'e2',kind:'speak',materialIds:['followup']}]};
 const listening={...lesson('extended-talk'),materials:[{id:'talk',kind:'listening'}],exercises:[{id:'e1',kind:'write',materialIds:['talk']},{id:'e2',kind:'speak',materialIds:['talk']}]};
 const data={lessons:[reading,listening],state:{attempts:[]}};
 assert.equal(createDailyPlan(data,{minutes:120},now).blocks.find(b=>b.skill==='listening').href,'#/lesson/extended-talk/0');
 data.state.attempts=[answer(reading.id,'e2')];
 assert.equal(createDailyPlan(data,{minutes:120},now).blocks.find(b=>b.skill==='listening').href,'#/lesson/extended-talk/0');
});

test('rebuilding a day for a different domain cannot reuse completion of its former task',()=>{
 const work=createDailyPlan({}, {domain:'work'},now),travel=createDailyPlan({}, {domain:'travel'},now);
 const oldTask=work.blocks.find(b=>b.skill==='writing').practiceTask,newTask=travel.blocks.find(b=>b.skill==='writing').practiceTask;
 assert.notEqual(oldTask.id,newTask.id);
 const state={attempts:[answer('free','writing-'+oldTask.id)]};
 assert.equal(dailyPlanProgress(work,state).blocks.find(b=>b.skill==='writing').done,true);
 assert.equal(dailyPlanProgress(travel,state).blocks.find(b=>b.skill==='writing').done,false);
});

test('daily evidence uses the local day, includes pre-snapshot answers, and deduplicates retries',()=>{
 const p=plan([block('grammar',{kind:'attempts',count:2,lessonIds:['topic']})]);
 const early=new Date(2026,8,10,0,15).toISOString();assert.equal(early.slice(0,10),'2026-09-09');
 const state={attempts:[answer('topic','e1',{at:early}),answer('topic','e1',{id:'retry',at:at()}),answer('topic','e2',{at:at(-1)}),answer('other','e2')]};
 let progress=dailyPlanProgress(p,state);assert.equal(progress.blocks[0].current,1);assert.equal(progress.done,0);
 state.attempts.push(answer('topic','e2'));progress=dailyPlanProgress(p,state);assert.equal(progress.done,1);assert.equal(progress.percent,100);assert.equal(progress.completedMinutes,10);
});

test('legacy book and modern book answers represent the same exercise',()=>{
 const p=plan([block('grammar',{kind:'attempts',count:2,lessonIds:['book-grammar-intermediate-003'],exerciseIds:['e1','e2']})]);
 const state={attempts:[answer('free','book-grammar-intermediate-003-e1--0123456789abcdef'),answer('book-grammar-intermediate-003','e1',{at:at(0,11)})]};
 assert.equal(dailyPlanProgress(p,state).blocks[0].current,1);
 state.attempts.push(answer('free','book-grammar-intermediate-003-e2--0123456789abcdef'));
 assert.equal(dailyPlanProgress(p,state).done,1);
});

test('typed rehearsal cannot automatically complete speaking or unrelated saved free tasks',()=>{
 const p=createDailyPlan({}, {minutes:120},now),b=p.blocks.find(b=>b.skill==='speaking'),task=b.target.exerciseIds[0];
 const state={attempts:[answer('free',task),answer('free','speaking-0',{mode:'speaking'})]};
 assert.equal(dailyPlanProgress(p,state).blocks.find(b=>b.skill==='speaking').done,false);
 state.attempts.push(answer('free',task,{mode:'speaking',at:at(0,11)}));
 assert.equal(dailyPlanProgress(p,state).blocks.find(b=>b.skill==='speaking').automatic,true);
 state.attempts.push(answer('free',task,{mode:'writing',at:at(0,11,30)}));
 assert.equal(dailyPlanProgress(p,state).blocks.find(b=>b.skill==='speaking').automatic,true,'a later typed correction must not erase recorded oral practice');
 assert.equal(weeklySummary({state},now).skills.find(s=>s.id==='speaking').count,2);
});

test('review counts distinct selected cards and caps a large due backlog',()=>{
 const cards=Array.from({length:100},(_,i)=>({id:'c'+i,created:at(-10),due:at(-1)})),p=createDailyPlan({state:{cards}},{minutes:180},now),b=p.blocks.find(b=>b.skill==='review');
 assert.ok(b.target.count<=20);assert.ok(b.minutes<=20);
 const reviews=[{cardId:b.target.cardIds[0],at:at()},{cardId:b.target.cardIds[0],at:at(0,11)},{cardId:'outside',at:at()}];
 assert.equal(dailyPlanProgress(p,{reviews}).blocks.find(b=>b.skill==='review').current,1);
});

test('corrections require a genuinely new answer after the original error',()=>{
 const original=answer('topic','e1',{feedback:{verdict:'incorrect'}}),data={lessons:[lesson('topic')],state:{attempts:[original]}};
 const p=createDailyPlan(data,{},now),b=p.blocks.find(b=>b.skill==='review');assert.equal(b.target.kind,'corrections');
 assert.equal(dailyPlanProgress(p,data.state).blocks.find(b=>b.skill==='review').current,0);
 data.state.attempts.push(answer('topic','e1',{at:at(0,11),feedback:{verdict:'partial'}}));
 assert.equal(dailyPlanProgress(p,data.state).blocks.find(b=>b.skill==='review').done,true,'effort counts even when a correction still needs work');
});

test('manual completion stays separate, is day scoped, and totals use planned minutes',()=>{
 const p=plan([block('writing',{kind:'attempts',count:1}),block('speaking',{kind:'manual',count:1})]);
 const result=dailyPlanProgress(p,{}, {writing:{done:true,at:at(),source:'outside'},speaking:{done:true,at:at(-1)}});
 assert.deepEqual([result.blocks[0].current,result.blocks[0].automatic,result.blocks[0].manual,result.blocks[0].done],[0,false,true,true]);
 assert.equal(result.blocks[1].done,false);assert.equal(result.completedMinutes,10);assert.equal(result.next.id,'speaking');
 assert.equal(dailyPlanProgress({blocks:[]},{}).percent,0);
});

test('weekly counts deduplicate, separate self reports, and merge review into vocabulary',()=>{
 const p=plan([block('speaking',{kind:'manual',count:1})]);
 const data={state:{attempts:[answer('free','writing-a',{at:at(-6)}),answer('free','writing-a',{at:at(-6,11)}),answer('free','speaking-a',{at:at(-1),mode:'writing'}),answer('free','speaking-b',{at:at(-7),mode:'speaking'})],cards:[{id:'c1',created:at()}],reviews:[{cardId:'c1',at:at()},{cardId:'c1',at:at(0,11)}],activity:{[day]:659}}};
 const summary=weeklySummary(data,now,{[day]:{plan:p,manual:{speaking:{done:true,at:at()}}}});
 assert.equal(summary.days.length,7);assert.equal(summary.from,'2026-09-04');assert.equal(summary.skills.length,7);
 assert.deepEqual(summary.totals,{attempts:2,reviews:1,cards:1,minutes:10,activeDays:3});
 assert.equal(summary.skills.find(s=>s.id==='speaking').count,0);assert.equal(summary.skills.find(s=>s.id==='speaking').manualCount,1);
 assert.equal(summary.skills.find(s=>s.id==='vocabulary').count,2);assert.equal(summary.skills.find(s=>s.id==='writing').count,2);
 assert.ok(summary.recommendations.some(s=>s.skill==='listening'));
});

test('short plans prioritize an omitted input and output skill over an already busy week',()=>{
 const data={state:{attempts:Array.from({length:6},(_,i)=>[answer('free','reading-'+i,{at:at(-i)}),answer('free','writing-'+i,{at:at(-i)})]).flat()}};
 const p=createDailyPlan(data,{minutes:30},now),skills=p.blocks.map(b=>b.skill);
 assert.ok(skills.includes('listening'));assert.ok(skills.includes('speaking'));
});

test('real curriculum snapshots fit the existing server draft limit for every level and domain',()=>{
 const read=file=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8').replace(/^\uFEFF/,''));
 const courseDir=new URL('../../content/courses/',import.meta.url);
 const lessons=[...read('../../content/curriculum.json'),...readdirSync(courseDir).filter(f=>f.endsWith('.json')).flatMap(f=>read('../../content/courses/'+f))];
 const data={lessons,library:read('../../content/library.json'),learningPath:read('../../content/learning-path.json'),pronunciation:read('../../content/pronunciation.json'),state:{attempts:[]}};
 for(const level of ['A1','A2','B1','B2','C1','C2']) for(const domain of ['everyday','work','travel','culture','science','society']) for(const minutes of [120,180]) {
  const p=createDailyPlan(data,{minutes,level,domain},now);
  assert.ok(Buffer.byteLength(JSON.stringify(p),'utf8')<=19500,`${level}/${domain} exceeds safe snapshot bytes`);
  for(const b of p.blocks.filter(b=>b.href.startsWith('#/lesson/'))) {
   const selected=lessons.find(l=>b.href.split('/')[2]===l.id);assert.ok(selected);
   if(['reading','listening'].includes(b.skill)) {
    assert.ok(b.target.exerciseIds.every(id=>['write','speak'].includes(selected.exercises.find(e=>e.id===id)?.kind)),'introductory translations cannot complete comprehension practice');
    assert.equal(selected.exercises[Number(b.href.split('/')[3])].id,b.target.exerciseIds[0]);
   }
  }
 }
});
