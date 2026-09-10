import test from 'node:test';
import assert from 'node:assert/strict';
import {plannedPractice} from '../pages.js';
import {studyUI} from './study-ui-fixture.mjs';

const task={id:'daily-2026-09-10-writing',title:'Explain a compromise',prompt:'Write to your neighbour about a shared room.',passage:'',level:'B1',mode:'writing'};
const plan={version:1,day:'2026-09-10',blocks:[{id:'writing',practiceTask:task}]};

test('A planned route resolves only its own saved day, mode and task',()=>{
 const raw=JSON.stringify(plan);
 assert.deepEqual(plannedPractice(raw,'writing',plan.day,'writing'),{day:plan.day,blockId:'writing',task:{...task,conversation:[]}});
 for(const [value,mode,day,id] of [[raw,'reading',plan.day,'writing'],[raw,'writing','2026-09-11','writing'],[raw,'writing',plan.day,'missing'],['{}','writing',plan.day,'writing'],['broken','writing',plan.day,'writing']])assert.equal(plannedPractice(value,mode,day,id),null);
});

test('Daily practice saves the exact planned answer and leaves independent free practice intact',async t=>{
 const f=await studyUI(t,'pages.js'),custom={...task,id:'custom-independent',prompt:'My own unrelated task'},customRaw=JSON.stringify(custom);
 const data={state:{drafts:{'practice-task:writing':{text:customRaw}},attempts:[]},settings:{}};
 const selected=plannedPractice(JSON.stringify(plan),'writing',plan.day,'writing');
 f.api=async(path,payload)=>{assert.equal(path,'/check');const a={...payload,at:'2026-09-10T12:00:00Z',feedback:{verdict:'ungraded',source:'reference',summary:'Saved practice',explanation:'Compare your own version.'}};data.state.attempts.push(a);return a;};
 f.module.mountPractice(f.root,data,'writing',async()=>data,selected);
 assert.match(f.root.querySelector('#practice-work').innerHTML,/Write to your neighbour/);
 assert.equal(f.root.querySelector('#new-task').hidden,true);
 assert.equal(f.root.querySelector('#custom-task-panel').hidden,true);
 assert.equal(f.root.querySelector('#ai-task'),null);
 let answer=f.root.querySelector('#answer');answer.value='Could we use the shared room at different times?';answer.oninput();await f.root.querySelector('#check').click();
 assert.equal(f.alerts.length,0);
 assert.equal(f.requests[0].body.exerciseId,'writing-'+task.id);
 assert.equal(f.local.get('free:writing:'+task.id),answer.value);
 assert.equal(f.local.has('practice-task:writing'),false);
 f.module.mountPractice(f.root,data,'writing',async()=>data,selected);
 assert.equal(f.root.querySelector('#answer').value,answer.value);
 assert.match(f.root.querySelector('#feedback').innerHTML,/Saved practice/);
 f.module.mountPractice(f.root,data,'writing',async()=>data);
 assert.match(f.root.querySelector('#practice-work').innerHTML,/My own unrelated task/);
 assert.equal(f.root.querySelector('#new-task').hidden,false);
});

test('A planned correction displays the previous answer needed to perform the task',async t=>{
 const f=await studyUI(t,'pages.js'),data={state:{drafts:{},attempts:[]},settings:{}};
 f.module.mountPractice(f.root,data,'writing',async()=>data,{day:plan.day,blockId:'review',task:{...task,passage:'Previous answer: I has a meeting.'}});
 assert.match(f.root.querySelector('#practice-work').innerHTML,/Previous answer: I has a meeting\./);
 assert.ok(f.root.querySelector('.planned-source'));
});
