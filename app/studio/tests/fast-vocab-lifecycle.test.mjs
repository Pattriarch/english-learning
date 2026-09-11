import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI,deferred} from './study-ui-fixture.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const savedData=()=>({state:{cards:['A','B'].map(id=>({id,front:'Русский смысл '+id,back:'English '+id,note:'A longer explanation.',source:'Test',due:'2020-01-01'})),drafts:{}},settings:{}});
const entry=()=>({id:'approve',word:'approve',senses:[{id:'s1',definition:'Accept officially.'}],contexts:[{id:'c1',en:'They approved the plan.',ru:'Они одобрили план.',targetSpans:[{start:5,end:13,text:'approved'}],senseId:'s1',quality:'ai-context-reviewed',explanation:'Approve means accept a plan.'}]});
const summary=()=>({id:'approve',word:'approve',preview:entry().contexts[0]});
async function mountSaved(t){const f=await studyUI(t,'fast-vocab.js'),data=savedData();await f.module.mountFastVocab(f.root,data,async()=>data,{deck:'saved'});return{f,data};}
const reveal=f=>f.root.querySelector('#fast-reveal').click();
const rating=(f,n=2)=>f.root.querySelector(`[data-fast-rating="${n}"]`).click();

test('quick review requires recall before reveal but never requires typing or AI; ratings use existing review API',async t=>{
 const {f}=await mountSaved(t);assert.equal(f.root.querySelector('#fast-answer').hidden,true);assert.equal(f.root.querySelector('textarea'),null);
 const face=f.root.querySelector('#fast-card');face.onkeydown({key:'2',target:face,preventDefault(){}});assert.equal(f.requests.length,0);
 await reveal(f);assert.equal(f.root.querySelector('#fast-answer').hidden,false);assert.match(f.root.querySelector('#fast-answer').innerHTML,/Русский смысл A/);
 await rating(f);assert.deepEqual(f.requests.map(r=>r.path),['/review']);assert.equal(f.requests[0].body.rating,2);assert.equal(f.requests[0].body.cardId,'A');
 assert.match(f.requests[0].body.answer,/Самооценка по памяти: EN → RU/);assert.match(f.root.querySelector('#fast-work').innerHTML,/English B/);
 assert.equal(f.root.querySelector('#fast-answer').hidden,true);
});
test('changing recall direction hides the answer and does not record a successful attempt',async t=>{
 const {f}=await mountSaved(t);await reveal(f);const select=f.root.querySelector('#fast-direction');select.value='produce';select.onchange({target:select});
 assert.match(f.root.querySelector('#fast-work').innerHTML,/Русский смысл A/);assert.equal(f.root.querySelector('#fast-answer').hidden,true);assert.equal(f.requests.length,0);
 await reveal(f);await rating(f,3);assert.match(f.requests[0].body.answer,/RU → EN/);assert.equal(f.requests[0].body.rating,3);
});
test('double rating while saving makes one request and keeps current card until acknowledged',async t=>{
 const {f}=await mountSaved(t),pending=deferred();f.api=()=>pending.promise;await reveal(f);
 const first=rating(f);await rating(f);assert.equal(f.requests.length,1);assert.match(f.root.querySelector('#fast-work').innerHTML,/English A/);
 pending.resolve({});await first;assert.match(f.root.querySelector('#fast-work').innerHTML,/English B/);
});
test('an uncertain failed rating retries the same ID and same grade, without changing direction',async t=>{
 const {f}=await mountSaved(t);let failed=true;f.api=async()=>{if(failed)throw Error('Connection lost');return{};};await reveal(f);await rating(f,0);
 assert.match(f.root.querySelector('#fast-status').textContent,/Connection lost/);assert.equal(f.root.querySelector('[data-fast-rating="2"]').disabled,true);assert.equal(f.root.querySelector('#fast-direction').disabled,true);
 failed=false;await rating(f,0);assert.equal(f.requests.length,2);assert.deepEqual(f.requests[0].body,f.requests[1].body);assert.match(f.root.querySelector('#fast-work').innerHTML,/English B/);
});
test('a late rating cannot render into a different route or write its drafts',async t=>{
 const {f}=await mountSaved(t),pending=deferred();f.api=()=>pending.promise;await reveal(f);const request=rating(f);
 location.hash='#/today';f.root.innerHTML='<h1>Today</h1>';pending.resolve({});await request;
 assert.equal(f.root.innerHTML,'<h1>Today</h1>');assert.equal(f.local.size,0);assert.equal(f.alerts.length,0);
});
test('dictionary batch is prepared and context highlighted; card is saved only when graded',async t=>{
 const f=await studyUI(t,'fast-vocab.js'),data={state:{cards:[],drafts:{}},settings:{}};
 f.api=async(path,body)=>path.startsWith('/lexicon?')?{items:[summary()],total:1}:path==='/lexicon/approve'?{entry:entry()}:path==='/cards'?body:{};
 await f.module.mountFastVocab(f.root,data,async()=>data,{topic:'work',q:'approve'});
 assert.match(f.requests[0].path,/prepared=1/);assert.match(f.requests[0].path,/topic=work/);assert.match(f.root.querySelector('#fast-work').innerHTML,/<mark>approved<\/mark>/);
 assert.equal(f.requests.some(r=>r.path==='/cards'),false);await reveal(f);await rating(f);
 assert.deepEqual(f.requests.slice(-2).map(r=>r.path),['/cards','/review']);assert.equal(f.requests.at(-1).body.cardId,f.requests.at(-2).body.id);
 assert.match(f.root.querySelector('#fast-work').innerHTML,/Готово/);
});
test('leaving while a new card is being saved does not start a subsequent review mutation',async t=>{
 const f=await studyUI(t,'fast-vocab.js'),data={state:{cards:[],drafts:{}},settings:{}},pending=deferred();
 f.api=async(path,body)=>path.startsWith('/lexicon?')?{items:[summary()],total:1}:path==='/lexicon/approve'?{entry:entry()}:path==='/cards'?pending.promise:{};
 await f.module.mountFastVocab(f.root,data,async()=>data);await reveal(f);const request=rating(f),card=f.requests.at(-1).body;
 location.hash='#/today';f.root.innerHTML='<h1>Today</h1>';pending.resolve(card);await request;
 assert.equal(f.requests.some(r=>r.path==='/review'),false);assert.equal(f.root.innerHTML,'<h1>Today</h1>');
});
test('failed preparation retries its original offset instead of skipping unstudied words',async t=>{
 const f=await studyUI(t,'fast-vocab.js'),data={state:{cards:[],drafts:{}},settings:{}};let failed=true;
 f.api=async path=>{if(path.startsWith('/lexicon?'))return{items:[summary()],total:1};if(failed)throw Error('Could not open context');return{entry:entry()};};
 await f.module.mountFastVocab(f.root,data,async()=>data);assert.match(f.root.querySelector('#fast-work').innerHTML,/Не удалось загрузить/);
 failed=false;await f.root.querySelector('#fast-more').click();assert.match(f.root.querySelector('#fast-work').innerHTML,/<mark>approved/);
 assert.ok(f.requests.filter(r=>r.path.startsWith('/lexicon?')).every(r=>new URLSearchParams(r.path.split('?')[1]).get('offset')==='0'));
});
test('touch swipes grade revealed cards; vertical scrolling and hidden-answer gestures do nothing',async t=>{
 const {f}=await mountSaved(t);const face=f.root.querySelector('#fast-card');
 const swipe=(dx,dy)=>{face.onpointerdown({pointerType:'touch',isPrimary:true,pointerId:1,clientX:120,clientY:100,target:face});face.onpointerup({pointerId:1,clientX:120+dx,clientY:100+dy});};
 swipe(100,0);assert.equal(f.requests.length,0);await reveal(f);swipe(80,150);assert.equal(f.requests.length,0);
 swipe(-100,5);await tick();assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.rating,0);assert.match(f.root.querySelector('#fast-work').innerHTML,/English B/);
});
test('a context illustration is copied to existing media storage and remains on the saved card after remount',async t=>{
 const f=await studyUI(t,'fast-vocab.js'),data={state:{cards:[],drafts:{}},settings:{}},illustrated=entry(),image='a'.repeat(64)+'.png';
 illustrated.images=[{src:'/assets/vocabulary-scenes/team-planning.png',contextId:'c1',alt:'A team planning together.'}];
 f.fetch=async url=>{assert.equal(url,illustrated.images[0].src);return{ok:true,blob:async()=>new Blob(['PNG'],{type:'image/png'})};};
 f.api=async(path,body)=>{
  if(path.startsWith('/lexicon?'))return{items:[summary()],total:1};if(path==='/lexicon/approve')return{entry:illustrated};
  if(path==='/media'){assert.ok(body instanceof FormData);return{image};}
  if(path==='/cards'){const card={...body,due:'2020-01-01'};data.state.cards.push(card);return card;}return{};
 };
 await f.module.mountFastVocab(f.root,data,async()=>data);await reveal(f);await rating(f,0);
 assert.deepEqual(f.requests.slice(-3).map(r=>r.path),['/media','/cards','/review']);assert.equal(data.state.cards[0].image,image);
 await f.module.mountFastVocab(f.root,data,async()=>data,{deck:'saved'});await reveal(f);
 assert.match(f.root.querySelector('#fast-answer').innerHTML,new RegExp('/media/'+image));
});
test('navigation while reading an image stops before media upload and card creation',async t=>{
 const f=await studyUI(t,'fast-vocab.js'),data={state:{cards:[],drafts:{}},settings:{}},illustrated=entry(),pending=deferred();
 illustrated.images=[{src:'/assets/vocabulary-scenes/team-planning.png',contextId:'c1'}];
 f.fetch=()=>pending.promise;f.api=async path=>path.startsWith('/lexicon?')?{items:[summary()],total:1}:{entry:illustrated};
 await f.module.mountFastVocab(f.root,data,async()=>data);await reveal(f);const request=rating(f);
 location.hash='#/today';f.root.innerHTML='<h1>Today</h1>';pending.resolve({ok:true,blob:async()=>new Blob(['PNG'])});await request;
 assert.equal(f.requests.some(r=>['/media','/cards','/review'].includes(r.path)),false);assert.equal(f.root.innerHTML,'<h1>Today</h1>');
});
test('saved and known preview contexts are skipped when selecting a new dictionary batch',async t=>{
 const f=await studyUI(t,'fast-vocab.js'),data={state:{cards:[{id:'legacy',front:entry().contexts[0].ru,back:entry().contexts[0].en}],drafts:{'lexicon:state:known':{text:JSON.stringify({version:1,status:'known'})}}},settings:{}};
 f.api=async()=>({items:[summary(),{id:'known',word:'Known',preview:{en:'Known context',ru:'Знакомый пример',id:'c'}}],total:2});
 await f.module.mountFastVocab(f.root,data,async()=>data);
 assert.equal(f.requests.length,1);assert.equal(f.root.querySelector('#fast-card'),null);assert.match(f.root.querySelector('#fast-work').innerHTML,/Новых слов/);
});
test('each acknowledged rating scrolls the next prompt into view and the last one shows the completion panel',async t=>{
 const {f}=await mountSaved(t),calls=[];
 t.mock.method(Object.getPrototypeOf(f.root),'scrollIntoView',function(options){calls.push({id:this.attrs.id,options});});
 await reveal(f);assert.equal(f.root.querySelector('#fast-card').classList.contains('is-revealed'),true);await rating(f);
 assert.equal(f.root.querySelector('#fast-card').classList.contains('is-revealed'),false);
 assert.deepEqual(calls,[{id:'fast-card',options:{block:'start',behavior:'auto'}}]);
 await reveal(f);await rating(f);assert.equal(calls.at(-1).id,'fast-work');assert.match(f.root.querySelector('#fast-work').innerHTML,/Готово/);
});
test('flipped cards retain their original prompt in a collapsed comparison for both directions',async t=>{
 const {f}=await mountSaved(t);await reveal(f);
 assert.match(f.root.querySelector('#fast-answer').innerHTML,/<details class="fast-vocab-original"><summary>Исходная фраза<\/summary><p lang="en">English A<\/p><\/details>/);
 const select=f.root.querySelector('#fast-direction');select.value='produce';select.onchange({target:select});await reveal(f);
 const answer=f.root.querySelector('#fast-answer').innerHTML;
 assert.match(answer,/<p class="fast-vocab-translation" lang="en">English A<\/p>/);
 assert.match(answer,/<details class="fast-vocab-original"><summary>Исходная фраза<\/summary><p lang="ru">Русский смысл A<\/p><\/details>/);
});
