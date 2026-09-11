import test from 'node:test';
import assert from 'node:assert/strict';
import {plannerBookRequests,loadPlannerBookLessons,validDailyPlan,plannerJSON} from '../planner.js';
import {coursebookQueue,coursebookPlanTarget,coursebookTargetEvidence,hasStructuredBookStudy} from '../planner-coursebooks.js';
import {transferTopics,transferQueue,transferExerciseId,transferTargetEvidence} from '../transfer-model.js';
import {createDailyPlan,dailyPlanProgress,weeklySummary} from '../planner-model.js';
import {bookExerciseID} from '../book-reader.js';
import {bookStudyStageIDs,remapBookStudyPlan} from '../book-study-model.js';
import {studyUI} from './study-ui-fixture.mjs';

const NOW=new Date('2026-09-10T09:00:00Z'),TIME=NOW.getTime(),DAY=86400000;
const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const iso=ms=>new Date(ms).toISOString();
function lessonFixture(unit='great-writing-3-3-001'){
 const kinds=['explain','write','rewrite','write','speak','rewrite','write','write','speak'],groups=[['e1'],['e2'],['e3'],['e4','e5'],['e6','e7'],['e8','e9']];
 return{id:'book-'+unit,title:'Prepared writing chapter',level:'B1–B2',provenance:{unitId:unit},sections:[{body:'Private full source pages'}],materials:[{id:'m1',kind:'reading',title:'Model paragraph',text:'The exact source text used for this task.',source:'Original adapted chapter'}],exercises:kinds.map((kind,i)=>({id:'e'+(i+1),kind,prompt:'Produce a complete response for task '+(i+1)+'.',answers:['My own complete example answer.'],explanation:'Explain your choice.',...(i===1?{materialIds:['m1']}:{})})),studyPlan:{stages:bookStudyStageIDs.map((id,i)=>({id,title:id,purpose:'Prepare your own response for '+id+'.',minutes:20,exerciseIds:groups[i]})),revisionExerciseIds:['e6','e7'],transfer:{exerciseIds:['e8','e9'],delayDays:7}}};
}
function sourceData(lesson){
 const unit=lesson.id.slice(5),id=unit.replace(/-\d{3}$/,'');
 return{library:{books:[{id,level:lesson.level,units:[{id:unit,title:lesson.title}]}]},bookStatus:{units:{[unit]:{status:'ready'}}},state:{attempts:[],read:{},drafts:{}},bookLessons:[lesson]};
}
async function versioned(unit){
 const lesson=lessonFixture(unit),before=lesson.exercises,exercises=await Promise.all(before.map(async ex=>({...ex,id:await bookExerciseID(ex,lesson.materials)})));
 return{...lesson,exercises,studyPlan:remapBookStudyPlan(lesson.studyPlan,before,exercises)};
}
const attempt=(lesson,index,time=TIME-1000,overrides={})=>({id:lesson.id+'-a-'+index+'-'+time,lessonId:lesson.id,exerciseId:lesson.exercises[index].id,at:iso(time),answer:'My meaningful independent answer for this situation.',mode:lesson.exercises[index].kind==='speak'?'speaking':'writing',feedback:{verdict:'correct',source:'codex'},...overrides});
const readyForTransfer=(lesson,revisionTime=TIME-8*DAY)=>lesson.exercises.slice(0,7).map((_,i)=>attempt(lesson,i,i<5?revisionTime-DAY+i*1000:revisionTime+(i-5)*1000));

test('request selection bounds new chapters and continues started coursebooks outside the selected level',()=>{
 const books=['clear-speech-3','great-writing-3-3','viewpoint-1'].map(id=>({id,level:'B1–B2',units:Array.from({length:100},(_,i)=>({id:id+'-'+String(i+1).padStart(3,'0')}))}));
 const data={library:{books},bookStatus:{units:Object.fromEntries(books.flatMap(b=>b.units).map(u=>[u.id,{status:'ready'}]))},state:{attempts:[{lessonId:'book-viewpoint-1-088',answer:'My started chapter.'}],drafts:{'book-clear-speech-3-077:e1--0000000000000000':{text:'My unfinished original draft.'}}}};
 assert.deepEqual(plannerBookRequests(data,'B1'),['clear-speech-3-077','viewpoint-1-088','clear-speech-3-001','great-writing-3-3-001','viewpoint-1-001']);
 assert.deepEqual(plannerBookRequests(data,'C2'),['clear-speech-3-077','viewpoint-1-088']);
 data.state.attempts=books.flatMap(b=>b.units.map(u=>({lessonId:'book-'+u.id,answer:'Started'})));
 assert.equal(plannerBookRequests(data,'B1').length,64,'hundreds of chapters must not be fetched just because every chapter has a historical answer');
});

test('loading rich coursebook metadata hashes original materials and keeps the remapped study structure',async t=>{
 const source=lessonFixture(),data=sourceData(source);let live=source;
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>structuredClone(live)}));
 const [loaded]=await loadPlannerBookLessons(data,'B1');
 assert.ok(loaded.studyPlan);assert.equal(loaded.exercises[1].id,await bookExerciseID(source.exercises[1],source.materials));
 assert.equal(loaded.studyPlan.stages[1].exerciseIds[0],loaded.exercises[1].id);
 assert.equal(loaded.materials[0].kind,'reading');assert.equal(loaded.materials[0].text,undefined);assert.equal(loaded.sections,undefined);
 live=structuredClone(source);live.materials[0].text='The source has been meaningfully changed.';
 const [changed]=await loadPlannerBookLessons(data,'B1');assert.notEqual(changed.exercises[1].id,loaded.exercises[1].id);assert.equal(changed.exercises[0].id,loaded.exercises[0].id);
 live.studyPlan.revisionExerciseIds=['stale'];assert.deepEqual(await loadPlannerBookLessons(data,'B1'),[]);
});

test('coursebook queues distinguish due transfer, waiting transfer and the actual next unfinished stage',async()=>{
 const lesson=await versioned(),data=sourceData(lesson);
 data.state.attempts=[attempt(lesson,0,TIME-DAY)];
 let queue=coursebookQueue(data,NOW);assert.equal(queue.ready[0].stage.id,'input');assert.equal(queue.ready[0].skill,'reading');assert.equal(queue.ready[0].exercise.id,lesson.exercises[1].id);
 data.state.attempts=readyForTransfer(lesson,TIME-DAY);queue=coursebookQueue(data,NOW);
 assert.equal(queue.ready.length,0);assert.equal(queue.due.length,0);assert.equal(queue.waiting.length,1);
 data.state.attempts=readyForTransfer(lesson);queue=coursebookQueue(data,NOW);assert.equal(queue.due[0].stage.id,'transfer');assert.match(queue.due[0].href,/\/e8--[a-f0-9]{16}$/);
 data.state.attempts=data.state.attempts.filter(a=>a.exerciseId!==lesson.exercises[0].id);assert.equal(coursebookQueue(data,NOW).due.length,1,'due transfer remains discoverable even when an earlier optional stage was skipped');
});

test('one current coursebook task enters the proper skill block while daily budgets and input/output remain balanced',async()=>{
 const lesson=await versioned(),data=sourceData(lesson);data.state.attempts=[attempt(lesson,0,TIME-DAY)];
 for(const minutes of [30,60,90,120,180]){
  const plan=createDailyPlan(data,{minutes,level:'B1'},NOW),block=plan.blocks.find(b=>b.target.kind==='book-study');
  assert.ok(block);assert.equal(block.skill,'reading');assert.equal(block.target.stage,'input');
  assert.equal(plan.blocks.filter(b=>b.target.kind==='book-study').length,1);
  assert.equal(plan.blocks.some(b=>b.target.kind==='transfer'&&b.target.lessonId===lesson.id),false,'the same chapter does not also start a generic recall cycle');
  assert.equal(plan.blocks.reduce((n,b)=>n+b.minutes,0),minutes);assert.ok(plan.blocks.every(b=>b.minutes>=5));
  assert.ok(plan.blocks.some(b=>['speaking','writing'].includes(b.skill)));assert.ok(plan.blocks.some(b=>['reading','listening'].includes(b.skill)));
  assert.equal(validDailyPlan(plan,dayKey(NOW)),true);assert.doesNotThrow(()=>plannerJSON(plan));
 }
 data.state.attempts=readyForTransfer(lesson,TIME-DAY);
 assert.equal(createDailyPlan(data,{minutes:120},NOW).blocks.some(b=>b.target.kind==='book-study'),false,'a future transfer is never prescribed as today’s work');
 data.studyRoute={version:1,overviewLessonIds:['present'],relations:[{lessonId:'main',kind:'book',id:lesson.id.slice(5),title:'Related chapter',relation:'related'}]};
 data.state.attempts=readyForTransfer(lesson);
 const due=createDailyPlan(data,{minutes:120},NOW).blocks.find(b=>b.target.kind==='book-study');
 assert.equal(due.target.stage,'transfer');assert.match(due.title,/^Практика по главе:/);
 assert.equal(transferQueue(data,NOW).topics.some(topic=>topic.lessonId===lesson.id),false,'the chapter owns its delayed transfer too');
});

test('structured chapters use one automatic practice cycle while generic history and ordinary books remain available',async()=>{
 const lesson=await versioned(),data=sourceData(lesson);data.state.attempts=[attempt(lesson,0,TIME-DAY)];
 const ordinary='grammar-intermediate-003',ordinaryID='book-'+ordinary;
 data.library.books.push({id:'grammar-intermediate',level:'B1–B2',units:[{id:ordinary,title:'Present simple'}]});
 data.state.attempts.push({...attempt(lesson,0,TIME-DAY),id:'ordinary',lessonId:ordinaryID});
 assert.equal(hasStructuredBookStudy(data,lesson.id),true);assert.equal(hasStructuredBookStudy(data,ordinaryID),false);
 assert.deepEqual(transferTopics(data).map(topic=>topic.lessonId).sort(),[lesson.id,ordinaryID].sort(),'direct topic/history access is lossless');
 assert.deepEqual(transferQueue(data,NOW).topics.map(topic=>topic.lessonId),[ordinaryID]);
 const bootstrapOnly={...data,bookLessons:[]};
 assert.equal(hasStructuredBookStudy(bootstrapOnly,lesson.id),true,'registered chapters are recognized before their bounded fetch');
 assert.deepEqual(transferQueue(bootstrapOnly,NOW).topics.map(topic=>topic.lessonId),[ordinaryID]);
 const historical={...attempt(lesson,0,TIME-1000),id:'old-generic-recall',lessonId:'free',exerciseId:transferExerciseId(lesson.id,0,'recall')};
 data.state.attempts.push(historical);const before=JSON.stringify(data.state);
 assert.equal(transferTargetEvidence({lessonId:lesson.id,anchorAt:iso(TIME-DAY),round:0,stage:'recall'},data.state,dayKey(NOW)),1,'a prior generic saved target still reads its own evidence');
 transferQueue(data,NOW);assert.equal(JSON.stringify(data.state),before);
 const custom=await versioned('custom-workshop-001'),loaded=sourceData(custom);
 assert.equal(hasStructuredBookStudy(loaded,custom.id),true,'a validated loaded plan also works without a hardcoded family');
});

test('daily coursebook evidence uses exact version, stage prerequisites, valid day and actual spoken mode',async()=>{
 const lesson=await versioned(),data=sourceData(lesson);data.state.attempts=readyForTransfer(lesson);
 const record=coursebookQueue(data,NOW).due[0],spec=coursebookPlanTarget(record),day=dayKey(NOW);
 const correct=attempt(lesson,7,TIME-1000),state={attempts:[...data.state.attempts,correct]};
 assert.equal(coursebookTargetEvidence(spec,state,day,TIME),1);
 for(const malformed of [null,{kind:'book-study'},{...spec,study:null},{...spec,stage:'unknown'},{...spec,exerciseIds:['unknown']}])assert.equal(coursebookTargetEvidence(malformed,state,day,TIME),0);
 for(const invalidDay of ['2026-02-30','2026-13-10','yesterday'])assert.equal(coursebookTargetEvidence(spec,state,invalidDay,TIME),0);
 assert.equal(coursebookTargetEvidence(spec,state,day,NaN),0);
 for(const overrides of [{exerciseId:'e8--0000000000000000'},{answer:'OK'},{at:iso(TIME+1000)},{feedback:{verdict:'ungraded',source:'offline'}}])assert.equal(coursebookTargetEvidence(spec,{attempts:[...data.state.attempts,{...correct,...overrides}]},day,TIME),0);
 assert.equal(coursebookTargetEvidence(spec,{attempts:[correct]},day,TIME),0,'transfer alone does not establish its prerequisites');
 const futureRevision=readyForTransfer(lesson,TIME-DAY);assert.equal(coursebookTargetEvidence(spec,{attempts:[...futureRevision,correct]},day,TIME),0);
 const plan=createDailyPlan(data,{minutes:120},NOW),saved=JSON.stringify(plan);
 assert.equal(dailyPlanProgress(plan,state).blocks.find(b=>b.targetSpec.kind==='book-study').automatic,true);
 assert.equal(JSON.stringify(plan),saved);
 const spokenRecord={...record,exercise:lesson.exercises[8]},spoken=coursebookPlanTarget(spokenRecord);
 assert.equal(coursebookTargetEvidence(spoken,{attempts:[...data.state.attempts,attempt(lesson,8,TIME-1000,{mode:'writing'})]},day,TIME),0);
 assert.equal(coursebookTargetEvidence(spoken,{attempts:[...data.state.attempts,attempt(lesson,8,TIME-1000,{mode:'speaking'})]},day,TIME),1);
});

test('a historical daily snapshot retains its own task evidence after subsequent source work',async()=>{
 const lesson=await versioned(),data=sourceData(lesson);data.state.attempts=readyForTransfer(lesson);
 const spec=coursebookPlanTarget(coursebookQueue(data,NOW).due[0]),day=dayKey(NOW),submitted=attempt(lesson,7,TIME-1000);
 const state={attempts:[...data.state.attempts,submitted,attempt(lesson,3,TIME+DAY),attempt(lesson,6,TIME+2*DAY,{feedback:{verdict:'incorrect',source:'codex'}})]};
 assert.equal(coursebookTargetEvidence(spec,state,day,TIME+3*DAY),1);
 const frozen=JSON.stringify(spec);coursebookTargetEvidence(spec,state,day,TIME+3*DAY);assert.equal(JSON.stringify(spec),frozen);
});

test('weekly balance credits coursebook listening, writing and speaking without classifying them all as grammar',async()=>{
 const lesson=await versioned('clear-speech-3-001'),data=sourceData(lesson);
 lesson.materials[0].kind='listening';lesson.materials[0].inputSkill='listening';
 data.state.attempts=[attempt(lesson,1,TIME-1000),attempt(lesson,4,TIME-500)];
 const counts=Object.fromEntries(weeklySummary(data,NOW).skills.map(s=>[s.id,s.count]));
 assert.equal(counts.listening,1);assert.equal(counts.writing,1);assert.equal(counts.speaking,1);assert.equal(counts.grammar,0);
 data.state.attempts=[attempt(lesson,4,TIME-500,{mode:'writing'})];
 const typed=Object.fromEntries(weeklySummary(data,NOW).skills.map(s=>[s.id,s.count]));
 assert.equal(typed.speaking,0);assert.equal(typed.writing,1);
});

test('Today loads a live coursebook queue without replacing an already stored daily plan',async t=>{
 const f=await studyUI(t,'planner.js'),lesson=lessonFixture(),data=sourceData(lesson),today=new Date(),day=dayKey(today);
 data.library.books.push({id:'grammar-intermediate',title:'Optional grammar source',level:'B1–B2',units:[{id:'grammar-intermediate-003',title:'A source I started'}]});
 data.bookStatus.units['grammar-intermediate-003']={status:'ready'};data.state.attempts.push({lessonId:'book-grammar-intermediate-003',exerciseId:'e1',answer:'My unfinished source practice.',at:today.toISOString()});
 const existing=createDailyPlan({}, {minutes:120},today),raw=JSON.stringify(existing);data.state.drafts['planner:day:'+day]={text:raw};data.settings={};
 window.addEventListener=()=>{};window.removeEventListener=()=>{};window.dispatchEvent=()=>{};
 t.mock.method(globalThis,'setInterval',()=>1);t.mock.method(globalThis,'clearInterval',()=>{});
 f.api=async()=>({});f.fetch=async path=>({ok:true,json:async()=>path==='/book-content/status.json'?data.bookStatus:lesson});
 await f.module.mountDailyPlanner(f.root,data,async()=>data);
 assert.match(f.root.innerHTML,/УЧЕБНИКИ · ТВОИ ТЕКУЩИЕ ЭТАПЫ/);assert.match(f.root.innerHTML,/Prepared writing chapter/);
 assert.match(f.root.innerHTML,/ПО ЖЕЛАНИЮ · НАЧАТЫЕ ИСТОЧНИКИ/);assert.match(f.root.innerHTML,/A source I started/);
 assert.equal(data.state.drafts['planner:day:'+day].text,raw);assert.equal(f.local.has('planner:day:'+day),false);
});
