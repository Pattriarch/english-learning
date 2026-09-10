import test from 'node:test';
import assert from 'node:assert/strict';
import {getDraft,queueDraft,localDraft,retryPendingDrafts} from '../core.js';

function storedDraft(t,key,value){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:requested=>requested==='ew-draft:'+key?JSON.stringify(value):null}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
}

test('A newer local edit within the server save second survives immediate navigation',t=>{
  const key='pronunciation:ipa-basics';
  storedDraft(t,key,{text:'New reflection before debounce',at:'2026-09-09T12:00:00.700Z'});
  const state={drafts:{[key]:{text:'Previous reflection',at:'2026-09-09T12:00:00Z'}}};
  assert.equal(getDraft(key,state),'New reflection before debounce');
});

test('Checklist restoration compares instants rather than timestamp string formatting',t=>{
  const key='pronunciation:ipa-basics:checklist';
  storedDraft(t,key,{text:'[0,1,2]',at:'2026-09-09T15:00:00.700+03:00'});
  const state={drafts:{[key]:{text:'[0]',at:'2026-09-09T12:00:01Z'}}};
  assert.equal(getDraft(key,state),'[0]','The newer server save wins even when local date text sorts later');
});

test('A newer intentionally emptied reflection is preserved',t=>{
  const key='pronunciation:ipa-basics';
  storedDraft(t,key,{text:'',at:'2026-09-09T12:00:00.900Z'});
  const state={drafts:{[key]:{text:'Deleted reflection',at:'2026-09-09T12:00:00Z'}}};
  assert.equal(getDraft(key,state),'');
});

test('An unsynchronised local reflection remains available without a server draft',t=>{
  const key='pronunciation:ipa-basics';
  storedDraft(t,key,{text:'Work while offline',at:'2026-09-09T12:00:00.900Z'});
  assert.equal(getDraft(key,{drafts:{}}),'Work while offline');
});

test('A delayed server acknowledgement cannot hide an unsent newer edit',t=>{
  storedDraft(t,'late',{text:'My newer answer',at:'2026-09-09T12:00:00.500Z',pending:true});
  assert.equal(getDraft('late',{drafts:{late:{text:'Earlier answer',at:'2026-09-09T12:00:02Z'}}}),'My newer answer');
});

test('Acknowledging an earlier save does not mark the newer queued text as synced',async t=>{
  const previous={localStorage:globalThis.localStorage,document:globalThis.document,fetch:globalThis.fetch},values=new Map(),replies=[];
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  globalThis.document={querySelector:()=>null};
  globalThis.fetch=()=>new Promise(resolve=>replies.push(()=>resolve({ok:true,json:async()=>({ok:true})})));
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const first=queueDraft('race','Earlier text',true);
  await new Promise(setImmediate);
  const second=queueDraft('race','Newer text',true);
  const editedAt=localDraft('race').at;
  replies.shift()();await first;
  assert.equal(localDraft('race').text,'Newer text');
  assert.equal(localDraft('race').pending,true);
  await new Promise(setImmediate);
  replies.shift()();await second;
  assert.equal(localDraft('race').text,'Newer text');
  assert.equal(localDraft('race').pending,false);
  assert.equal(localDraft('race').at,editedAt,'An acknowledgement is not a newer edit');
});

test('Pending drafts from a closed offline session are retried when connectivity returns',async t=>{
  const previous={localStorage:globalThis.localStorage,document:globalThis.document,fetch:globalThis.fetch};
  const values=new Map([['ew-draft:offline',{text:'Retained offline',at:'2026-09-09T12:00:00Z',pending:true}],['ew-draft:synced',{text:'Already saved',at:'2026-09-09T12:00:00Z',pending:false}]].map(([k,v])=>[k,JSON.stringify(v)])),sent=[];
  globalThis.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  globalThis.document={querySelector:()=>null};
  globalThis.fetch=async(_url,request)=>{sent.push(JSON.parse(request.body));return {ok:true,json:async()=>({ok:true})};};
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  await retryPendingDrafts();
  assert.deepEqual(sent,[{key:'offline',text:'Retained offline'}]);
  assert.equal(localDraft('offline').pending,false);
});
