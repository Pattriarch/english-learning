import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI,deferred} from './study-ui-fixture.mjs';

const data=()=>({state:{drafts:{},attempts:[],read:{}},settings:{provider:'offline'}});
const result=english=>({english,explanation:'Пояснение смысла и регистра.',phrases:[{english:'Thanks',russian:'Спасибо'}],alternative:'Thank you.',practice:'Поблагодари за другую помощь.'});
const type=(f,id,value)=>{const field=f.root.querySelector(id);field.value=value;field.oninput({target:field});return field;};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a late translation preserves newly edited Russian and personal English',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data(),pending=deferred();f.api=async path=>path==='/notebook/translate'?pending.promise:{};
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Спасибо за помощь.');
 const work=f.root.querySelector('#notebook-translate').click();await tick();
 type(f,'#notebook-russian','Спасибо за совет.');type(f,'#notebook-own','Thanks for the advice.');
 pending.resolve(result('Thanks for your help.'));await work;
 assert.equal(f.root.querySelector('#notebook-russian').value,'Спасибо за совет.');
 assert.equal(f.root.querySelector('#notebook-own').value,'Thanks for the advice.');
 assert.doesNotMatch(f.root.querySelector('#notebook-result').innerHTML,/Thanks for your help/);
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');
 assert.match(f.root.querySelector('#notebook-result').innerHTML,/перевод предыдущей версии/);
});

test('a slower old request cannot replace a newer translation after reopening',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data(),old=deferred();let count=0;
 f.api=async path=>path==='/notebook/translate'?(++count===1?old.promise:result('Thanks for the advice.')):{};
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Спасибо за помощь.');
 const pending=f.root.querySelector('#notebook-translate').click();await tick();
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Спасибо за совет.');await f.root.querySelector('#notebook-translate').click();
 old.resolve(result('Thanks for your help.'));await pending;
 assert.equal(JSON.parse(f.local.get('notebook:result:note-a')).english,'Thanks for the advice.');
 assert.match(f.root.querySelector('#notebook-result').innerHTML,/Thanks for the advice/);
});

test('reveal is optional and generated markup is escaped',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data();f.api=async()=>result('Thanks <script>alert(1)</script>');
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Спасибо.');await f.root.querySelector('#notebook-translate').click();
 assert.match(f.root.querySelector('#notebook-result').innerHTML,/&lt;script&gt;/);
 await f.root.querySelector('#notebook-reveal').click();assert.ok(f.root.querySelector('#notebook-model').hidden);
 assert.equal(f.requests.filter(r=>r.path==='/check'||r.path==='/cards').length,0);
});

test('canceling dictation does not turn a typed answer into speaking evidence',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data();f.api=async()=>({feedback:{verdict:'ungraded',summary:'Без оценки',mistakes:[],alternatives:[]}});
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Я пока не разобрался.');type(f,'#notebook-own',"I haven't figured it out yet.");
 await f.root.querySelector('#notebook-dictate').click();await f.root.querySelector('#notebook-check').click();
 assert.equal(f.requests.find(r=>r.path==='/check').body.mode,'writing');
});

test('translation captures its payload before draft persistence waits',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data(),saving=deferred(),started=deferred();let pause=true;
 f.api=async()=>result('Thanks for your help.');
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Спасибо за помощь.');
 f.queueDraft=async(key,_text,immediate)=>{if(key==='notebook:entry:note-a'&&immediate&&pause){pause=false;started.resolve();return saving.promise;}};
 const pending=f.root.querySelector('#notebook-translate').click();await started.promise;
 type(f,'#notebook-russian','Спасибо за совет.');type(f,'#notebook-context','Другая ситуация');saving.resolve();await pending;
 const request=f.requests.find(r=>r.path==='/notebook/translate');
 assert.equal(request.body.russian,'Спасибо за помощь.');assert.equal(request.body.context,'');
 assert.equal(f.root.querySelector('#notebook-russian').value,'Спасибо за совет.');
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');assert.match(f.root.querySelector('#notebook-result').innerHTML,/перевод предыдущей версии/);
});

test('assessment captures request ID and input mode before saving and does not consume a later revision ID',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data(),saving=deferred(),started=deferred(),answer=deferred(),sent=deferred();let pause=true;
 f.api=async path=>{if(path==='/check'){sent.resolve();return answer.promise;}return{};};
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Я разобрался.');type(f,'#notebook-own','I figured it out.');
 f.queueDraft=async(key,_text,immediate)=>{if(key==='notebook:entry:note-a'&&immediate&&pause){pause=false;started.resolve();return saving.promise;}};
 const pending=f.root.querySelector('#notebook-check').click();await started.promise;
 f.voice=async(_button,target,_settings,onText)=>{target.value='My later spoken answer.';onText();};await f.root.querySelector('#notebook-dictate').click();
 saving.resolve();await sent.promise;
 const old=f.requests.find(r=>r.path==='/check').body;assert.equal(old.answer,'I figured it out.');assert.equal(old.mode,'writing');assert.equal(old.id,'request-3-recall');
 type(f,'#notebook-own','My next written answer.');
 answer.resolve({feedback:{verdict:'correct',summary:'Old result',mistakes:[],alternatives:[]}});await pending;
 await f.root.querySelector('#notebook-check').click();
 assert.equal(f.requests.filter(r=>r.path==='/check')[1].body.id,'request-5-recall');
});

test('an old mount cannot paint a reopened note even when the entry ID matches',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data(),response=deferred();f.api=async()=>response.promise;
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Спасибо за помощь.');
 const pending=f.root.querySelector('#notebook-translate').click();await tick();
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Новая мысль после возвращения.');
 response.resolve(result('Thanks for your help.'));await pending;
 assert.doesNotMatch(f.root.querySelector('#notebook-result').innerHTML,/Thanks for your help/);
 assert.equal(f.root.querySelector('#notebook-russian').value,'Новая мысль после возвращения.');
});

test('a recorder that ends without onReady does not leave the notebook stuck recording',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data();let starts=0;
 f.recordOnly=async button=>{starts++;button.classList.add('recording');};
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');const button=f.root.querySelector('#notebook-record');
 await button.click();assert.equal(starts,1);
 // An asynchronous MediaRecorder error/no-data stop removes the real class.
 button.classList.remove('recording');await button.click();assert.equal(starts,2);
});

test('late recording upload keeps captured context but never replaces a reopened draft',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data(),upload=deferred(),sent=deferred();let ready;
 f.recordOnly=async(_button,_preview,onReady,options)=>{assert.equal(options.retainOnLeave,true);ready=onReady;};
 f.api=async path=>{if(path==='/notebook/audio'){sent.resolve();return upload.promise;}return{};};
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Первая мысль.');type(f,'#notebook-own','The original spoken thought.');await f.root.querySelector('#notebook-record').click();
 const pending=ready('','audio/webm',new Blob(['saved audio'],{type:'audio/webm'}));await sent.promise;
 f.module.mountNotebook(f.root,d,async()=>d,'note-b');f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Новый черновик.');type(f,'#notebook-own','A newer written thought.');
 upload.resolve({audio:'a'.repeat(64)+'.webm'});await pending;
 const entry=JSON.parse(f.local.get('notebook:entry:note-a'));assert.equal(entry.russian,'Новый черновик.');assert.equal(entry.ownEnglish,'A newer written thought.');
 const recording=JSON.parse([...f.local].find(([key])=>key.startsWith('notebook:recording:'))[1]);assert.equal(recording.entryId,'note-a');assert.equal(recording.text,'The original spoken thought.');assert.equal(recording.kind,'own');
});

test('a voice-only note exists before the recording starts and receives its audio after unmount',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data();let ready;
 f.recordOnly=async(_button,_preview,onReady,options)=>{assert.ok(f.local.has('notebook:entry:voice-only'));assert.equal(options.retainOnLeave,true);ready=onReady;};
 f.api=async()=>({audio:'b'.repeat(64)+'.webm'});
 f.module.mountNotebook(f.root,d,async()=>d,'voice-only');await f.root.querySelector('#notebook-record').click();
 f.module.mountNotebook(f.root,d,async()=>d,'another');await ready('','audio/webm',new Blob(['audio']));
 const recording=JSON.parse([...f.local].find(([key])=>key.startsWith('notebook:recording:'))[1]);assert.equal(recording.entryId,'voice-only');
 assert.equal(f.root.querySelector('#notebook-russian').dataset.entry,'another');
});

test('recall and application can be checked concurrently without sharing an idempotency ID',async t=>{
 const f=await studyUI(t,'notebook.js'),d=data(),response=deferred();
 f.api=async path=>path==='/notebook/translate'?result('Thanks for your help.'):response.promise;
 f.module.mountNotebook(f.root,d,async()=>d,'note-a');type(f,'#notebook-russian','Спасибо за помощь.');await f.root.querySelector('#notebook-translate').click();
 type(f,'#notebook-own','Thank you for your help.');type(f,'#notebook-practice','Thanks for the advice.');
 const recall=f.root.querySelector('#notebook-check').click(),application=f.root.querySelector('#notebook-check-practice').click();await tick();
 const checks=f.requests.filter(r=>r.path==='/check');assert.equal(checks.length,2);assert.notEqual(checks[0].body.id,checks[1].body.id);assert.notEqual(checks[0].body.exerciseId,checks[1].body.exerciseId);
 response.resolve({feedback:{verdict:'correct',summary:'Done',mistakes:[],alternatives:[]}});await Promise.all([recall,application]);
});
