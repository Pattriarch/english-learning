import test from 'node:test';
import assert from 'node:assert/strict';
import {bookParagraphs,bookAttemptState,bookExerciseID} from '../book-reader.js';
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

test('Failed dictation keeps writing mode; a recognized answer alone switches it to speaking',async t=>{
 const f=await studyUI(t,'book-reader.js'),{data,payload}=bookData();
 f.api=async(path,body)=>path.startsWith('/library/')?payload:{answer:body.answer,feedback:{verdict:'correct',summary:'Saved',explanation:'Good.'}};
 await f.module.mountBookUnit(f.root,data,'unit-1',async()=>data);f.root.querySelector('#book-start').click();
 const target=f.root.querySelector('#answer');target.value='Typed answer';target.oninput();
 await f.root.querySelector('#book-voice').click();await f.root.querySelector('#book-check').click();
 assert.equal(f.requests.filter(r=>r.path==='/check').at(-1).body.mode,'writing');
 f.voice=async(_button,answer,_settings,onText)=>{answer.value='Dictated answer';onText();};
 await f.root.querySelector('#book-voice').click();await f.root.querySelector('#book-check').click();
 assert.equal(f.requests.filter(r=>r.path==='/check').at(-1).body.mode,'speaking');
 target.value='Edited by hand';target.oninput();await f.root.querySelector('#book-check').click();
 assert.equal(f.requests.filter(r=>r.path==='/check').at(-1).body.mode,'writing');
});
