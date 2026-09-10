import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightLexicon,lexicalLinkedSense,lexicalImage,lexicalProgress} from '../lexicon-model.js';
import {studyUI,deferred} from './study-ui-fixture.mjs';

const data=()=>({state:{drafts:{'planner:preferences':{text:JSON.stringify({level:'C1'})}},attempts:[]},settings:{provider:'offline'}});
const entry={id:'test-word',word:'issue',kind:'word',senses:[{id:'s1',definition:'a problem'}],contexts:[{id:'c1',en:'There is an issue.',ru:'Есть проблема.',targetSpans:[{start:12,end:17,text:'issue'}],senseId:null},{id:'c2',en:'A different issue arose.',ru:'Возник другой вопрос.',targetSpans:[{start:12,end:17,text:'issue'}],senseId:'s1'}]};

test('spans escape markup, preserve emoji and reject split UTF-16 pairs',()=>{
 assert.equal(highlightLexicon('😀 <issue>',[{start:4,end:9,text:'issue'}]),'😀 &lt;<mark>issue</mark>&gt;');
 assert.equal(highlightLexicon('😀',[{start:0,end:1,text:'\ud83d'}]),'😀');
 assert.equal(highlightLexicon('issue',[{start:0,end:4,text:'issue'}]),'issue');
});
test('only explicit sense and context-specific image links are used',()=>{
 assert.equal(lexicalLinkedSense(entry,entry.contexts[0]),null);
 assert.equal(lexicalLinkedSense(entry,entry.contexts[1]).id,'s1');
 assert.equal(lexicalImage({...entry,images:[{src:'/assets/vocabulary-scenes/team.png',contextId:'c2'}]},entry.contexts[0]),null);
 assert.deepEqual(lexicalProgress({'lexicon:state:x':{text:'{"version":1,"status":"known"}'},'unrelated':'{}'}),{known:1,learning:0});
});
test('a late initial fetch cannot overwrite another route',async t=>{
 const f=await studyUI(t,'lexicon.js'),wait=deferred();f.api=()=>wait.promise;
 const pending=f.module.mountLexicon(f.root,data(),async()=>data(),'test-word');
 location.hash='#/today';f.root.innerHTML='<h1>Today</h1>';wait.resolve({entry,metadata:{}});await pending;
 assert.equal(f.root.innerHTML,'<h1>Today</h1>');
});
test('practice uses saved level and late feedback cannot erase a newer answer',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data(),wait=deferred(),sent=deferred();f.api=path=>{if(path.startsWith('/lexicon/'))return{entry,metadata:{}};sent.resolve();return wait.promise;};
 await f.module.mountLexicon(f.root,d,async()=>d,'test-word');
 const target=f.root.querySelector('#lexicon-answer');target.value='There is an issue with my account.';target.oninput();
 const pending=f.root.querySelector('#lexicon-check').click();await sent.promise;
 assert.equal(f.requests.find(r=>r.path==='/check').body.level,'C1');
 target.value='There is an issue with our report.';target.oninput();
 wait.resolve({feedback:{verdict:'correct',summary:'OK',mistakes:[],alternatives:[]}});await pending;
 assert.equal(target.value,'There is an issue with our report.');assert.equal(f.root.querySelector('#lexicon-feedback').innerHTML,'');
 assert.equal(f.local.get('lexicon:answer:test-word:c1'),target.value);
});
test('changing context disconnects earlier controls and saves independent drafts',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data();f.api=async()=>({entry,metadata:{}});
 await f.module.mountLexicon(f.root,d,async()=>d,'test-word');
 const first=f.root.querySelector('#lexicon-answer');first.value='My own first message.';first.oninput();
 await f.root.querySelector('#lexicon-next-context').click();assert.equal(first.isConnected,false);
 const second=f.root.querySelector('#lexicon-answer');second.value='My own second message.';second.oninput();
 first.value='Late dictation';first.oninput();
 assert.equal(f.local.get('lexicon:answer:test-word:c2'),'My own second message.');
 await f.root.querySelector('#lexicon-prev-context').click();assert.equal(f.root.querySelector('#lexicon-answer').value,'My own first message.');
});
