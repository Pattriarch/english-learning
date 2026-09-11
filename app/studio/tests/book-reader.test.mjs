import test from 'node:test';
import assert from 'node:assert/strict';
import {bookParagraphs,bookAttemptState,bookExerciseID} from '../book-reader.js';
import {progressLesson} from '../core.js';
import {studyUI,deferred,bookData} from './study-ui-fixture.mjs';

test('book prose retains paragraph structure and escapes source markup',()=>{
 const html=bookParagraphs('Первый **пример**.\nВторая строка.\n\n<script>alert(1)</script>');
 assert.equal((html.match(/<p>/g)||[]).length,2);
 assert.match(html,/<strong>пример<\/strong>/);
 assert.ok(!html.includes('<script>'));
 assert.match(html,/&lt;script&gt;/);
});

test('a regenerated question receives a new draft and attempt identity',async()=>{
 const exercise={id:'e1',kind:'translate',prompt:'Переведи: я работаю.',context:'Usually',hint:'Consider the meaning.',explanation:'A habit.',answers:['I work.']};
 const original=await bookExerciseID(exercise);
 assert.match(original,/^e1--[a-f0-9]{16}$/);
 assert.equal(await bookExerciseID({...exercise}),original);
 assert.notEqual(await bookExerciseID({...exercise,context:'Right now'}),original);
 assert.notEqual(await bookExerciseID({...exercise,prompt:'Переведи: я учусь.'}),original);
 const lesson={id:'book-grammar-intermediate-003',exercises:[{id:await bookExerciseID({...exercise,context:'Right now'})}]};
 const oldAttempt={lessonId:'free',exerciseId:lesson.id+'-'+original};
 assert.equal(bookAttemptState({attempts:[oldAttempt]},lesson).attempts[0],oldAttempt);
});

test('answers from a running older server remain visible after the upgrade',()=>{
 const lesson={id:'book-grammar-intermediate-003',exercises:[{id:'e1'},{id:'e2'}]};
 const old={lessonId:'free',exerciseId:lesson.id+'-e1',answer:'I am working.'};
 const modern={lessonId:lesson.id,exerciseId:'e2',answer:'She works.'};
 const unrelated={lessonId:'free',exerciseId:'unrelated-e1'};
 const source={attempts:[old,modern,unrelated],drafts:{},read:{}};
 const result=bookAttemptState(source,lesson);
 assert.equal(result.attempts[0].lessonId,lesson.id);
 assert.equal(result.attempts[0].exerciseId,'e1');
 assert.equal(result.attempts[1],modern);
 assert.equal(result.attempts[2],unrelated);
 assert.equal(source.attempts[0].lessonId,'free');
});

test('registered book aliases restore only the exact current hashed task without changing history',async()=>{
 const exercise={id:'e1',kind:'write',prompt:'Describe the current action.',answers:['I am working.']};
 const lesson={id:'book-grammar-intermediate-003',exercises:[{...exercise,id:await bookExerciseID(exercise)}]};
 const alias='book-grammar-intermediate-ebook-003',id=lesson.exercises[0].id;
 const library={books:[{units:[{id:'grammar-intermediate-003'}]},{duplicateOf:'grammar-intermediate',units:[{id:'grammar-intermediate-ebook-003',equivalentUnitId:'grammar-intermediate-003'}]}]};
 const direct=Object.freeze({id:'direct',lessonId:alias,exerciseId:id,answer:'I am working.',mode:'speaking',at:'2026-09-10T10:00:00Z',feedback:{verdict:'correct',source:'codex'}});
 const free=Object.freeze({...direct,id:'free',lessonId:'free',exerciseId:alias+'-'+id});
 const source={attempts:Object.freeze([direct,free]),drafts:{},read:{}},before=JSON.stringify(source);
 const result=bookAttemptState(source,lesson,library);
 assert.equal(progressLesson(lesson,source).tried,0);
 assert.equal(progressLesson(lesson,result).tried,1);
 assert.equal(progressLesson(lesson,result).correct,1);
 assert.deepEqual(result.attempts,[{...direct,lessonId:lesson.id},{...free,lessonId:lesson.id,exerciseId:id}]);
 assert.equal(result.attempts[0].feedback,direct.feedback);
 assert.equal(JSON.stringify(source),before);
 assert.equal(result.drafts,source.drafts);
 assert.deepEqual(bookAttemptState(source,lesson).attempts,source.attempts,'no guessed aliases without catalog evidence');
});

test('aliases cannot recover changed, unversioned, unrelated or merely similar task identities',async()=>{
 const exercise={id:'e1',kind:'write',prompt:'Describe the current action.',answers:['I am working.']};
 const current=await bookExerciseID(exercise),changed=await bookExerciseID({...exercise,prompt:'Describe yesterday.'});
 const lesson={id:'book-canonical-003',exercises:[{...exercise,id:current},{id:'unversioned'}]},alias='book-copy-003';
 const library={books:[{units:[{id:'canonical-003'}]},{duplicateOf:'canonical',units:[{id:'copy-003',equivalentUnitId:'canonical-003'},{id:'other-copy-003',equivalentUnitId:'canonical-004'}]}]};
 const attempts=[
  {lessonId:alias,exerciseId:changed},{lessonId:'free',exerciseId:alias+'-'+changed},
  {lessonId:alias,exerciseId:'e1'},{lessonId:'free',exerciseId:alias+'-e1'},
  {lessonId:alias,exerciseId:'unversioned'},{lessonId:'free',exerciseId:alias+'-unversioned'},
  {lessonId:alias,exerciseId:current.replace('e1--','e2--')},
  {lessonId:'book-canonical-ebook-003',exerciseId:current},
  {lessonId:'book-other-copy-003',exerciseId:current},
  {lessonId:'free',exerciseId:alias+'-'+current+'-extra'},
 ];
 const result=bookAttemptState({attempts},lesson,library);
 result.attempts.forEach((attempt,i)=>assert.equal(attempt,attempts[i]));
 const invalidTarget={books:[{duplicateOf:'another',units:[{id:'canonical-003'}]},library.books[1]]};
 const exact={lessonId:alias,exerciseId:current};
 assert.equal(bookAttemptState({attempts:[exact]},lesson,invalidTarget).attempts[0],exact,'a duplicate target is not a canonical source');
});

for(const protocol of ['book','free'])test(`Reader progress and saved feedback restore the ${protocol} protocol through either catalog route`,async t=>{
 for(const route of ['unit-1','copy-1'])await t.test(route,async t=>{
  const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=bookData(),book=data.library.books[0],unit=book.units[0];
  data.library.books.push({...book,duplicateOf:'canonical-book',units:[{...unit,id:'copy-1',equivalentUnitId:unit.id}]});
  const id=await bookExerciseID(lesson.exercises[0]),alias='book-copy-1';
  data.state.attempts.push({id:'saved-alias',lessonId:protocol==='free'?'free':alias,exerciseId:protocol==='free'?alias+'-'+id:id,answer:'I am working.',feedback:{verdict:'correct',summary:'Restored alias assessment',explanation:'Good.',source:'codex'}});
  const before=JSON.stringify(data.state);location.hash='#/unit/'+route;f.api=async()=>payload;
  await f.module.mountBookUnit(f.root,data,route,async()=>data);
  assert.match(f.root.querySelector('#book-progress').innerHTML,/<strong>1<span> \/ 1<\/span>/);
  f.root.querySelector('#book-start').click();
  assert.equal(f.root.querySelector('#answer').value,'I am working.');
  assert.match(f.root.querySelector('#book-feedback').innerHTML,/Restored alias assessment/);
  assert.equal(JSON.stringify(data.state),before);
 });
});

test('Structured book practice opens its own delayed transfer and keeps that stage locked',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=bookData();
 const kinds=['write','write','rewrite','write','speak','rewrite','write'];
 lesson.exercises=kinds.map((kind,i)=>({...lesson.exercises[0],id:'e'+(i+1),kind,prompt:'Independent task '+(i+1)}));
 const groups=[['e1'],['e2'],['e3'],['e4','e5'],['e6'],['e7']];
 lesson.studyPlan={stages:['diagnostic','input','practice','production','revision','transfer'].map((id,i)=>({id,title:'Stage '+id,purpose:'Practice the target skill.',minutes:10,exerciseIds:groups[i]})),revisionExerciseIds:['e6'],transfer:{exerciseIds:['e7'],delayDays:7}};
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);assert.ok(f.root.querySelector('#answer'));
 assert.doesNotMatch(f.root.querySelector('#book-main').innerHTML,/#\/transfer\//);
 const transfer=f.root.querySelector('#book-transfer-stage');assert.ok(transfer);
 transfer.click();
 assert.match(f.root.querySelector('#book-main').innerHTML,/Independent task 7/);
 assert.match(f.root.querySelector('#book-main').innerHTML,/Сначала заверши исправления/);
 assert.equal(f.root.querySelector('#book-check').disabled,true);
 assert.equal(f.requests.filter(request=>request.path==='/check').length,0);
 assert.match(f.root.querySelector('#book-main').innerHTML,/#\/notebook\/new\/book-unit-1/);
});

test('Legacy book practice retains the generic transfer route',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload}=bookData();
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 assert.match(f.root.querySelector('#book-main').innerHTML,/#\/transfer\/book-unit-1/);
 assert.equal(f.root.querySelector('#book-transfer-stage'),null);
});

test('a legacy lesson still lands on theory and only clean source exercise IDs appear in the step reference',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=bookData();f.api=async()=>payload;
 for(const id of ['e09','custom-task','e09<script>','e09--not-a-version']){
  lesson.exercises[0].id=id;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
  assert.equal(f.root.querySelector('[data-book-tab="theory"]').attrs['aria-pressed'],'true');assert.ok(f.root.querySelector('#book-start'));
  f.root.querySelector('#book-start').click();const html=f.root.querySelector('#book-main').innerHTML;
  assert.match(html,/Шаг 1 из 1/);
  if(id==='e09')assert.match(html,/Шаг 1 из 1 · задание e09<\/div>/);
  else assert.doesNotMatch(html,/· задание /);
  assert.doesNotMatch(html,/задание e09--[a-f0-9]{16}/);
 }
});

test('Versioning preserves double hyphens in a base ID and is stable when applied again',async()=>{
 const exercise={id:'task--one',kind:'write',prompt:'Explain your day.',answers:[]};
 const id=await bookExerciseID(exercise);assert.match(id,/^task--one--[a-f0-9]{16}$/);
 assert.equal(await bookExerciseID({...exercise,id}),id);
});

test('A superseded load of the same unit cannot replace the newer reader',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload}=bookData(),old=deferred();let calls=0;
 f.api=async()=>++calls===1?old.promise:payload;
 const pending=f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 old.resolve({...payload,lesson:{...payload.lesson,title:'Stale lesson'}});await pending;
 assert.match(f.root.innerHTML,/Current lesson/);assert.doesNotMatch(f.root.innerHTML,/Stale lesson/);
});

test('Book examples use current text with Kokoro and invalidate playback after leaving the route',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload}=bookData();
 f.api=async()=>payload;f.fetch=async()=>assert.fail('Old book WAV manifests must not be used');
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);
 const button=f.root.querySelector('[data-example-speak]'),player=f.root.querySelector('#book-model-audio');await button.click();
 assert.deepEqual(f.spoken[0].slice(0,3),['I am working.',.9,'en-US']);assert.equal(f.spoken[0][3].player,player);assert.equal(f.spoken[0][3].isCurrent(),true);
 location.hash='#/today';assert.equal(button.isConnected,true);assert.equal(f.spoken[0][3].isCurrent(),false);
});

test('A saved book assessment restores beside a draft with a trailing newline',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=bookData(),exerciseID=await bookExerciseID(lesson.exercises[0]);
 data.state.drafts[lesson.id+':'+exerciseID]={text:'I am working.\n'};
 data.state.attempts.push({lessonId:lesson.id,exerciseId:exerciseID,answer:'I am working.',feedback:{verdict:'correct',summary:'Saved assessment',explanation:'Good.',source:'reference'}});
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 assert.equal(f.root.querySelector('#answer').value,'I am working.\n');
 assert.match(f.root.querySelector('#book-feedback').innerHTML,/Saved assessment/);
});

test('Returning to a partially answered book continues at the next unanswered exercise',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload,lesson}=bookData();
 lesson.exercises.push({...lesson.exercises[0],id:'e2',prompt:'Explain your plans for tomorrow.'});
 data.state.attempts.push({lessonId:'free',exerciseId:lesson.id+'-'+await bookExerciseID(lesson.exercises[0]),answer:'I am working.',feedback:{verdict:'ungraded'}});
 f.api=async()=>payload;await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 assert.match(f.root.querySelector('#book-main').innerHTML,/Explain your plans for tomorrow/);
 assert.equal(f.root.querySelector('#answer').value,'');
});

test('Book version recovery checks the captured question and never replaces a newer draft',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload}=bookData(),checked=deferred(),received=deferred();
 f.api=async(path,body)=>{if(path.startsWith('/library/'))return payload;if(path==='/check'&&body.lessonId!=='free'){const error=Error('changed');error.status=409;throw error;}if(path==='/check'){received.resolve(body);return checked.promise;}};
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 const target=f.root.querySelector('#answer');target.value='My first answer';target.oninput();
 const pending=f.root.querySelector('#book-check').click(),free=await received.promise;
 assert.equal(free.lessonId,'free');assert.match(free.exerciseId,/^book-unit-1-e1--[a-f0-9]{16}$/);assert.equal(free.prompt,'Explain your day.');assert.match(free.context,/I am working\./);assert.equal(free.mode,'writing');
 target.value='My newer answer';target.oninput();checked.resolve({answer:free.answer,feedback:{verdict:'correct',summary:'Old assessment',explanation:'Good.'}});await pending;
 assert.equal(target.value,'My newer answer');assert.equal(f.root.querySelector('#book-feedback').innerHTML,'');assert.match(f.alerts.at(-1),/предыдущей версии/);
});

test('Failed recording keeps writing mode; editing the transcript of a saved recording retains speaking',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload}=bookData();
 f.api=async(path,body)=>path.startsWith('/library/')?payload:path==='/notebook/audio'?{audio:'a'.repeat(64)+'.webm'}:{answer:body.answer,feedback:{verdict:'correct',summary:'Saved',explanation:'Good.'}};
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 const target=f.root.querySelector('#answer');target.value='Typed answer';target.oninput();
 await f.root.querySelector('#book-voice').click();await f.root.querySelector('#book-check').click();
 assert.equal(f.requests.filter(r=>r.path==='/check').at(-1).body.mode,'writing');
 f.recordOnly=async(_button,_preview,onReady)=>onReady('blob:temporary','audio/webm',new Blob(['audio'],{type:'audio/webm'}));
 await f.root.querySelector('#book-voice').click();await f.root.querySelector('#book-check').click();
 assert.equal(f.requests.filter(r=>r.path==='/check').at(-1).body.mode,'speaking');
 target.value='Edited by hand';target.oninput();await f.root.querySelector('#book-check').click();
 assert.equal(f.requests.filter(r=>r.path==='/check').at(-1).body.mode,'speaking');
});
