import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bookStudyStageIDs,validBookStudyPlan,remapBookStudyPlan,bookStudyTimestamp,bookStudyProgress} from '../book-study-model.js';
import {bookExerciseID} from '../book-reader.js';
import {studyUI,bookData} from './study-ui-fixture.mjs';

const NOW=Date.parse('2026-09-20T12:00:00Z'),DAY=86400000;
const iso=ms=>new Date(ms).toISOString();
const fixture=()=>{
 const {data,payload,lesson}=bookData();
 const kinds=['explain','write','rewrite','write','speak','rewrite','write','write','speak'];
 lesson.exercises=kinds.map((kind,i)=>({id:'e'+(i+1),kind,prompt:'Complete original task '+(i+1)+'.',context:'A different situation.',hint:'Consider the recipient.',explanation:'Preserve the intended meaning.',answers:['My complete original response.']}));
 const groups=[['e1'],['e2'],['e3'],['e4','e5'],['e6','e7'],['e8','e9']];
 lesson.studyPlan={stages:bookStudyStageIDs.map((id,i)=>({id,title:['Диагностика','Входной материал','Практика','Своя речь','Исправления','Перенос'][i],purpose:'Цель самостоятельного этапа '+(i+1)+'.',exerciseIds:groups[i],minutes:10})),revisionExerciseIds:['e6','e7'],transfer:{exerciseIds:['e8','e9'],delayDays:7}};
 return{data,payload,lesson};
};
const attempt=(lesson,index,at,overrides={})=>({id:'a-'+index+'-'+at,lessonId:lesson.id,exerciseId:lesson.exercises[index].id,at:iso(at),answer:'My complete independent answer for this situation.',mode:lesson.exercises[index].kind==='speak'?'speaking':'writing',feedback:{verdict:'correct',source:'codex',summary:'The answer preserves the intended meaning.'},...overrides});
const prepared=(lesson)=>[...Array(5)].map((_,i)=>attempt(lesson,i,NOW-9*DAY+i*1000)).concat([attempt(lesson,5,NOW-8*DAY),attempt(lesson,6,NOW-8*DAY+1000)]);
async function versionedFixture(){
 const f=fixture(),original=f.lesson.exercises;
 f.lesson.exercises=await Promise.all(original.map(async ex=>({...ex,id:await bookExerciseID(ex,f.lesson.materials)})));
 f.lesson.studyPlan=remapBookStudyPlan(f.lesson.studyPlan,original,f.lesson.exercises);return f;
}

test('a new structured lesson opens diagnostic practice before theory while theory remains freely available',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload}=fixture();
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 assert.match(f.root.querySelector('#book-main').innerHTML,/Complete original task 1/);
 assert.equal(f.root.querySelector('[data-book-tab="practice"]').attrs['aria-pressed'],'true');
 assert.equal(f.root.querySelector('#book-start'),null);
 const answer=f.root.querySelector('#answer');answer.value='My own baseline answer.';answer.oninput();
 f.root.querySelector('[data-book-tab="theory"]').click();assert.ok(f.root.querySelector('#book-start'));
 f.root.querySelector('[data-book-tab="practice"]').click();assert.equal(f.root.querySelector('#answer').value,'My own baseline answer.');
 assert.equal(data.state.attempts.length,0,'opening theory or entering a draft does not complete diagnostic work');
});

test('unfinished diagnostic resumes its next planned current task; completing it restores the normal theory landing',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=fixture();
 lesson.exercises.push({...lesson.exercises[0],id:'e10',prompt:'Second independent baseline task.'});
 lesson.studyPlan.stages[0].exerciseIds.push('e10');
 data.state.read[lesson.id]=iso(NOW);
 data.state.attempts=[{id:'baseline-1',lessonId:lesson.id,exerciseId:await bookExerciseID(lesson.exercises[0]),answer:'My first independent baseline answer.',mode:'writing',at:iso(NOW-2000),feedback:{verdict:'ungraded',summary:'Saved baseline.'}}];
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 assert.match(f.root.querySelector('#book-main').innerHTML,/Second independent baseline task/);
 assert.match(f.root.querySelector('#book-main').innerHTML,/Шаг 2 из 10 · задание e10/);
 assert.equal(f.root.querySelector('[data-book-tab="practice"]').attrs['aria-pressed'],'true');
 data.state.attempts.push({...data.state.attempts[0],id:'baseline-10',exerciseId:await bookExerciseID(lesson.exercises[9]),at:iso(NOW-1000)});
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 assert.ok(f.root.querySelector('#book-start'));assert.equal(f.root.querySelector('[data-book-tab="theory"]').attrs['aria-pressed'],'true');
});

test('material-aware hashes preserve the exact legacy identity and bind only selected sources in lesson order',async()=>{
 const exercise={id:'task--one',kind:'write',prompt:'Explain the chart.',context:'To a colleague.',hint:'Use the figures.',explanation:'Describe the change.',answers:['A complete answer.'],materialIds:['second','first']};
 const first={id:'first',title:'Chart',kind:'reading',text:'June: 40%.',source:'Original chart',sourceUrl:'https://example.org/chart',figure:{id:'chart',format:'svg',alt:'A chart',caption:'Independent samples'}},second={id:'second',title:'Interview',kind:'listening',text:'An original transcript.',source:'Course recording',audioFile:'/book-recordings/course-track-01.mp3',inputSkill:'listening'};
 const materials=[first,{id:'unused',text:'Unused secret reference'},second];
 const legacyText=[exercise.kind,exercise.prompt,exercise.context,exercise.hint,exercise.explanation,exercise.answers.join('\u001e')].join('\u001f');
 const legacy='task--one--'+createHash('sha256').update(legacyText).digest('hex').slice(0,16);
 assert.equal(await bookExerciseID({...exercise,materialIds:[]},materials),legacy);
 assert.equal(await bookExerciseID(exercise,[]),legacy);
 const selected=[first,second].map(m=>[m.id,m.title,m.kind,m.text,m.source,m.sourceUrl,m.audioFile,m.inputSkill,m.figure?.id,m.figure?.format,m.figure?.alt,m.figure?.caption].map(v=>v??'').join('\u001d')).join('\u001e');
 const expected='task--one--'+createHash('sha256').update(legacyText+'\u001fmaterials-v1\u001f'+selected).digest('hex').slice(0,16);
 assert.equal(await bookExerciseID(exercise,materials),expected);
 assert.equal(await bookExerciseID({...exercise,materialIds:['first','second']},materials),expected);
 assert.equal(await bookExerciseID(exercise,[first,{id:'unused',text:'Changed unrelated content'},second]),expected);
 assert.equal(await bookExerciseID({...exercise,id:expected},materials),expected);
 assert.notEqual(await bookExerciseID(exercise,[second,first]),expected);
 for(const field of ['id','title','kind','text','source','sourceUrl','audioFile','inputSkill']){
  const changed={...first,[field]:(first[field]||'')+' changed'};
  assert.notEqual(await bookExerciseID(exercise,[changed,second]),expected,field);
 }
 for(const field of ['id','format','alt','caption'])assert.notEqual(await bookExerciseID(exercise,[{...first,figure:{...first.figure,[field]:first.figure[field]+' changed'}},second]),expected,'figure.'+field);
});

test('study-plan remapping links every authored stage to the current exercise and rejects unsafe mappings',async()=>{
 const {lesson}=fixture(),before=structuredClone(lesson),exercises=await Promise.all(lesson.exercises.map(async ex=>({...ex,id:await bookExerciseID(ex)})));
 const plan=remapBookStudyPlan(lesson.studyPlan,lesson.exercises,exercises);
 assert.equal(validBookStudyPlan(plan,exercises),true);
 assert.deepEqual(plan.revisionExerciseIds,exercises.slice(5,7).map(ex=>ex.id));
 assert.deepEqual(plan.transfer.exerciseIds,exercises.slice(7).map(ex=>ex.id));
 assert.deepEqual(lesson,before);
 assert.equal(remapBookStudyPlan({...lesson.studyPlan,revisionExerciseIds:['stale']},lesson.exercises,exercises),null);
 for(const change of [
  p=>p.stages.reverse(),p=>p.stages[0].exerciseIds.push('missing'),p=>p.stages[0].exerciseIds.push('e2'),
  p=>p.stages[0].exerciseIds.splice(0),p=>p.transfer.delayDays=6,p=>p.transfer.delayDays=61,
 ]){const malformed=structuredClone(lesson.studyPlan);change(malformed);assert.equal(remapBookStudyPlan(malformed,lesson.exercises,exercises),null);}
});

test('stage evidence ignores read flags, time, short replies, stale versions, invalid dates and typed speaking',()=>{
 const {lesson}=fixture(),empty={attempts:[],read:{[lesson.id]:iso(NOW)},drafts:{elapsed:{text:'999999'}}};
 assert.equal(bookStudyProgress(lesson,empty,NOW).completed,0);
 for(const overrides of [
  {answer:'OK'},{answer:' . .. '},{exerciseId:'e1--stale'},{lessonId:'another-book'},
  {at:'2026-02-30T12:00:00Z'},{at:'yesterday'},{at:iso(NOW+1)},
 ])assert.equal(bookStudyProgress(lesson,{attempts:[attempt(lesson,0,NOW-1000,overrides)]},NOW).completed,0,JSON.stringify(overrides));
 const first=attempt(lesson,0,NOW-1000,{feedback:{verdict:'ungraded',source:'offline'}});
 assert.equal(bookStudyProgress(lesson,{attempts:[first]},NOW).completed,1,'initial work records submitted practice, not mastery');
 const typed=attempt(lesson,4,NOW-1000,{mode:'writing'});
 assert.equal(bookStudyProgress(lesson,{attempts:[typed]},NOW).completed,0);
 assert.equal(bookStudyProgress(lesson,{attempts:[{...typed,mode:'speaking'}]},NOW).completed,1);
 for(const invalid of ['2026-01-01','2026-13-01T00:00:00Z','2026-09-20T25:00:00Z','2026-09-20T12:00:00+01:99'])assert.equal(bookStudyTimestamp(invalid,NOW),null);
});

test('revision requires all production outputs and later correct assessed answers before starting the delay',()=>{
 const {lesson}=fixture(),attempts=prepared(lesson);
 const good=bookStudyProgress(lesson,{attempts},NOW);
 assert.equal(good.produced,true);assert.equal(good.revisionComplete,true);assert.equal(good.dueAt,NOW-DAY+1000);
 for(const mutate of [
  list=>list.splice(4,1),list=>list[4].mode='writing',list=>list[5].at=list[4].at,
  list=>list[5].feedback.verdict='partial',list=>list[5].feedback.source='reference',
  list=>list[6].at=iso(NOW+DAY),list=>list[3].at=iso(NOW-7*DAY),
 ]){const changed=structuredClone(attempts);mutate(changed);const result=bookStudyProgress(lesson,{attempts:changed},NOW);assert.equal(result.revisionComplete,false);assert.equal(result.dueAt,null);}
 const before=structuredClone(attempts);bookStudyProgress(lesson,{attempts:Object.freeze(attempts.map(Object.freeze))},NOW);assert.deepEqual(attempts,before);
});

test('early transfer never gains credit later, while exact-boundary independent work can complete the plan',()=>{
 const {lesson}=fixture(),base=prepared(lesson),due=NOW-DAY+1000;
 const early=[...base,attempt(lesson,7,due-1),attempt(lesson,8,due-1)];
 assert.equal(bookStudyProgress(lesson,{attempts:early},NOW).stages[5].completed,0);
 const exact=[...base,attempt(lesson,7,due),attempt(lesson,8,due)];
 assert.equal(bookStudyProgress(lesson,{attempts:exact},due-1).transferReady,false);
 assert.equal(bookStudyProgress(lesson,{attempts:exact},due).complete,true);
 const partial=structuredClone(exact);partial.at(-1).feedback.verdict='partial';
 assert.equal(bookStudyProgress(lesson,{attempts:partial},NOW).complete,false);
 const newerWrong=attempt(lesson,6,NOW-1000,{feedback:{verdict:'incorrect',source:'codex'}});
 assert.equal(bookStudyProgress(lesson,{attempts:[...exact,newerWrong]},NOW).dueAt,null,'an obsolete correct revision cannot override newer unresolved work');
});

test('legacy free-answer attempts only count when their complete versioned identity still matches',async()=>{
 const {lesson}=await versionedFixture(),a=attempt(lesson,0,NOW-1000);
 const legacy={...a,lessonId:'free',exerciseId:lesson.id+'-'+a.exerciseId};
 assert.equal(bookStudyProgress(lesson,{attempts:[legacy]},NOW).completed,1);
 assert.equal(bookStudyProgress(lesson,{attempts:[{...legacy,exerciseId:legacy.exerciseId.replace(/--[a-f0-9]{16}$/,'--0000000000000000')}]},NOW).completed,0);
});

test('book reader mounts only current exercise materials, with original audio and a hidden transcript',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=fixture();
 lesson.materials=[{id:'input',kind:'listening',title:'Original classroom track',text:'Complete original transcript.',source:'Clear Speech',audioFile:'/book-recordings/clear-speech-track-01.mp3',inputSkill:'listening'},{id:'later',kind:'reading',title:'Later source',text:'A later task-specific surprise.'}];
 lesson.exercises[0].materialIds=['input'];lesson.exercises[1].materialIds=['later'];
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 assert.ok(f.root.querySelector('#answer'),'new structured lessons open the diagnostic task directly');
 const materials=f.root.querySelector('#book-task-materials');
 assert.match(materials.innerHTML,/clear-speech-track-01\.mp3/);
 assert.match(materials.innerHTML,/data-material-text="0" hidden/);
 assert.doesNotMatch(materials.innerHTML,/later task-specific surprise|data-material-play/);
 f.root.querySelector('[data-book-stage="input"]').click();
 assert.match(f.root.querySelector('#book-task-materials').innerHTML,/later task-specific surprise/);
 assert.doesNotMatch(f.root.querySelector('#book-task-materials').innerHTML,/clear-speech-track/);
});

test('revision shows own current production answers, and premature transfer permits a draft but not checking',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=await versionedFixture();
 data.state.attempts=prepared(lesson).slice(0,5);
 data.state.attempts[3].answer='My actual original <proposal> needs improvement.';
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 f.root.querySelector('[data-book-stage="revision"]').click();
 assert.match(f.root.querySelector('#book-main').innerHTML,/My actual original &lt;proposal&gt; needs improvement/);
 assert.doesNotMatch(f.root.querySelector('#book-main').innerHTML,/<proposal>/);
 f.root.querySelector('[data-book-stage="transfer"]').click();
 const button=f.root.querySelector('#book-check');assert.equal(button.disabled,true);
 const answer=f.root.querySelector('#answer');answer.value='My early draft for the future task.';answer.oninput();
 await button.click();assert.equal(f.requests.filter(r=>r.path==='/check').length,0);
 assert.ok([...f.local.values()].includes(answer.value));
 assert.match(f.root.querySelector('#book-main').innerHTML,/через 7 дней/);
});

test('a planner deep link opens the exact current task and its stage without falling back to the first task',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=await versionedFixture();
 location.hash='#/unit/unit-1/'+lesson.exercises[4].id;
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 assert.match(f.root.querySelector('#book-main').innerHTML,/Complete original task 5/);
 assert.ok(f.root.querySelector('[data-book-exercise="4"]'));
 assert.equal(f.root.querySelector('[data-book-exercise="0"]'),null);
 assert.ok(f.root.querySelector('#book-check'));
});

test('the due date unlocks transfer checking and confirmed results survive a stale refresh',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=await versionedFixture();
 data.state.attempts=prepared(lesson);
 f.api=async(path,body)=>path.startsWith('/library/')?payload:{...body,at:iso(NOW),feedback:{verdict:'correct',source:'codex',summary:'Confirmed transfer.'}};
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 f.root.querySelector('[data-book-stage="transfer"]').click();
 assert.equal(f.root.querySelector('#book-check').disabled,false);
 const answer=f.root.querySelector('#answer');answer.value='An independent answer in another context.';answer.oninput();
 await f.root.querySelector('#book-check').click();
 assert.match(f.root.querySelector('#book-feedback').innerHTML,/Confirmed transfer/);
 assert.match(f.root.querySelector('#book-study-plan').innerHTML,/8 из 9 заданий/);
});

test('saved spoken draft provenance survives leaving an exercise and correcting its transcript',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload}=fixture();
 f.api=async(path,body)=>path.startsWith('/library/')?payload:path==='/notebook/audio'?{audio:'a'.repeat(64)+'.webm'}:{...body,at:iso(NOW),feedback:{verdict:'correct',source:'codex',summary:'Saved'}};
 f.recordOnly=async(_button,_preview,onReady)=>onReady('blob:temporary','audio/webm',new Blob(['audio'],{type:'audio/webm'}));
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('[data-book-stage="production"]').click();
 f.root.querySelector('[data-book-exercise="4"]').click();await f.root.querySelector('#book-voice').click();
 let transcript=f.root.querySelector('#answer');transcript.value='My original answer from the microphone.';transcript.oninput();
 f.root.querySelector('[data-book-stage="input"]').click();f.root.querySelector('[data-book-stage="production"]').click();f.root.querySelector('[data-book-exercise="4"]').click();
 await f.root.querySelector('#book-check').click();assert.equal(f.requests.filter(r=>r.path==='/check').at(-1).body.mode,'speaking');
 const target=f.root.querySelector('#answer');target.value='This answer was edited by hand.';target.oninput();await f.root.querySelector('#book-check').click();
 assert.equal(f.requests.filter(r=>r.path==='/check').at(-1).body.mode,'speaking');
});
