import test from 'node:test';
import assert from 'node:assert/strict';
import {dateKey} from '../core.js';

const key='ew-draft:planner:session';
let instance=0;

async function fixture(t){
 const descriptors=new Map(),storage=new Map(),tabStorage=new Map(),writes=[],intervals=[],timeouts=new Map();
 const install=(name,value)=>{descriptors.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});};
 let timerID=0,host,now=Date.now();
 const originalNow=Date.now;Date.now=()=>now;
 class Host{
  setAttribute(){}
  set innerHTML(html){this.html=html;this.elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>['#'+match[1],{}]));this.elements.set('.study-session-clock',{});}
  querySelector(selector){return this.elements?.get(selector)||null;}
 }
 const window=new EventTarget(),document=new EventTarget();
 document.hidden=false;document.body={append:element=>{host=element;},classList:{toggle(){}}};
 document.createElement=()=>new Host();document.querySelector=selector=>selector==='#toast'?{}:null;
 install('window',window);install('document',document);
 install('localStorage',{getItem:name=>storage.get(name)||null,setItem(name,value){storage.set(name,value);writes.push({name,value});},removeItem:name=>storage.delete(name)});
 install('sessionStorage',{getItem:name=>tabStorage.get(name)||null,setItem:(name,value)=>tabStorage.set(name,value),removeItem:name=>tabStorage.delete(name)});
 install('setTimeout',(fn,delay)=>{const id=++timerID;timeouts.set(id,{fn,delay});return id;});
 install('clearTimeout',id=>timeouts.delete(id));install('setInterval',fn=>{intervals.push(fn);return intervals.length;});
 t.after(()=>{Date.now=originalNow;for(const[name,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 const module=await import(`../study-session.js?lifecycle-test=${++instance}`);
 module.initStudySession({drafts:{}});
 const block={id:'book-1',title:'Разобрать тему',minutes:15,href:'#/books'},plan={day:dateKey(),blocks:[block]};
 const read=()=>JSON.parse(JSON.parse(storage.get(key)).text);
 return{
  module,storage,writes,window,document,read,
  get hidden(){return host.hidden;},
  async reload(){const next=await import(`../study-session.js?lifecycle-test=${++instance}`);next.initStudySession({drafts:{}});},
  start(){window.dispatchEvent(new CustomEvent('planner-start',{detail:{plan,block}}));return read();},
  takeElsewhere(sendEvent=true){const foreign={...read(),owner:'another-tab',seconds:123,totals:{'book-1':123},active:true};storage.set(key,JSON.stringify({text:JSON.stringify(foreign),at:new Date().toISOString(),pending:false}));if(sendEvent){const event=new Event('storage');Object.defineProperty(event,'key',{value:key});window.dispatchEvent(event);}return storage.get(key);},
  click(id){const button=host.querySelector('#'+id);assert.equal(typeof button?.onclick,'function',id);button.onclick();},
  tick(seconds=1){now+=seconds*1000;for(const fn of intervals)fn();},
 };
}

test('losing a session to another tab prevents visibility, pagehide, plan and close from overwriting it',async t=>{
 const f=await fixture(t);f.start();const foreign=f.takeElsewhere(),before=f.writes.length;
 f.document.dispatchEvent(new Event('visibilitychange'));
 f.window.dispatchEvent(new Event('pagehide'));
 f.tick(30);
 f.click('session-plan');f.click('session-end');
 assert.equal(f.storage.get(key),foreign,'the active foreign timer must survive the stale panel');
 assert.equal(f.writes.length,before,'losing ownership must prevent both saves and clears');
});

test('ownership checks also protect the foreign timer before a storage event is delivered',async t=>{
 const f=await fixture(t);f.start();const foreign=f.takeElsewhere(false),before=f.writes.length;
 f.document.dispatchEvent(new Event('visibilitychange'));
 f.window.dispatchEvent(new Event('pagehide'));
 f.tick(30);f.click('session-end');
 assert.equal(f.storage.get(key),foreign);
 assert.equal(f.writes.length,before);
});

test('a user can explicitly resume in this tab after losing ownership',async t=>{
 const f=await fixture(t),original=f.start();f.takeElsewhere();f.click('session-pause');
 assert.equal(f.read().owner,original.owner);
 assert.equal(f.read().active,true);
 assert.equal(f.read().seconds,123,'taking over must retain the newer saved time from the other tab');
 const before=f.read().seconds;f.tick(16);
 assert.ok(f.read().seconds>before);
 assert.ok(f.writes.every(write=>write.name===key),'a timer must never write lesson completion or review evidence');
});

test('an owned break expires while hidden without adding study time or completing the lesson',async t=>{
 const f=await fixture(t);f.start();f.click('session-break');const seconds=f.read().seconds;
 f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));f.tick(301);
 assert.equal(f.read().breakSeconds,0);assert.equal(f.read().active,false);assert.equal(f.read().seconds,seconds);
 assert.ok(f.writes.every(write=>write.name===key));
});

test('closing a restored panel remains dismissed in this tab after reload',async t=>{
 const f=await fixture(t);f.start();await f.reload();assert.equal(f.hidden,false);
 const stored=f.storage.get(key);f.click('session-end');assert.equal(f.hidden,true);
 assert.equal(f.storage.get(key),stored,'an unowned snapshot may belong to another live tab');
 await f.reload();assert.equal(f.hidden,true);
});
