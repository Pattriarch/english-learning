import test from 'node:test';
import assert from 'node:assert/strict';
import {changedPlanBlocks,reviseChangedPlan,actionablePlanChange} from '../planner-revisions.js';
import {coursebookPlanTarget} from '../planner-coursebooks.js';
import {bookStudyStageIDs,remapBookStudyPlan} from '../book-study-model.js';
import {bookExerciseID} from '../book-reader.js';
import {dailyPlanProgress} from '../planner-model.js';
import {validDailyPlan,plannerJSON} from '../planner.js';
import {studyUI,deferred} from './study-ui-fixture.mjs';
import {dateKey} from '../core.js';

const day='2026-09-11',at=new Date(day+'T13:00:00').toISOString(),later=new Date(day+'T14:00:00').toISOString();
function fixture(){
 const block={id:'review',skill:'review',title:'Return to a mistake',instruction:'Answer again.',why:'Apply the correction.',minutes:15,href:'#/lesson/mediation',target:{kind:'corrections',count:1,tasks:[{lessonId:'mediation',exerciseId:'e4',after:new Date(day+'T10:00:00').toISOString()}],lessonIds:['mediation']}};
 return {plan:{version:1,day,createdAt:at,minutes:30,level:'C2',domain:'work',blocks:[block,{...block,id:'unchanged',target:{kind:'manual',count:1}}]},data:{lessons:[{id:'mediation',exercises:[{id:'e4',revision:1}]}],bookLessons:[],state:{attempts:[],drafts:{},cards:[],reviews:[]},settings:{}}};
}

test('explicit revision replaces only stale unfinished targets without migrating any answer',()=>{
 const {plan,data}=fixture(),original=structuredClone(plan),changes=changedPlanBlocks(plan,data);
 assert.equal(changes.length,1);
 const revised=reviseChangedPlan(plan,changes,at,'planner:archive:'+day+':1');
 assert.deepEqual(plan,original);assert.equal(revised.blocks[1],plan.blocks[1]);assert.equal(revised.previousPlanKey,'planner:archive:'+day+':1');assert.equal(validDailyPlan(JSON.parse(plannerJSON(revised)),day),true);
 assert.deepEqual(revised.blocks[0].target.tasks,[{lessonId:'mediation',exerciseId:'e4--revision-1',after:at}]);
 const old={lessonId:'mediation',exerciseId:'e4',answer:'A historical answer.',at:later};
 assert.equal(dailyPlanProgress(revised,{attempts:[old]}).blocks[0].current,0);
 assert.equal(dailyPlanProgress(revised,{attempts:[old,{...old,exerciseId:'e4--revision-1'}]}).blocks[0].current,1);
 assert.deepEqual(changedPlanBlocks(plan,data,['review']),[]);
 assert.deepEqual(changedPlanBlocks(revised,data),[]);
});

test('missing current metadata never invents a replacement and free practice stays fixed',()=>{
 const {plan,data}=fixture();assert.deepEqual(changedPlanBlocks(plan,{...data,lessons:[]}),[]);
 data.lessons[0].exercises=[{id:'another'}];assert.deepEqual(changedPlanBlocks(plan,data),[]);
 plan.blocks[0].target={kind:'attempts',count:1,lessonIds:['free'],exerciseIds:['writing-daily-fixed']};
 assert.deepEqual(changedPlanBlocks(plan,data),[]);
});

test('book refresh uses exact current version, including an old edition navigation alias',()=>{
 const {plan,data}=fixture();data.library={books:[{units:[{id:'copy-001',equivalentUnitId:'canonical-001'}]}]};
 data.bookLessons=[{id:'book-canonical-001',exercises:[{id:'e1--bbbbbbbbbbbbbbbb'}]}];
 plan.blocks[0].target={kind:'attempts',count:1,lessonIds:['book-copy-001'],exerciseIds:['e1--aaaaaaaaaaaaaaaa']};
 const revised=reviseChangedPlan(plan,changedPlanBlocks(plan,data),at,'archive');
 assert.equal(revised.blocks[0].href,'#/unit/canonical-001');
 assert.deepEqual(revised.blocks[0].target.exerciseIds,['e1--bbbbbbbbbbbbbbbb']);
 const answer={lessonId:'book-canonical-001',exerciseId:'e1--aaaaaaaaaaaaaaaa',answer:'My old answer.',at:later};
 assert.equal(dailyPlanProgress(revised,{attempts:[answer]}).blocks[0].current,0);
 assert.equal(dailyPlanProgress(revised,{attempts:[{...answer,exerciseId:'e1--bbbbbbbbbbbbbbbb'}]}).blocks[0].current,1);
});

test('real planner action archives the prior snapshot before saving the revised day',async t=>{
 const {plan,data}=fixture(),today=dateKey();plan.day=today;plan.createdAt=new Date().toISOString();
 data.state.drafts['planner:day:'+today]={text:JSON.stringify(plan)};
 const f=await studyUI(t,'planner.js',{'book-reader':{loadBookStatus:async()=>({units:{}}),bookExerciseID:async ex=>ex.id}});
 globalThis.location.hash='#/today';const writes=[],events=new EventTarget();
 for(const name of ['addEventListener','removeEventListener','dispatchEvent'])window[name]=events[name].bind(events);
 f.api=async()=>({projects:[]});f.saveDraftConfirmed=async(key,text)=>{writes.push(key);const draft={text,at:new Date().toISOString()};data.state.drafts[key]=draft;return draft;};
 try{
 await f.module.mountDailyPlanner(f.root,data,async()=>data);
 assert.ok(f.root.querySelector('[data-plan-revise]'));
 await f.root.querySelector('[data-plan-revise]').click();
 assert.equal(f.alerts.length,0);assert.equal(writes.length,2);assert.match(writes[0],new RegExp('^planner:archive:'+today+':'));assert.equal(writes[1],'planner:day:'+today);
 assert.deepEqual(JSON.parse(data.state.drafts[writes[0]].text),plan);
 assert.equal(JSON.parse(data.state.drafts[writes[1]].text).blocks[0].target.tasks[0].exerciseId,'e4--revision-1');
 assert.equal(f.root.querySelector('[data-plan-revise]'),null);
 }finally{events.dispatchEvent(new Event('hashchange'));}
});

async function revisionUI(t,provided=fixture()){
 const {plan,data}=provided,today=dateKey();plan.day=today;plan.createdAt=new Date().toISOString();
 data.state.drafts['planner:day:'+today]={text:JSON.stringify(plan)};
 const f=await studyUI(t,'planner.js',{'book-reader':{loadBookStatus:async()=>data.bookStatus||{units:{}},bookExerciseID:async ex=>ex.id}}),events=new EventTarget(),writes=[];
 globalThis.location.hash='#/today';
 for(const name of ['addEventListener','removeEventListener','dispatchEvent'])window[name]=events[name].bind(events);
 f.api=async()=>({projects:[]});f.refresh=async()=>data;
 f.fetch=async path=>({ok:true,json:async()=>data.bookLessons.find(lesson=>path==='/book-content/'+lesson.id.slice(5)+'.json')});
 f.saveDraftConfirmed=async(key,text)=>{writes.push(key);const draft={text,at:new Date().toISOString()};data.state.drafts[key]=draft;return draft;};
 await f.module.mountDailyPlanner(f.root,data,()=>f.refresh());
 return{...f,fixture:f,data,plan,today,events,writes,leave(){globalThis.location.hash='#/journal';events.dispatchEvent(new Event('hashchange'));f.root.innerHTML='<h1>The next route</h1>';}};
}

test('archive failure leaves the active day untouched and permits a deliberate retry',async t=>{
 const f=await revisionUI(t),before=f.data.state.drafts['planner:day:'+f.today].text;
 f.fixture.saveDraftConfirmed=async key=>{f.writes.push(key);throw Error('Archive save failed');};
 try{
 await f.root.querySelector('[data-plan-revise]').click();
 assert.equal(f.writes.length,1);assert.match(f.writes[0],/^planner:archive:/);
 assert.equal(f.data.state.drafts['planner:day:'+f.today].text,before);assert.equal(f.local.has('planner:day:'+f.today),false);
 assert.deepEqual(f.alerts,['Archive save failed']);assert.equal(f.root.querySelector('[data-plan-revise]').disabled,false);
 }finally{f.leave();}
});

test('leaving while the archive is saving never starts the live plan replacement',async t=>{
 const f=await revisionUI(t),started=deferred(),saving=deferred(),before=f.data.state.drafts['planner:day:'+f.today].text;
 f.fixture.saveDraftConfirmed=async(key,text)=>{f.writes.push(key);started.resolve();await saving.promise;const draft={text,at:new Date().toISOString()};f.data.state.drafts[key]=draft;return draft;};
 const action=f.root.querySelector('[data-plan-revise]').click();await started.promise;f.leave();const departed=f.root.innerHTML;saving.resolve();await action;
 assert.equal(f.writes.length,1);assert.match(f.writes[0],/^planner:archive:/);assert.equal(f.data.state.drafts['planner:day:'+f.today].text,before);
 assert.equal(f.local.has('planner:day:'+f.today),false);assert.equal(f.root.innerHTML,departed);assert.equal(f.alerts.length,0);
});

test('an acknowledged live save survives route departure without redrawing or emitting a stale update',async t=>{
 const f=await revisionUI(t),started=deferred(),saving=deferred(),updates=[];
 f.events.addEventListener('planner-updated',e=>updates.push(e.detail));
 f.fixture.saveDraftConfirmed=async(key,text)=>{f.writes.push(key);if(key.startsWith('planner:day:')){started.resolve();await saving.promise;}const draft={text,at:new Date().toISOString()};f.data.state.drafts[key]=draft;return draft;};
 const action=f.root.querySelector('[data-plan-revise]').click();await started.promise;f.leave();const departed=f.root.innerHTML;saving.resolve();await action;
 assert.equal(f.writes.length,2);assert.equal(JSON.parse(f.local.get('planner:day:'+f.today)).blocks[0].target.tasks[0].exerciseId,'e4--revision-1');
 assert.equal(f.root.innerHTML,departed);assert.deepEqual(updates,[]);assert.equal(f.alerts.length,0);
});

test('redraws and external refresh signals cannot start a second revision while one operation is active',async t=>{
 const f=await revisionUI(t),started=deferred(),refreshing=deferred();let refreshes=0;
 f.fixture.refresh=async()=>{refreshes++;if(refreshes===1){started.resolve();await refreshing.promise;}return f.data;};
 try{
 const original=f.root.querySelector('[data-plan-revise]'),action=original.click();await started.promise;
 const todayButton=f.root.querySelectorAll('[data-plan-day]').find(button=>button.dataset.planDay===f.today);todayButton.click();
 const replacement=f.root.querySelector('[data-plan-revise]');assert.equal(replacement.disabled,true);replacement.onclick();
 assert.ok(f.root.querySelectorAll('[data-plan-manual]').every(input=>input.disabled));
 f.events.dispatchEvent(new CustomEvent('planner-updated',{detail:{source:'another-view'}}));assert.equal(refreshes,1);
 refreshing.resolve();await action;await new Promise(setImmediate);
 assert.equal(f.writes.length,2,'one archive and one live save');assert.equal(refreshes,2,'the external signal is reread after the operation');
 assert.equal(f.root.querySelector('[data-plan-revise]'),null);assert.equal(f.alerts.length,0);
 }finally{f.leave();}
});

test('an older external refresh result cannot replace data or unlock controls during a revision',async t=>{
 const f=await revisionUI(t),externalStarted=deferred(),external=deferred(),archiveStarted=deferred(),archive=deferred();let refreshes=0;
 const stale=structuredClone(f.data);stale.lessons[0].exercises[0].revision=2;
 f.fixture.refresh=async()=>{if(++refreshes===1){externalStarted.resolve();await external.promise;return stale;}return f.data;};
 f.fixture.saveDraftConfirmed=async(key,text)=>{f.writes.push(key);if(key.startsWith('planner:archive:')){archiveStarted.resolve();await archive.promise;}const draft={text,at:new Date().toISOString()};f.data.state.drafts[key]=draft;return draft;};
 try{
 f.events.dispatchEvent(new CustomEvent('planner-updated',{detail:{source:'older-request'}}));await externalStarted.promise;
 const action=f.root.querySelector('[data-plan-revise]').click();await archiveStarted.promise;external.resolve();await new Promise(setImmediate);
 assert.equal(f.root.querySelector('[data-plan-revise]').disabled,true);
 archive.resolve();await action;
 assert.equal(JSON.parse(f.data.state.drafts['planner:day:'+f.today].text).blocks[0].target.tasks[0].exerciseId,'e4--revision-1');
 assert.equal(f.root.querySelector('[data-plan-revise]'),null);assert.equal(f.writes.length,2);
 }finally{external.resolve();archive.resolve();f.leave();}
});

test('failed live save keeps the archived original and an unchanged active plan available for retry',async t=>{
 const f=await revisionUI(t),before=f.data.state.drafts['planner:day:'+f.today].text;
 f.fixture.saveDraftConfirmed=async(key,text)=>{f.writes.push(key);if(key.startsWith('planner:day:'))throw Error('Live save failed');const draft={text,at:new Date().toISOString()};f.data.state.drafts[key]=draft;return draft;};
 try{
 await f.root.querySelector('[data-plan-revise]').click();
 assert.equal(f.writes.length,2);assert.equal(f.data.state.drafts[f.writes[0]].text,before);assert.equal(f.data.state.drafts['planner:day:'+f.today].text,before);
 assert.equal(f.local.has('planner:day:'+f.today),false);assert.equal(f.root.querySelector('[data-plan-revise]').disabled,false);assert.deepEqual(f.alerts,['Live save failed']);
 }finally{f.leave();}
});

async function structuredFixture(){
 const unit='great-writing-3-3-001',id='book-'+unit,groups=[['e1'],['e2'],['e3'],['e4','e5'],['e6'],['e7']],kinds=['explain','write','rewrite','write','speak','rewrite','write'];
 const source={id,title:'A complete chapter',level:'B1',provenance:{unitId:unit},materials:[{id:'m1',kind:'reading',title:'Source report',text:'A short source report for careful reading.'}],
  exercises:kinds.map((kind,i)=>({id:'e'+(i+1),kind,prompt:'Write your own complete response '+i,answers:['A complete original answer.'],explanation:'Explain the intended meaning.',...(i===1?{materialIds:['m1']}:{})})),
  studyPlan:{stages:bookStudyStageIDs.map((id,i)=>({id,title:id,purpose:'Your own response for '+id,minutes:15,exerciseIds:groups[i]})),revisionExerciseIds:['e6'],transfer:{exerciseIds:['e7'],delayDays:7}}};
 const prepare=async source=>{const exercises=await Promise.all(source.exercises.map(async ex=>({...ex,id:await bookExerciseID(ex,source.materials)})));return{...source,exercises,studyPlan:remapBookStudyPlan(source.studyPlan,source.exercises,exercises)};};
 const old=await prepare(source),current=await prepare({...source,materials:[{...source.materials[0],text:'A substantively different report with new evidence.'}]}),base=fixture();
 base.plan.blocks=[{...base.plan.blocks[0],id:'coursebook',skill:'reading',minutes:30,target:coursebookPlanTarget({lesson:old,exercise:old.exercises[1],stage:old.studyPlan.stages[1]}),href:'#/unit/'+unit}];
 base.data={...base.data,library:{books:[{id:'great-writing-3-3',level:'B1',units:[{id:unit,title:current.title}]}]},bookStatus:{units:{[unit]:{status:'ready'}}},bookLessons:[current]};
 return{...base,old,current};
}
const structuredAnswer=(lesson,index,at)=>({lessonId:lesson.id,exerciseId:lesson.exercises[index].id,answer:'My own meaningful response in a new situation.',at:new Date(at).toISOString(),mode:lesson.exercises[index].kind==='speak'?'speaking':'writing',feedback:{verdict:'correct',source:'codex'}});
function currentThroughRevision(lesson,now,daysAgo=1){
 const revision=now-daysAgo*86400000;
 return lesson.exercises.slice(0,6).map((_,i)=>structuredAnswer(lesson,i,i<5?revision-86400000+i*1000:revision));
}

test('structured recovery uses material-bound identity and selects the actual next current stage',async()=>{
 const f=await structuredFixture(),now=Date.parse(at);f.data.state.attempts=[structuredAnswer(f.current,0,now-1000),structuredAnswer(f.old,1,now-1000)];
 const original=JSON.stringify(f.plan),changes=changedPlanBlocks(f.plan,f.data,[],now);
 assert.equal(changes[0].bookStudy,true);assert.equal(changes[0].status,'ready');assert.equal(changes[0].replacement.target.stage,'input');
 assert.notEqual(f.old.exercises[1].id,f.current.exercises[1].id,'only the attached report changed');
 let revised=reviseChangedPlan(f.plan,changes,at,'archive');
 assert.deepEqual(revised.blocks[0].target.exerciseIds,[f.current.exercises[1].id]);assert.equal(revised.blocks[0].target.study.exercises[1].id,f.current.exercises[1].id);
 assert.equal(dailyPlanProgress(revised,f.data.state).blocks[0].current,0,'old report answer never credits the new question');
 assert.equal(JSON.stringify(f.plan),original);assert.deepEqual(changedPlanBlocks(revised,f.data,[],now),[]);
 f.data.state.attempts.push(structuredAnswer(f.current,1,now-500));
 revised=reviseChangedPlan(f.plan,changedPlanBlocks(f.plan,f.data,[],now),at,'archive');
 assert.equal(revised.blocks[0].target.stage,'practice','a completed current input stage must not be assigned again');
 assert.deepEqual(revised.blocks[0].target.exerciseIds,[f.current.exercises[2].id]);
 assert.deepEqual(changedPlanBlocks(f.plan,f.data,['coursebook'],now),[],'a completed saved block remains untouched');
 assert.deepEqual(changedPlanBlocks(f.plan,{...f.data,bookLessons:[]},[],now),[],'a failed fetch cannot invent a new chapter');
});

test('structured recovery never offers early transfer or creates completion for an unavailable chapter',async()=>{
 const f=await structuredFixture(),now=Date.parse(at);f.data.state.attempts=currentThroughRevision(f.current,now);
 let changes=changedPlanBlocks(f.plan,f.data,[],now);assert.equal(changes[0].status,'waiting');assert.equal(changes[0].dueAt,now+6*86400000);
 assert.equal(changes.some(actionablePlanChange),false);assert.equal(reviseChangedPlan(f.plan,changes,at,'archive'),f.plan);
 changes=changedPlanBlocks(f.plan,f.data,[],now+6*86400000);assert.equal(changes[0].status,'ready');assert.equal(changes[0].replacement.target.stage,'transfer');
 f.data.state.attempts=currentThroughRevision(f.current,now,8);f.data.state.attempts.push(structuredAnswer(f.current,6,now-1000));
 changes=changedPlanBlocks(f.plan,f.data,[],now);assert.equal(changes[0].status,'unavailable');assert.match(changes[0].message,/уже пройдены/);
 assert.equal(changes.some(actionablePlanChange),false);assert.equal(reviseChangedPlan(f.plan,changes,at,'archive'),f.plan);
});

test('waiting structured blocks show a date without an update button, start suggestion or fake completion',async t=>{
 const source=await structuredFixture(),now=Date.now();source.data.state.attempts=currentThroughRevision(source.current,now);
 const f=await revisionUI(t,source),saved=f.data.state.drafts['planner:day:'+f.today].text;
 try{
 assert.match(f.root.innerHTML,/СЕЙЧАС НЕТ ДОСТУПНОГО ШАГА/);assert.match(f.root.innerHTML,/Следующее применение — с /);assert.match(f.root.innerHTML,/Сегодня выполнять его рано/);
 assert.doesNotMatch(f.root.innerHTML,/Все блоки сегодняшнего плана отмечены/);assert.equal(f.root.querySelector('[data-plan-revise]'),null);
 assert.equal(f.root.querySelector('[data-plan-start]'),null);assert.equal(f.root.querySelector('[data-plan-manual]'),null);
 assert.equal(dailyPlanProgress(f.plan,f.data.state).done,0);assert.equal(f.writes.length,0);assert.equal(f.data.state.drafts['planner:day:'+f.today].text,saved);
 }finally{f.leave();}
});

test('the actual update action replaces a structured block with its available stage and archives the original',async t=>{
 const source=await structuredFixture();source.data.state.attempts=[structuredAnswer(source.current,0,Date.now()-1000)];
 const f=await revisionUI(t,source),saved=JSON.stringify(f.plan);
 try{
 assert.ok(f.root.querySelector('[data-plan-revise]'));await f.root.querySelector('[data-plan-revise]').click();
 assert.equal(f.writes.length,2);assert.equal(f.data.state.drafts[f.writes[0]].text,saved);
 const revised=JSON.parse(f.data.state.drafts['planner:day:'+f.today].text);
 assert.equal(revised.blocks[0].target.kind,'book-study');assert.equal(revised.blocks[0].target.stage,'input');assert.deepEqual(revised.blocks[0].target.exerciseIds,[source.current.exercises[1].id]);
 assert.equal(dailyPlanProgress(revised,f.data.state).done,0);assert.equal(f.root.querySelector('[data-plan-revise]'),null);assert.ok(f.root.querySelector('[data-plan-start]'));
 }finally{f.leave();}
});

test('a blocked structured step cannot put old closing recall ahead of available substantive practice',async t=>{
 const source=await structuredFixture();source.data.state.attempts=currentThroughRevision(source.current,Date.now());
 const chapter=source.plan.blocks[0],closing={...chapter,id:'closing',skill:'review',title:'Recall after practice',target:{kind:'manual',count:1},href:'#/review'},practice={...chapter,id:'substantive',skill:'writing',title:'A real next answer',target:{kind:'attempts',count:1,lessonIds:['free'],exerciseIds:['writing-current']},href:'#/writing'};
 source.plan.blocks=[closing,chapter,practice];const f=await revisionUI(t,source);
 try{assert.equal(f.root.querySelector('[data-plan-start]').dataset.planStart,'substantive');assert.doesNotMatch(f.root.innerHTML,/Все блоки сегодняшнего плана отмечены/);}
 finally{f.leave();}
});

test('historical structured days remain unchanged and show their original saved evidence',async t=>{
 const source=await structuredFixture();source.data.state.attempts=currentThroughRevision(source.current,Date.now());
 const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const past=dateKey(yesterday),historical={...structuredClone(source.plan),day:past};
 source.data.state.drafts['planner:day:'+past]={text:JSON.stringify(historical)};const f=await revisionUI(t,source),before=f.data.state.drafts['planner:day:'+past].text;
 try{
 f.root.querySelectorAll('[data-plan-day]').find(button=>button.dataset.planDay===past).click();
 assert.match(f.root.innerHTML,/ИСТОРИЯ ЗАНЯТИЙ/);assert.doesNotMatch(f.root.innerHTML,/Глава обновилась/);assert.equal(f.root.querySelector('[data-plan-revise]'),null);
 assert.equal(f.writes.length,0);assert.equal(f.data.state.drafts['planner:day:'+past].text,before);
 }finally{f.leave();}
});
