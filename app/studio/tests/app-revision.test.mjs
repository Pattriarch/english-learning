import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI} from './study-ui-fixture.mjs';

// Exercise the real lesson renderer and submit handler without booting the app.
const lessonOnly=raw=>{const source=raw.replace(/\r\n/g,'\n');return source.split('\n').filter(line=>/^import .*from '\.\/(core|audio|authored-exercise|lesson-materials)\.js';$/.test(line)).join('\n')+'\nlet data;async function refresh(){data=await api("/bootstrap");}\n'+source.slice(source.indexOf('function lesson(id,index){'),source.indexOf('\n}',source.indexOf('function lesson(id,index){'))+2)+'\nexport function mount(next,id,index){data=next;lesson(id,index);}';};

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
