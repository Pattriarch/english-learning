import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../lexicon-model.js';
import {studyUI,deferred} from './study-ui-fixture.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const data=()=>({state:{drafts:{},attempts:[]},settings:{provider:'offline'}});
const entry=()=>({id:'same-word',word:'issue',kind:'word',senses:[],contexts:[{id:'same-context',en:'There is an issue with our report.',ru:'В нашем отчёте есть проблема.',productionTask:'Explain a problem with your own report.',explanation:'An issue here means a problem.',targetSpans:[]}]});
// Native SHA-256 is verified separately; resolve immediately in event-order tests.
const modelMock={...model,lexicalPracticeFingerprint:async value=>'test-fingerprint:'+value};
const type=(f,text)=>{const target=f.root.querySelector('#lexicon-answer');target.value=text;target.oninput();return target;};

async function checkedEntry(t){
 const f=await studyUI(t,'lexicon.js',{'lexicon-model':modelMock}),d=data();let active=entry();
 f.api=async(path,body)=>{
  if(path.startsWith('/lexicon/'))return{entry:active,metadata:{}};
  if(path==='/translate')return{front:'Уточнённый перевод.',note:'Новый разбор.'};
  if(path==='/check'){
   const attempt={...body,answer:body.answer.trim(),at:new Date().toISOString(),feedback:{verdict:'correct',summary:'Saved assessment',mistakes:[],alternatives:[]}};
   delete attempt.context;delete attempt.level;d.state.attempts.push(attempt);return attempt;
  }
  return{};
 };
 const mount=async next=>{if(next)active=next;await f.module.mountLexicon(f.root,d,async()=>d,'same-word');await tick();};
 await mount();type(f,'My own answer about an issue.');await f.root.querySelector('#lexicon-check').click();
 return{f,d,mount};
}

test('a debounced search stops before DOM access when the route has changed',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data();let scheduled;
 t.mock.method(globalThis,'setTimeout',fn=>{scheduled=fn;return 1;});t.mock.method(globalThis,'clearTimeout',()=>{});
 f.api=async()=>({items:[],total:0,offset:0,metadata:{words:10188,phrases:36,reviewedEntries:244}});
 await f.module.mountLexicon(f.root,d,async()=>d);
 assert.match(f.root.querySelector('#lexicon-sources').innerHTML,/У 244 статей сохранён редакционный статус/);
 const query=f.root.querySelector('#lexicon-query');query.value='issue';query.oninput({target:query});
 location.hash='#/today';f.root.innerHTML='<h1>Today</h1>';
 await assert.doesNotReject(scheduled());assert.equal(f.requests.length,1);assert.equal(f.root.innerHTML,'<h1>Today</h1>');
});

test('a debounce from an earlier mount cannot query a reopened lexicon',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data();let scheduled;
 t.mock.method(globalThis,'setTimeout',fn=>{scheduled=fn;return 1;});t.mock.method(globalThis,'clearTimeout',()=>{});
 f.api=async()=>({items:[],total:0,offset:0,metadata:{}});
 await f.module.mountLexicon(f.root,d,async()=>d);
 const query=f.root.querySelector('#lexicon-query');query.oninput({target:{value:'old'}});const oldSearch=scheduled;
 await f.module.mountLexicon(f.root,d,async()=>d);await oldSearch();assert.equal(f.requests.length,2);
});

test('a saved source receipt restores feedback after refresh without storing source text in Attempt',async t=>{
 const {f,d,mount}=await checkedEntry(t);const attempt=d.state.attempts[0];
 assert.equal(attempt.context,undefined);assert.equal(attempt.prompt,entry().contexts[0].productionTask);
 const key=model.lexicalFeedbackReceiptKey(attempt.id),receipt=JSON.parse(f.local.get(key));
 assert.equal(receipt.version,1);assert.equal(receipt.attemptId,attempt.id);
 // Simulate successful server persistence and another browser session.
 for(const [draftKey,text]of f.local)d.state.drafts[draftKey]={text};f.local.clear();
 await mount();assert.match(f.root.querySelector('#lexicon-feedback').innerHTML,/Saved assessment/);
 assert.equal(d.state.attempts.length,1);
});

test('stable IDs and the same answer do not restore feedback after a source, task, meaning or level edit',async t=>{
 const {f,d,mount}=await checkedEntry(t),answer=f.root.querySelector('#lexicon-answer').value;
 for(const [field,value]of [['en','The latest issue of our journal is online.'],['productionTask','Describe a new journal issue.'],['ru','Свежий выпуск журнала.'],['explanation','Here issue means a published edition.']]){
  const changed=entry();changed.contexts[0][field]=value;await mount(changed);
  assert.equal(f.root.querySelector('#lexicon-answer').value,answer);assert.equal(f.root.querySelector('#lexicon-feedback').innerHTML,'',field);
 }
 d.state.drafts['planner:preferences']={text:'{"level":"C2"}'};await mount(entry());
 assert.equal(f.root.querySelector('#lexicon-feedback').innerHTML,'');assert.equal(d.state.attempts.length,1);
});

test('legacy attempts without receipts remain in history but never appear as current feedback',async t=>{
 const {f,d,mount}=await checkedEntry(t);f.local.delete(model.lexicalFeedbackReceiptKey(d.state.attempts[0].id));
 await mount();assert.equal(f.root.querySelector('#lexicon-feedback').innerHTML,'');assert.equal(d.state.attempts.length,1);
});

test('translated context gets a fresh request ID instead of relabeling an older assessment',async t=>{
 const {f,d,mount}=await checkedEntry(t);const withoutRU=entry();withoutRU.contexts[0].ru='';await mount(withoutRU);
 await f.root.querySelector('#lexicon-check').click();const before=f.requests.filter(x=>x.path==='/check').at(-1).body;
 await f.root.querySelector('#lexicon-explain').click();await tick();
 assert.equal(f.root.querySelector('#lexicon-feedback').innerHTML,'');await f.root.querySelector('#lexicon-check').click();
 const after=f.requests.filter(x=>x.path==='/check').at(-1).body;
 assert.notEqual(after.id,before.id);assert.notEqual(after.context,before.context);assert.equal(d.state.attempts.length,3);
});

test('a late fingerprint cannot restore old feedback into a newly edited answer',async t=>{
 const wait=deferred(),f=await studyUI(t,'lexicon.js',{'lexicon-model':{...model,lexicalPracticeFingerprint:()=>wait.promise}}),d=data(),e=entry();
 const spec=model.lexicalPracticeSpec(e,e.contexts[0],e.contexts[0].ru,'B1');
 d.state.attempts=[{id:'old',lessonId:'free',exerciseId:spec.exerciseId,prompt:spec.prompt,answer:'Original answer',feedback:{verdict:'correct',summary:'OLD'}}];
 d.state.drafts[model.lexiconAnswerKey(e.id,e.contexts[0].id)]={text:'Original answer'};
 d.state.drafts[model.lexicalFeedbackReceiptKey('old')]={text:JSON.stringify({version:1,attemptId:'old',fingerprint:'sha'})};
 f.api=async()=>({entry:e,metadata:{}});await f.module.mountLexicon(f.root,d,async()=>d,e.id);
 type(f,'New answer');wait.resolve('sha');await tick();assert.equal(f.root.querySelector('#lexicon-feedback').innerHTML,'');
});

test('hashing a submitted context cannot overwrite input typed while hashing is pending',async t=>{
 const wait=deferred(),f=await studyUI(t,'lexicon.js',{'lexicon-model':{...model,lexicalPracticeFingerprint:()=>wait.promise}}),d=data();
 f.api=async(path,body)=>path.startsWith('/lexicon/')?{entry:entry(),metadata:{}}:{...body,feedback:{verdict:'correct',summary:'OLD',mistakes:[],alternatives:[]}};
 await f.module.mountLexicon(f.root,d,async()=>d,'same-word');type(f,'Original answer');
 const pending=f.root.querySelector('#lexicon-check').click();type(f,'Newer answer');wait.resolve('sha');await pending;
 assert.equal(f.local.get(model.lexiconAnswerKey('same-word','same-context')),'Newer answer');
 assert.equal(f.requests.find(x=>x.path==='/check').body.answer,'Original answer');assert.equal(f.root.querySelector('#lexicon-feedback').innerHTML,'');
});

test('fingerprints use all source/task fields and receipts reject missing or mismatched provenance',async()=>{
 const e=entry(),spec=model.lexicalPracticeSpec(e,e.contexts[0],e.contexts[0].ru,'B1'),signature=model.lexicalPracticeSignature(spec),hash=await model.lexicalPracticeFingerprint(signature);
 assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(await model.lexicalPracticeFingerprint(signature),hash);
 for(const key of ['lessonId','exerciseId','level','prompt','context'])assert.notEqual(await model.lexicalPracticeFingerprint(model.lexicalPracticeSignature({...spec,[key]:spec[key]+' changed'})),hash);
 const a={id:'one',lessonId:'free',exerciseId:spec.exerciseId,prompt:spec.prompt,answer:'My answer'},receipt={version:1,attemptId:'one',fingerprint:hash};
 assert.equal(model.lexicalFeedbackMatches(a,' My answer ',spec,hash,JSON.stringify(receipt)),true);
 for(const raw of ['',null,'{',JSON.stringify({...receipt,attemptId:'other'}),JSON.stringify({...receipt,fingerprint:'old'}),JSON.stringify({...receipt,version:0})])assert.equal(model.lexicalFeedbackMatches(a,'My answer',spec,hash,raw),false);
});
