import test from 'node:test';
import assert from 'node:assert/strict';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function rootFixture(){
 const controls=new Map();
 return {isConnected:true,classList:{add(){}},markup:'',
  set innerHTML(value){this.markup=value;controls.clear();},get innerHTML(){return this.markup;},
  querySelector(selector){if(!controls.has(selector))controls.set(selector,{disabled:false,innerHTML:'',textContent:'',setAttribute(){}});return controls.get(selector);}};
}
const metadata={version:1,modules:[{id:'extended-one',level:'A1',title:'First level',skills:[],expectedExerciseCount:1,expectedMaterialIds:['m1']},{id:'extended-two',level:'C2',title:'Advanced level',skills:[],expectedExerciseCount:1,expectedMaterialIds:['m1']}],sources:[],gaps:[],supplements:{groups:[]}};

test('a pending metadata request cannot replace a newer selected level on the same root',async()=>{
 const previousFetch=globalThis.fetch,previousLocation=globalThis.location;
 let resolve;
 try{
  globalThis.location={hash:'#/roadmap'};
  globalThis.fetch=()=>new Promise(done=>{resolve=done;});
  const {mountCurriculumCoverage}=await import('../curriculum-coverage.js?level-switch-test');
  const root=rootFixture(),data={lessons:[]};
  mountCurriculumCoverage(root,data,{level:'A1'});
  mountCurriculumCoverage(root,data,{level:'C2'});
  resolve({ok:true,json:async()=>metadata});await tick();
  assert.match(root.innerHTML,/Advanced level/);assert.doesNotMatch(root.innerHTML,/First level/);
 }finally{globalThis.fetch=previousFetch;globalThis.location=previousLocation;}
});

test('late availability refresh cannot mutate lessons or re-render after navigation',async()=>{
 const previousFetch=globalThis.fetch,previousLocation=globalThis.location;
 let resolveRefresh;
 try{
  globalThis.location={hash:'#/roadmap'};
  globalThis.fetch=url=>url==='/api/curriculum/coverage'?Promise.resolve({ok:true,json:async()=>metadata}):new Promise(done=>{resolveRefresh=done;});
  const {mountCurriculumCoverage}=await import('../curriculum-coverage.js?navigation-test');
  const root=rootFixture(),lessons=[],data={lessons};let updates=0;
  mountCurriculumCoverage(root,data,{level:'A1',onLessonsChanged:()=>updates++});await tick();
  const request=root.querySelector('.cc-refresh').onclick();
  globalThis.location.hash='#/lesson/existing';
  root.innerHTML='Next page';
  resolveRefresh({ok:true,json:async()=>({lessons:[{id:'late'}]})});await request;
  assert.equal(data.lessons,lessons);assert.equal(updates,0);assert.equal(root.innerHTML,'Next page');
 }finally{globalThis.fetch=previousFetch;globalThis.location=previousLocation;}
});

test('failed availability refresh keeps the current content and a visible retryable error',async()=>{
 const previousFetch=globalThis.fetch,previousLocation=globalThis.location;
 try{
  globalThis.location={hash:'#/roadmap'};
  globalThis.fetch=url=>url==='/api/curriculum/coverage'?Promise.resolve({ok:true,json:async()=>metadata}):Promise.reject(Error('offline'));
  const {mountCurriculumCoverage}=await import('../curriculum-coverage.js?failure-test');
  const root=rootFixture(),data={lessons:[]};
  mountCurriculumCoverage(root,data,{level:'A1'});await tick();
  await root.querySelector('.cc-refresh').onclick();
  assert.match(root.innerHTML,/First level/);
  assert.match(root.querySelector('.cc-footnote').textContent,/Сервер недоступен/);
  assert.equal(root.querySelector('.cc-refresh').disabled,false);
 }finally{globalThis.fetch=previousFetch;globalThis.location=previousLocation;}
});

test('availability refresh includes newly researched modules instead of retaining an old plan',async()=>{
 const previousFetch=globalThis.fetch,previousLocation=globalThis.location;
 let requests=0;
 try{
  globalThis.location={hash:'#/roadmap'};
  globalThis.fetch=url=>Promise.resolve({ok:true,json:async()=>url==='/api/curriculum/coverage'?
   (++requests===1?metadata:{...metadata,modules:[...metadata.modules,{id:'extended-new',level:'C2',title:'New researched topic',skills:[],expectedExerciseCount:1,expectedMaterialIds:['m1']}]})
   :{lessons:[]}});
  const {mountCurriculumCoverage}=await import('../curriculum-coverage.js?updated-plan-test');
  const root=rootFixture(),data={lessons:[]};
  mountCurriculumCoverage(root,data,{level:'C2'});await tick();
  assert.doesNotMatch(root.innerHTML,/New researched topic/);
  await root.querySelector('.cc-refresh').onclick();
  assert.equal(requests,2);assert.match(root.innerHTML,/New researched topic/);
 }finally{globalThis.fetch=previousFetch;globalThis.location=previousLocation;}
});
