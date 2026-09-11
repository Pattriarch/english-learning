import test from 'node:test';
import assert from 'node:assert/strict';
import {bookExerciseID,bookExerciseOrder,bookRecordings} from '../book-reader.js';
import {studyUI,bookData,deferred} from './study-ui-fixture.mjs';

const FILE='a'.repeat(64)+'.webm',OTHER='b'.repeat(64)+'.wav';
const blob=()=>new Blob(['real recorded bytes'],{type:'audio/webm'});
const answer=(f,text)=>{const target=f.root.querySelector('#answer');target.value=text;target.oninput();return target;};
const check=f=>f.requests.filter(r=>r.path==='/check').at(-1)?.body;
const draft=(key,value)=>[key,{text:JSON.stringify(value)}];
const take=(lessonId,exerciseId,file=FILE,at='2026-09-10T12:01:00Z')=>({version:1,lessonId,exerciseId,file,at});

async function mount(t,change=()=>{}){
 const f=await studyUI(t,'book-reader.js'),source=bookData();change(source);
 const {data,payload}=source;
 f.api=async(path,body)=>path.startsWith('/library/')?payload:path==='/notebook/audio'?{audio:FILE}:{...body,at:new Date().toISOString(),feedback:{verdict:'correct',source:'codex',summary:'Saved response.'}};
 f.queueDraft=async(key,text)=>{data.state.drafts[key]={text};};
 f.recordOnly=async(_button,_preview,onReady)=>onReady('blob:temporary','audio/webm',blob());
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start')?.click();
 return {...source,f};
}
function withPlan({lesson}){
 const original=lesson.exercises[0],kinds=['explain','write','write','rewrite','write','speak','rewrite','write','write'];
 lesson.exercises=kinds.map((kind,i)=>({...original,id:'e'+(i+1),kind,prompt:'Current independent task '+(i+1)}));
 const groups=[['e1'],['e9','e3','e2'],['e4'],['e5','e6'],['e7'],['e8']];
 lesson.studyPlan={stages:['diagnostic','input','practice','production','revision','transfer'].map((id,i)=>({id,title:'Stage '+id,purpose:'Independent stage purpose.',minutes:10,exerciseIds:groups[i]})),revisionExerciseIds:['e7'],transfer:{exerciseIds:['e8'],delayDays:7}};
}

test('plan order, not raw storage order, drives navigation across and within stages',async t=>{
 const {f}=await mount(t,withPlan);
 assert.equal(f.root.querySelector('#book-ex-prev').disabled,true);
 f.root.querySelector('#book-ex-next').click();
 assert.match(f.root.querySelector('#book-main').innerHTML,/Current independent task 9/);
 assert.deepEqual(f.root.querySelectorAll('[data-book-exercise]').map(b=>b.dataset.bookExercise),['8','2','1']);
 assert.equal(f.root.querySelector('[data-book-exercise="8"]').attrs['aria-label'],'Задание 2');
 assert.match(f.root.querySelector('#book-main').innerHTML,/Шаг 2 из 9 · задание e9/);
 assert.equal(f.root.querySelector('#book-ex-next').disabled,false,'raw last task is not the planned last task');
 f.root.querySelector('#book-ex-next').click();assert.match(f.root.querySelector('#book-main').innerHTML,/Current independent task 3/);
 f.root.querySelector('#book-ex-prev').click();assert.match(f.root.querySelector('#book-main').innerHTML,/Current independent task 9/);
 f.root.querySelector('[data-book-exercise="1"]').click();f.root.querySelector('#book-ex-next').click();
 assert.match(f.root.querySelector('#book-main').innerHTML,/Current independent task 4/);
 f.root.querySelector('[data-book-stage="transfer"]').click();assert.equal(f.root.querySelector('#book-ex-next').disabled,true);
 f.root.querySelector('#book-ex-prev').click();assert.match(f.root.querySelector('#book-main').innerHTML,/Current independent task 7/);
});

test('order keeps legacy and unlisted exercises reachable without duplicates or guessed IDs',()=>{
 const exercises=['one','two','three','four'].map(id=>({id}));
 assert.deepEqual(bookExerciseOrder({exercises}),[0,1,2,3]);
 assert.deepEqual(bookExerciseOrder({exercises,studyPlan:{stages:[{exerciseIds:['three','one','three','unknown']}]}}),[2,0,1,3]);
});

test('saved audio and corrected spoken provenance survive reload with an exact task identity',async t=>{
 const {f,data,lesson}=await mount(t);
 await f.root.querySelector('#book-voice').click();answer(f,'I REALLY meant this word.');
 const id=await bookExerciseID(lesson.exercises[0]),key=lesson.id+':'+id;
 const records=bookRecordings(data.state.drafts,lesson.id,id);assert.equal(records.length,1);
 assert.equal(records[0].file,FILE);assert.equal(records[0].exerciseId,id);
 assert.equal(f.requests.find(r=>r.path==='/notebook/audio').body.get('file').size,blob().size);
 assert.equal(JSON.parse(data.state.drafts['book-input:'+key].text).recordingKey,records[0].key);
 assert.match(f.root.querySelector('#book-recordings').innerHTML,new RegExp('/media/'+FILE));
 f.local.clear();await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 assert.equal(f.root.querySelector('#answer').value,'I REALLY meant this word.');
 assert.match(f.root.querySelector('#book-recordings').innerHTML,new RegExp('/media/'+FILE));
 answer(f,'I REALLY meant THIS word.');await f.root.querySelector('#book-check').click();
 assert.equal(check(f).mode,'speaking');assert.equal(check(f).exerciseId,id);
});

test('a real recording creates a new submission ID even when its manually prepared transcript is unchanged',async t=>{
 const {f}=await mount(t);answer(f,'The same words in the typed rehearsal.');await f.root.querySelector('#book-check').click();
 const typed=check(f);assert.equal(typed.mode,'writing');
 await f.root.querySelector('#book-voice').click();await f.root.querySelector('#book-check').click();
 assert.equal(check(f).answer,typed.answer);assert.equal(check(f).mode,'speaking');assert.notEqual(check(f).id,typed.id,'the old writing receipt must not be replayed by idempotency');
});

test('a changed exercise cannot inherit old audio, draft mode or a speaking attempt',async t=>{
 const {f,data,lesson}=await mount(t);
 await f.root.querySelector('#book-voice').click();answer(f,'My old spoken answer.');await f.root.querySelector('#book-check').click();
 data.state.attempts.push({...check(f),id:'previous-speaking'});
 const oldID=await bookExerciseID(lesson.exercises[0]);lesson.exercises[0].prompt='A substantively different question.';
 const nextID=await bookExerciseID(lesson.exercises[0]);assert.notEqual(oldID,nextID);
 f.local.clear();await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 assert.equal(f.root.querySelector('#answer').value,'');assert.equal(f.root.querySelector('#book-recordings').innerHTML,'');
 answer(f,'My completely new typed answer.');await f.root.querySelector('#book-check').click();
 assert.equal(check(f).mode,'writing');assert.equal(check(f).exerciseId,nextID);
 assert.equal(bookRecordings(data.state.drafts,lesson.id,oldID).length,1,'old recording remains intact');
});

test('unverified mode flags and unrelated recording or attempt references cannot manufacture speech',async t=>{
 const {f,data,lesson}=await mount(t),id=await bookExerciseID(lesson.exercises[0]),key=lesson.id+':'+id;
 for(const metadata of [
  {version:1,answer:'My typed response.',mode:'speaking'},
  {version:2,answer:'My typed response.',recordingKey:'book-recording:another-task:take',speakingAttemptId:'unknown'},
 ]){
  data.state.drafts[key]={text:'My typed response.'};data.state.drafts['book-input:'+key]={text:JSON.stringify(metadata)};f.local.clear();
  await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
  answer(f,'My typed response, edited.');await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,'writing');
 }
});

test('a known exact speaking attempt preserves transcript editing but invents no recording',async t=>{
 const {f,data,lesson}=await mount(t),id=await bookExerciseID(lesson.exercises[0]);
 data.state.attempts.push({id:'known-speech',lessonId:lesson.id,exerciseId:id,answer:'My existing spoken answer.',mode:'speaking',feedback:{verdict:'ungraded',summary:'Old attempt.'}});
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 answer(f,'My existing SPOKEN answer.');await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,'speaking');
 assert.equal(f.root.querySelector('#book-recordings').innerHTML,'');
});

test('a late upload after leaving saves its old take without touching the newly opened answer',async t=>{
 const {f,data,lesson,payload}=await mount(t,source=>source.lesson.exercises.push({...source.lesson.exercises[0],id:'e2',prompt:'A second independent question.'}));
 const pending=deferred(),received=deferred();f.api=async(path,body)=>{if(path.startsWith('/library/'))return payload;if(path==='/notebook/audio'){received.resolve();return pending.promise;}return {...body,feedback:{verdict:'ungraded',summary:'Saved'}};};
 const operation=f.root.querySelector('#book-voice').click();await received.promise;
 f.root.querySelector('#book-ex-next').click();answer(f,'A typed answer to question two.');
 pending.resolve({audio:FILE});await operation;
 assert.equal(f.root.querySelector('#answer').value,'A typed answer to question two.');assert.equal(f.root.querySelector('#book-recordings').innerHTML,'');
 await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,'writing');
 assert.equal(bookRecordings(data.state.drafts,lesson.id,await bookExerciseID(lesson.exercises[0])).length,1);
 f.root.querySelector('#book-ex-prev').click();assert.match(f.root.querySelector('#book-recordings').innerHTML,new RegExp(FILE));
 assert.ok(f.root.querySelector('[data-book-use-recording]'),'unattached take can be deliberately selected after returning');
});

test('typing during upload keeps writing until the user explicitly chooses the saved take',async t=>{
 const {f,payload}=await mount(t),pending=deferred(),received=deferred();
 f.api=async(path,body)=>{if(path.startsWith('/library/'))return payload;if(path==='/notebook/audio'){received.resolve();return pending.promise;}return {...body,feedback:{verdict:'ungraded',summary:'Saved'}};};
 const operation=f.root.querySelector('#book-voice').click();await received.promise;
 answer(f,'An independently typed response during upload.');pending.resolve({audio:FILE});await operation;
 await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,'writing');
 f.root.querySelector('[data-book-use-recording]').click();answer(f,'The actual transcript of that recording.');await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,'speaking');
});

test('recording metadata rejects mismatched task IDs, invalid files and malformed dates',()=>{
 const lesson='book-unit-1',id='e22--1234567890abcdef',prefix='book-recording:'+lesson+':'+id+':';
 const drafts=Object.fromEntries([
  draft(prefix+'good',take(lesson,id)),draft(prefix+'wrong-task',take(lesson,'e23--1234567890abcdef')),
  draft(prefix+'url',take(lesson,id,'https://example.com/audio.webm')),draft(prefix+'date',take(lesson,id,FILE,'invalid')),
  draft('book-recording:'+lesson+':e22--fedcba0987654321:old',take(lesson,'e22--fedcba0987654321',OTHER)),
 ]);
 assert.deepEqual(bookRecordings(drafts,lesson,id).map(r=>r.key),[prefix+'good']);
});

test('revision replays all dated production takes, including an unsubmitted one, never another version',async t=>{
 const {f,data,lesson}=await mount(t,withPlan),production=lesson.exercises[5],id=await bookExerciseID(production),prefix='book-recording:'+lesson.id+':'+id+':';
 const oldID=await bookExerciseID({...production,prompt:'Obsolete production task.'});
 Object.assign(data.state.drafts,Object.fromEntries([
  draft(prefix+'first',take(lesson.id,id,FILE,'2026-09-09T12:00:00Z')),
  draft(prefix+'second',take(lesson.id,id,OTHER,'2026-09-10T13:10:00Z')),
  draft('book-recording:'+lesson.id+':'+oldID+':old',take(lesson.id,oldID,'c'.repeat(64)+'.webm')),
 ]));
 f.root.querySelector('[data-book-stage="revision"]').click();const html=f.root.querySelector('#book-main').innerHTML;
 assert.match(html,/Current independent task 6/);assert.match(html,new RegExp(FILE));assert.match(html,new RegExp(OTHER));
 assert.match(html,/9 сентября/);assert.match(html,/10 сентября/);assert.match(html,/ответ ещё не отправлен/);
 assert.doesNotMatch(html,new RegExp('c'.repeat(64)));assert.equal(data.state.attempts.length,0);
});

function mockAudioDecoding(t){
 const calls={closed:0};
 const globals={AudioContext:class{async decodeAudioData(){return{duration:1};}async close(){calls.closed++;}},OfflineAudioContext:class{createBufferSource(){return{connect(){},start(){}};}async startRendering(){return{getChannelData:()=>new Float32Array([.2,-.2])};}}};
 for(const [name,value]of Object.entries(globals)){const before=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});t.after(()=>{if(before)Object.defineProperty(globalThis,name,before);else delete globalThis[name];});}
 return calls;
}

test('Whisper receives a WAV while original audio and its corrected ASR transcript persist separately',async t=>{
 const decoding=mockAudioDecoding(t),{f,payload,data,lesson}=await mount(t,source=>{source.data.settings.whisperUrl='http://localhost:9000';});
 f.api=async(path,body)=>path.startsWith('/library/')?payload:path==='/notebook/audio'?{audio:FILE}:path==='/transcribe'?{text:'I really MEANT that word.'}:{...body,feedback:{verdict:'ungraded',summary:'Saved'}};
 await f.root.querySelector('#book-voice').click();assert.equal(f.root.querySelector('#answer').value,'I really MEANT that word.');
 const wav=f.requests.find(r=>r.path==='/transcribe').body.get('file');assert.equal(wav.type,'audio/wav');assert.equal(wav.size,48);assert.equal(decoding.closed,1);
 assert.equal(bookRecordings(data.state.drafts,lesson.id,await bookExerciseID(lesson.exercises[0]))[0].file,FILE,'original upload was not replaced by the ASR conversion');
 answer(f,'I REALLY meant that word.');await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,'speaking');
});

for(const action of ['edit','leave'])test(`late Whisper text never replaces an answer after ${action}`,async t=>{
 mockAudioDecoding(t);const {f,payload,data,lesson}=await mount(t,source=>{source.data.settings.whisperUrl='http://localhost:9000';source.lesson.exercises.push({...source.lesson.exercises[0],id:'e2',prompt:'The next task.'});});
 const pending=deferred(),received=deferred();f.api=async(path,body)=>{if(path.startsWith('/library/'))return payload;if(path==='/notebook/audio')return{audio:FILE};if(path==='/transcribe'){received.resolve();return pending.promise;}return {...body,feedback:{verdict:'ungraded',summary:'Saved'}};};
 const operation=f.root.querySelector('#book-voice').click();await received.promise;
 if(action==='leave')f.root.querySelector('#book-ex-next').click();
 answer(f,'My newer hand-corrected response.');pending.resolve({text:'An older automatic transcript.'});await operation;
 assert.equal(f.root.querySelector('#answer').value,'My newer hand-corrected response.');
 await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,action==='edit'?'speaking':'writing');
 assert.equal(bookRecordings(data.state.drafts,lesson.id,await bookExerciseID(lesson.exercises[0])).length,1);
});

for(const failure of ['error','empty'])test(`Whisper ${failure} retains replayable audio and permits a manual transcript`,async t=>{
 mockAudioDecoding(t);const {f,payload}=await mount(t,source=>{source.data.settings.whisperUrl='http://localhost:9000';});
 f.api=async(path,body)=>{if(path.startsWith('/library/'))return payload;if(path==='/notebook/audio')return{audio:FILE};if(path==='/transcribe'){if(failure==='error')throw Error('Recognition unavailable');return{text:''};}return {...body,feedback:{verdict:'ungraded',summary:'Saved'}};};
 await f.root.querySelector('#book-voice').click();assert.match(f.root.querySelector('#book-recordings').innerHTML,new RegExp(FILE));
 assert.equal(f.root.querySelector('#book-check').disabled,false);assert.doesNotMatch(f.root.querySelector('#book-record-status').textContent,/Распознаём/);
 answer(f,'My own transcript of the recording.');await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,'speaking');
});

test('browser recognition text only becomes spoken after a real recording is saved',async t=>{
 const {f}=await mount(t);let ready,recognition;
 window.SpeechRecognition=class{constructor(){recognition=this;}start(){}stop(){}};
 f.recordOnly=async(button,_preview,onReady,options)=>{assert.equal(options.retainOnLeave,true);button.classList.add('recording');ready=onReady;};
 await f.root.querySelector('#book-voice').click();assert.equal(recognition.lang,'en-US');
 const result=[{transcript:'My spoken browser response.'}];result.isFinal=true;recognition.onresult({resultIndex:0,results:[result]});
 assert.equal(f.root.querySelector('#answer').value,'','recognition alone does not manufacture a spoken response');
 const button=f.root.querySelector('#book-voice');button.classList.remove('recording');await ready('blob:preview','audio/webm',blob());
 assert.equal(f.root.querySelector('#answer').value,'My spoken browser response.');
 answer(f,'My SPOKEN browser response.');await f.root.querySelector('#book-check').click();assert.equal(check(f).mode,'speaking');
});

test('capture end without a ready callback stops browser ASR and restores the typed form',async t=>{
 const {f}=await mount(t);let captureEnd,recognitionStops=0;
 window.SpeechRecognition=class{start(){}stop(){recognitionStops++;}};
 f.recordOnly=async(button,_preview,_ready,options)=>{button.classList.add('recording');captureEnd=options.onCaptureEnd;};
 answer(f,'My independently typed answer.');await f.root.querySelector('#book-voice').click();
 assert.equal(f.root.querySelector('#book-check').disabled,true);await f.root.querySelector('#book-check').click();assert.equal(check(f),undefined);
 f.root.querySelector('#book-voice').classList.remove('recording');captureEnd({reason:'error'});
 assert.equal(recognitionStops,1);assert.equal(f.root.querySelector('#book-check').disabled,false);
 captureEnd({reason:'error'});assert.equal(recognitionStops,1,'the consumer is idempotent as well');await f.root.querySelector('#book-check').click();
 assert.equal(check(f).mode,'writing');assert.equal(f.root.querySelector('#book-recordings').innerHTML,'');
});

test('capture end after navigation stops the old browser recognizer without touching the new editor',async t=>{
 const {f}=await mount(t,source=>source.lesson.exercises.push({...source.lesson.exercises[0],id:'e2',prompt:'The next question.'}));let captureEnd,stops=0;
 window.SpeechRecognition=class{start(){}stop(){stops++;}};
 f.recordOnly=async(button,_preview,_ready,options)=>{button.classList.add('recording');captureEnd=options.onCaptureEnd;};
 await f.root.querySelector('#book-voice').click();f.root.querySelector('#book-ex-next').click();answer(f,'The next typed response.');
 captureEnd({reason:'stopped'});assert.equal(stops,1);assert.equal(f.root.querySelector('#answer').value,'The next typed response.');
 assert.equal(f.root.querySelector('#book-check').disabled,false);assert.equal(f.root.querySelector('#book-record-status').textContent,undefined);
});

test('an upload failure leaves the draft writable with no bogus recording or speaking credit',async t=>{
 const {f,payload}=await mount(t);f.api=async(path,body)=>{if(path.startsWith('/library/'))return payload;if(path==='/notebook/audio')throw Error('Upload unavailable');return {...body,feedback:{verdict:'ungraded',summary:'Saved'}};};
 await f.root.querySelector('#book-voice').click();answer(f,'A typed answer after the failure.');await f.root.querySelector('#book-check').click();
 assert.equal(check(f).mode,'writing');assert.equal(f.root.querySelector('#book-recordings').innerHTML,'');assert.match(f.alerts.at(-1),/Upload unavailable/);
});
