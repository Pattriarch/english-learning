import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exerciseMaterials,materialHTML,materialFigureHTML,materialTextHTML} from '../lesson-materials.js';
import {studyUI} from './study-ui-fixture.mjs';

test('Staged practice only reveals materials assigned to the current exercise',()=>{
 const lesson={materials:[{id:'stage-1',text:'Initial request.'},{id:'stage-2',text:'A surprise new restriction.'}]};
 assert.deepEqual(exerciseMaterials(lesson,{materialIds:['stage-1']}),[lesson.materials[0]]);
 assert.deepEqual(exerciseMaterials(lesson,{materialIds:[]}),[]);
});

test('B1 transfer listening remains a separate recording hidden until the final task',()=>{
 const course=JSON.parse(readFileSync(new URL('../../content/courses/extended-skills.json',import.meta.url),'utf8'));
 const lesson=course.find(l=>l.id==='extended-b1-listening');
 const transfer=lesson.materials.find(m=>m.id==='m4');
 assert.equal(transfer.kind,'listening');assert.ok(transfer.text.includes('Nina'));
 for(const exercise of lesson.exercises.slice(0,-1))assert.ok(!exerciseMaterials(lesson,exercise).includes(transfer));
 assert.ok(exerciseMaterials(lesson,lesson.exercises.at(-1)).includes(transfer));
 assert.ok(!lesson.materials.find(m=>m.id==='m2').text.includes('Nina'));
});

test('Prepared charts use local assets, accessible descriptions and escaped captions',()=>{
 const figure={id:'commuting-active-share',alt:'Months and percentages <check>',caption:'Fictional data & separate samples'};
 const html=materialFigureHTML(figure,'reading');
 assert.match(html,/src="\/assets\/learning-figures\/commuting-active-share.svg"/);
 assert.match(html,/alt="Months and percentages &lt;check&gt;"/);
 assert.match(html,/Fictional data &amp; separate samples/);
 assert.match(html,/target="_blank" rel="noopener noreferrer"/);
 for(const id of ['../private','https://example.org/figure','chart" onload="x'])assert.equal(materialFigureHTML({...figure,id},'reading'),'');
 assert.equal(materialFigureHTML(figure,'listening'),'');
 assert.equal(materialFigureHTML({...figure,alt:''},'reading'),'');
});

test('Prepared data rows retain values and headers in an accessible table',()=>{
 const source='Complete table. Column order: month; respondents; share.\nJanuary; 100; 30%.\nJune; 150; 40%.';
 const html=materialTextHTML(source);
 assert.match(html,/<th scope="col">respondents<\/th>/);assert.match(html,/<th scope="row">June<\/th><td>150<\/td><td>40%<\/td>/);
 assert.match(html,/tabindex="0" role="region"/);
 assert.match(materialTextHTML(source.replace('January','<script>')),/&lt;script&gt;/);
 assert.doesNotMatch(materialTextHTML('Ordinary text; with a semicolon.'),/<table/);
 assert.doesNotMatch(materialTextHTML(source+'\nIncomplete; row.'),/<table/);
});

test('A prepared PNG scene opens locally and its description starts hidden',async t=>{
 const f=await studyUI(t,'lesson-materials.js');
 const figure={id:'courtyard-actions',format:'png',alt:'Four adults in a courtyard',caption:'Original fictional learning scene'};
 const lesson={id:'scene-test',materials:[{id:'m1',kind:'reference',title:'Courtyard',text:'The complete accessible description.',figure}]};
 f.module.mountLessonMaterials(f.root,lesson,{materialIds:['m1']},{drafts:{}});
 const description=f.root.querySelector('[data-material-text="0"]');
 assert.equal(description.hidden,true);
 assert.match(f.module.materialFigureHTML(figure,'reference'),/courtyard-actions\.png/);
 assert.equal(f.root.querySelector('[data-material-play]'),null);
 await f.root.querySelector('[data-material-toggle]').click();assert.equal(description.hidden,false);
 let prevented=false;
 await f.root.querySelector('[data-material-figure]').onclick({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);
 assert.match(f.modal.innerHTML,/courtyard-actions\.png/);
 for(const format of ['../png','svg?secret','jpg',42])assert.equal(materialFigureHTML({...figure,format},'reference'),'');
});

const audioLesson=()=>({id:'extended-test',materials:[{id:'m1',kind:'listening',title:'An interview',text:'A complete listening source.'}]});
test('listening sends the current complete text and selected speed to Kokoro without reading old manifests',async t=>{
 const f=await studyUI(t,'lesson-materials.js'),lesson=audioLesson();
 f.fetch=async()=>assert.fail('Old prepared speech must not be fetched');
 f.module.mountLessonMaterials(f.root,lesson,{materialIds:['m1']},{drafts:{}});
 f.root.querySelector('[data-material-rate="0"]').value='.8';
 await f.root.querySelector('[data-material-play]').click();
 const player=f.root.querySelector('[data-material-audio="0"]');
 assert.deepEqual(f.spoken[0].slice(0,3),[lesson.materials[0].text,.8,'en-US']);assert.equal(f.spoken[0][3].player,player);
 assert.equal(f.root.querySelector('[data-material-text="0"]').hidden,true);
});

test('a redraw invalidates the pending material playback even while the root stays connected',async t=>{
 const f=await studyUI(t,'lesson-materials.js'),lesson=audioLesson();
 f.module.mountLessonMaterials(f.root,lesson,{materialIds:['m1']},{drafts:{}});await f.root.querySelector('[data-material-play]').click();
 const options=f.spoken[0][3];assert.equal(options.isCurrent(),true);
 f.module.mountLessonMaterials(f.root,lesson,{materialIds:['m1']},{drafts:{}});assert.equal(options.isCurrent(),false);
});

test('long listening sources are sent without truncation',async t=>{
 const f=await studyUI(t,'lesson-materials.js'),lesson=audioLesson();
 lesson.materials[0].text='A complete paragraph. '.repeat(500);
 f.module.mountLessonMaterials(f.root,lesson,{materialIds:['m1']},{drafts:{}});
 await f.root.querySelector('[data-material-play]').click();
 assert.equal(f.spoken[0][0],lesson.materials[0].text);
});

test('Listening begins with a hidden transcript while reading exposes the complete paragraph text',t=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});
 t.after(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage;});
 const state={drafts:{}},material={id:'input',title:'A conversation',kind:'listening',text:'First complete paragraph.\n\nSecond paragraph <script>example</script>',source:'Original teaching text'};
 const listening=materialHTML(material,0,state,'lesson');
 assert.match(listening,/data-material-text="0" hidden/);
 assert.match(listening,/Мои заметки до открытия расшифровки/);
 assert.match(listening,/&lt;script&gt;/);assert.doesNotMatch(listening,/<script>/);
 const reading=materialHTML({...material,kind:'reading'},0,state,'lesson');
 assert.doesNotMatch(reading,/data-material-text="0" hidden/);
 assert.match(reading,/<p>First complete paragraph\.<\/p>/);
 const reference=materialHTML({...material,kind:'reference'},0,state,'lesson');
 assert.doesNotMatch(reference,/data-material-play|data-material-audio/,'Reference forms and phonetic notation are not offered as spoken input');
 assert.doesNotMatch(reference,/data-material-text="0" hidden/);
});
