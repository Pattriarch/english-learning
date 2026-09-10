import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI,deferred} from './study-ui-fixture.mjs';
import {transferExerciseId,transferAnswerKey,transferProgress,transferTopics} from '../transfer-model.js';

const lesson={id:'test-transfer',title:'Clear contrast',level:'B2',goal:'Explain the choice.',formula:'State a contrast clearly.',sections:[{title:'Meaning',body:'Different forms change the intended meaning.'}],exercises:[{id:'e1',kind:'write'}]};
function state(){return{drafts:{},attempts:[{id:'seed',lessonId:lesson.id,exerciseId:'e1',answer:'I explained my own complete example clearly.',at:new Date(Date.now()-3600000).toISOString(),mode:'writing',feedback:{verdict:'correct'}}]};}
function response(payload,extra={}){return{...payload,at:new Date().toISOString(),feedback:{verdict:'correct',summary:'Saved',explanation:'Meaning is clear.',mistakes:[]},...extra};}
async function fixture(t){
 const f=await studyUI(t,'transfer.js');const events=new Map();window.addEventListener=(name,fn)=>{events.set(name,fn);};window.removeEventListener=(name,fn)=>{if(events.get(name)===fn)events.delete(name);};window.dispatchEvent=()=>{};
 if(!globalThis.CustomEvent){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'CustomEvent');Object.defineProperty(globalThis,'CustomEvent',{configurable:true,writable:true,value:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}});t.after(()=>descriptor?Object.defineProperty(globalThis,'CustomEvent',descriptor):delete globalThis.CustomEvent);}
 location.hash='#/transfer/'+lesson.id;f.data={lessons:[lesson],settings:{},state:state()};f.refresh=async()=>f.data;return f;
}
test('late check keeps the captured prompt and cannot erase a newer draft',async t=>{
 const f=await fixture(t);await f.module.mountTransfer(f.root,f.data,f.refresh,lesson.id);
 const target=f.root.querySelector('#transfer-answer');target.value='My first complete explanation with two original examples.';target.oninput();
 const pending=deferred();f.api=()=>pending.promise;
 const check=f.root.querySelector('#transfer-check').click();await new Promise(resolve=>setImmediate(resolve));
 const payload=f.requests.at(-1).body;assert.match(payload.exerciseId,/-r0-recall$/);assert.match(payload.prompt,/Without opening your notes/);
 target.value='My newer explanation must remain in this draft.';target.oninput();pending.resolve(response(payload));await check;
 assert.equal(target.value,'My newer explanation must remain in this draft.');assert.equal(f.root.querySelector('#transfer-feedback').innerHTML,'');assert.ok(f.alerts.some(a=>a.includes('предыдущей версии')));
 assert.equal(f.local.get(transferAnswerKey(lesson.id,0,'recall')),target.value);
});
test('navigation during checking does not render a result on another screen',async t=>{
 const f=await fixture(t);await f.module.mountTransfer(f.root,f.data,f.refresh,lesson.id);
 const target=f.root.querySelector('#transfer-answer');target.value='An original complete reply for the saved topic.';target.oninput();const pending=deferred();f.api=()=>pending.promise;
 const check=f.root.querySelector('#transfer-check').click();await new Promise(resolve=>setImmediate(resolve));const payload=f.requests.at(-1).body;
 location.hash='#/today';f.root.innerHTML='<h1 id="new-page">Today</h1>';pending.resolve(response(payload));await check;
 assert.ok(f.root.querySelector('#new-page'));assert.equal(f.root.querySelector('#transfer-feedback'),null);
});
test('cancelled microphone keeps a typed answer as writing, including after reload',async t=>{
 const f=await fixture(t);await f.module.mountTransfer(f.root,f.data,f.refresh,lesson.id);
 const target=f.root.querySelector('#transfer-answer');target.value='A written explanation with examples about the topic.';target.oninput();
 await f.root.querySelector('#transfer-voice').click();f.api=async(_path,payload)=>response(payload);
 await f.root.querySelector('#transfer-check').click();assert.equal(f.requests.at(-1).body.mode,'writing');
 await f.module.mountTransfer(f.root,f.data,f.refresh,lesson.id);assert.equal(f.root.querySelector('#transfer-answer').value,target.value);
});
test('a real transcript draft retains its input provenance until it is edited',async t=>{
 const f=await fixture(t);await f.module.mountTransfer(f.root,f.data,f.refresh,lesson.id);
 f.voice=async(_button,target,_settings,onText)=>{target.value='This is my own spoken explanation with original examples.';onText();};
 await f.root.querySelector('#transfer-voice').click();await f.module.mountTransfer(f.root,f.data,f.refresh,lesson.id);
 f.api=async(_path,payload)=>response(payload);await f.root.querySelector('#transfer-check').click();assert.equal(f.requests.at(-1).body.mode,'speaking');
 const target=f.root.querySelector('#transfer-answer');target.value+=' I edited the sentence.';target.oninput();await f.root.querySelector('#transfer-check').click();assert.equal(f.requests.at(-1).body.mode,'writing');
});
test('an ungraded self-check saves a concrete note separately and never becomes an attempt',async t=>{
 const f=await fixture(t);
 f.data.state.attempts.push(...['recall','write','speak'].map((stage,i)=>response({id:'prior-'+stage,lessonId:'free',exerciseId:transferExerciseId(lesson.id,0,stage),prompt:'A prior original task.',answer:'A complete '+stage+' response that I wrote myself.',mode:stage==='speak'?'speaking':'writing'},{at:new Date(Date.now()-30000+i*1000).toISOString(),feedback:{verdict:'ungraded',summary:'Saved without evaluation',explanation:'Check your own meaning.',mistakes:[]}})));
 await f.module.mountTransfer(f.root,f.data,f.refresh,lesson.id);const note=f.root.querySelector('#transfer-self-note');assert.ok(note);
 note.value='I compared my meaning with the topic and checked the examples.';note.oninput();const attempts=f.data.state.attempts.length;
 await f.root.querySelector('#transfer-self-check').click();assert.equal(f.requests.length,0);assert.equal(f.data.state.attempts.length,attempts);
 const hydrated=f.module.transferState(f.data),p=transferProgress(transferTopics(f.data)[0],hydrated);assert.equal(p.completedRounds,1);assert.equal(p.history[0].selfChecked,true);assert.equal(p.history[0].ungraded,true);
});
