import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI} from './study-ui-fixture.mjs';
import {readFileSync} from 'node:fs';
import {deferred} from './study-ui-fixture.mjs';

// Exercise the real lesson renderer and submit handler without booting the app.
export const lessonOnly=raw=>{const source=raw.replace(/\r\n/g,'\n');return source.split('\n').filter(line=>/^import .*from '\.\/(core|audio|authored-exercise|lesson-materials|lesson-guidance|course-guide|lesson-sequence|lesson-intro|lesson-advance)\.js';$/.test(line)).join('\n')+'\nlet data;async function refresh(){data=await api("/bootstrap");}\n'+source.slice(source.indexOf('function lesson(id,index){'),source.indexOf('\n}',source.indexOf('function lesson(id,index){'))+2)+'\nexport function mount(next,id,index){data=next;lesson(id,index);}';};

test('real beginner UI puts the bilingual teaching card before the task and lets the learner remove it',async t=>{
 const f=await studyUI(t,'app.js',{'lesson-materials':{mountLessonMaterials(){}}},lessonOnly);
 const l=JSON.parse(readFileSync(new URL('../../content/courses/foundation.json',import.meta.url),'utf8')).find(l=>l.id==='path-be');
 const d={lessons:[l],settings:{provider:'offline'},state:{attempts:[],drafts:{},read:{}}};
 location.hash='#/lesson/path-be/0?practice';f.root.innerHTML='<main id="main"></main>';f.module.mount(d,l.id,0);
 const main=f.root.querySelector('#main');assert.ok(main.innerHTML.indexOf('I am ready.')<main.innerHTML.indexOf('Скажи «Я устал»'));
 assert.equal(f.root.querySelector('details').attrs.open,undefined);
 await f.root.querySelector('#guidance-listen').click();assert.equal(f.spoken[0][0],'I am ready.');
 await f.root.querySelector('#guidance-toggle').click();assert.equal(f.root.querySelector('#guidance-body').hidden,true);
 await f.root.querySelector('#guidance-toggle').click();assert.equal(f.root.querySelector('#guidance-body').hidden,false);
 f.module.mount(d,l.id,l.exercises.length-1);assert.equal(f.root.querySelector('#guidance-body'),null);assert.match(main.innerHTML,/Теперь сам/);
});

async function advanceFixture(t){
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await studyUI(t,'app.js',{'lesson-materials':{mountLessonMaterials(){}}},lessonOnly);
 const l=JSON.parse(readFileSync(new URL('../../content/courses/foundation.json',import.meta.url),'utf8')).find(l=>l.id==='path-be');
 const d={lessons:[l],settings:{provider:'offline'},state:{attempts:[],drafts:{},read:{}}};
 location.hash='#/lesson/path-be/0?practice';f.root.innerHTML='<main id="main"></main>';f.module.mount(d,l.id,0);
 f.api=async(path,payload)=>{if(path==='/bootstrap')return d;const a={...payload,at:new Date().toISOString(),feedback:{verdict:f.verdict||'correct',summary:'Проверено',corrected:payload.answer}};d.state.attempts.push(a);return a;};
 f.answer=f.root.querySelector('#answer');f.answer.value='I am tired.';f.answer.oninput();f.submit=()=>f.root.querySelector('#check').click();f.data=d;f.lesson=l;return f;
}

test('correct answer advances once; revisiting a saved answer never advances by itself',async t=>{
 const f=await advanceFixture(t);await f.submit();t.mock.timers.tick(1200);
 assert.equal(location.hash,'/lesson/path-be/1?practice');
 location.hash='#/lesson/path-be/0?practice';f.module.mount(f.data,f.lesson.id,0);t.mock.timers.tick(5000);
 assert.equal(location.hash,'#/lesson/path-be/0?practice');assert.match(f.root.querySelector('#main').innerHTML,/Проверено/);
});

test('partial and ungraded feedback stays for correction instead of moving on',async t=>{
 const f=await advanceFixture(t);
 for(const verdict of ['partial','incorrect','ungraded']){f.verdict=verdict;await f.submit();t.mock.timers.tick(2000);assert.equal(location.hash,'#/lesson/path-be/0?practice');}
});

test('editing, opening audio feedback, and leaving the route all cancel navigation',async t=>{
 const f=await advanceFixture(t);await f.submit();f.answer.value='I am not tired.';f.answer.oninput();t.mock.timers.tick(2000);assert.equal(location.hash,'#/lesson/path-be/0?practice');
 await f.submit();f.root.querySelector('#feedback').onpointerdown();t.mock.timers.tick(2000);assert.equal(location.hash,'#/lesson/path-be/0?practice');assert.equal(f.root.querySelector('#continue-feedback').hidden,false);
 await f.submit();location.hash='#/roadmap';window.dispatchEvent(new Event('hashchange'));t.mock.timers.tick(2000);assert.equal(location.hash,'#/roadmap');
});

test('late answer cannot move another route or a newer draft, even if the text is restored',async t=>{
 const f=await advanceFixture(t),pending=deferred(),normal=f.api;f.api=(path,payload)=>path==='/check'?pending.promise:normal(path,payload);
 const check=f.submit();await Promise.resolve();await Promise.resolve();f.answer.value='Changed';f.answer.oninput();f.answer.value='I am tired.';f.answer.oninput();
 pending.resolve({exerciseId:'e1--revision-2',feedback:{verdict:'correct',summary:'Late'}});await check;t.mock.timers.tick(2000);
 assert.equal(location.hash,'#/lesson/path-be/0?practice');assert.equal(f.root.querySelector('#feedback').innerHTML,'');
});

test('first visit starts with the scene and explanation; finishing keeps actual results',async t=>{
 const f=await advanceFixture(t);location.hash='#/lesson/path-be';f.module.mount(f.data,f.lesson.id);
 const main=f.root.querySelector('#main');assert.match(main.innerHTML,/be-states-scene/);assert.match(main.innerHTML,/Я БЫЛ готов/);assert.equal(f.root.querySelector('#answer'),null);
 location.hash='#/lesson/path-be/11?practice';f.module.mount(f.data,f.lesson.id,11);f.root.querySelector('#answer').value='Are you ready? I am ready.';await f.submit();t.mock.timers.tick(1200);
 assert.equal(location.hash,'/lesson/path-be/complete');f.module.mount(f.data,f.lesson.id,'complete');assert.match(main.innerHTML,/Принято ответов: 1 из 12/);assert.equal(f.root.querySelector('#answer'),null);
});

test('real authored UI isolates revised drafts and feedback and sends the current assessment identity',async t=>{
 const f=await studyUI(t,'app.js',{'lesson-materials':{mountLessonMaterials(){}}},lessonOnly);
 const l={id:'source-mediation',title:'Sources',level:'C2',units:'Sources',goal:'Read sources',formula:'Attribute accurately',sections:[],examples:[],exercises:[{id:'e1',revision:1,kind:'write',prompt:'Current question',context:'New source',hint:'Attribute',explanation:'Current rationale',answers:['A current answer.']}]};
 const old={id:'old',lessonId:l.id,exerciseId:'e1',answer:'Obsolete answer',feedback:{verdict:'correct',summary:'Obsolete feedback'},at:'2026-09-10T10:00:00Z'};
 const d={lessons:[l],settings:{provider:'offline'},state:{attempts:[old],drafts:{[l.id+':e1']:{text:'Obsolete draft'}},read:{}}};
 f.root.innerHTML='<main id="main"></main>';
 f.module.mount(d,l.id);
 assert.equal(f.root.querySelector('#answer').value,'');assert.equal(f.root.querySelector('#feedback').innerHTML,'');
 const answer=f.root.querySelector('#answer');answer.value='My new answer based on these sources.';answer.oninput();
 assert.equal(f.local.get(l.id+':e1--revision-1'),answer.value);assert.equal(d.state.drafts[l.id+':e1'].text,'Obsolete draft');
 f.api=async(path,payload)=>{
  if(path==='/bootstrap')return d;
  assert.equal(path,'/check');assert.equal(payload.exerciseId,'e1--revision-1');
  const saved={...old,id:payload.id,exerciseId:payload.exerciseId,answer:payload.answer,feedback:{verdict:'correct',summary:'Current feedback'}};d.state.attempts.push(saved);return saved;
 };
 await f.root.querySelector('#check').onclick({currentTarget:f.root.querySelector('#check')});
 assert.equal(f.alerts.length,0);assert.match(f.root.querySelector('#feedback').innerHTML,/Current feedback/);assert.equal(d.state.attempts[0],old);
 // The response may have been valid when submitted while a new revision is
 // published before refresh. It stays in history, not under the current task.
 const originalAPI=f.api;f.api=async(path,payload)=>path==='/bootstrap'?{...d,lessons:[{...l,exercises:[{...l.exercises[0],revision:2}]}]}:originalAPI(path,payload);
 answer.value='Another answer from before the publication.';answer.oninput();
 await f.root.querySelector('#check').onclick({currentTarget:f.root.querySelector('#check')});
 assert.equal(f.root.querySelector('#feedback').innerHTML,'');assert.match(f.alerts.at(-1),/сохранён в журнале/);
});
