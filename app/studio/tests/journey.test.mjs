import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {roadmapLessons,roadmapLessonHTML,roadmapLessonGroups,libraryUnitMatches,readLibraryUnits,libraryUnitStatus} from '../journey.js';
import {lessonSequence,lessonSourceRelations,lessonRouteInfo,courseLevels} from '../lesson-sequence.js';
import {studyUI} from './study-ui-fixture.mjs';

const content=new URL('../../content/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,content),'utf8'));
const library=read('library.json');
const path=read('learning-path.json');
const lessons=[...read('curriculum.json'),...readdirSync(new URL('courses/',content)).filter(n=>n.endsWith('.json')).flatMap(n=>read('courses/'+n))];

test('the roadmap starts each level in its published learning order and keeps cinema separate',()=>{
 const introduced=new Set();
 for(const id of courseLevels){
  const level=path.levels.find(level=>level.id===id),expected=level.lessonIds.filter(id=>{if(introduced.has(id))return false;introduced.add(id);return true;});
  const result=roadmapLessons(lessons,path,level.id);
  assert.deepEqual(result.slice(0,expected.length).map(l=>l.id),expected,level.id);
  assert.ok(result.every(l=>!l.id.startsWith('cinema-')));
 }
 const before=lessons.map(l=>l.id);
 assert.ok(roadmapLessons(lessons,path,'A1','past perfect',true).some(l=>l.id==='path-past-perfect'));
 assert.deepEqual(roadmapLessons(lessons,path,'A1','past perfect').map(l=>l.id),[]);
 assert.deepEqual(lessons.map(l=>l.id),before,'filtering must not reorder the shared lesson list');
});

test('the complete actual course appears once, with one home for ranges and repeated explicit placements',()=>{
 const perLevel=courseLevels.flatMap(level=>roadmapLessons(lessons,path,level)),all=roadmapLessons([...lessons,lessons[0]],path,'A1','',true);
 assert.equal(new Set(perLevel.map(l=>l.id)).size,perLevel.length);
 assert.deepEqual(new Set(perLevel.map(l=>l.id)),new Set(all.map(l=>l.id)));
 assert.equal(all.length,new Set(lessons.filter(l=>!l.id.startsWith('cinema-')).map(l=>l.id)).size);
 for(const[id,home]of [['natural-b2-leadership','B2'],['natural-c1-teams','C1'],['sustained-clock-history','C1']]){
  assert.deepEqual(courseLevels.filter(level=>roadmapLessons(lessons,path,level).some(l=>l.id===id)),[home]);
 }
 const unlisted={id:'unlisted',title:'Same name',level:'C1–B1'},first={id:'first',title:'Same name',level:'A1–C2'},second={id:'second',title:'Same name',level:'B2'};
 const unordered={levels:[{id:'C2',lessonIds:['first']},{id:'B2',lessonIds:['second','first']},{id:'A2',lessonIds:['first']}]};
 const before=JSON.stringify([unlisted,first,second,unordered]),sequence=lessonSequence([unlisted,first,second,first],unordered);
 assert.deepEqual(sequence.map(r=>[r.lesson.id,r.level]),[['first','A2'],['unlisted','B1'],['second','B2']]);
 assert.equal(JSON.stringify([unlisted,first,second,unordered]),before);
 assert.equal(roadmapLessons([first,second],unordered,'A1','same name',true).length,2,'similar names do not establish equivalence');
});

test('explicit source relations retain safe distinct links without inflating the main course or changing progress',()=>{
 const lesson={id:'main',title:'<Main>',goal:'Own answer',level:'B1–C2',minutes:20,exercises:[{id:'e1',kind:'write'}]},state={attempts:[{lessonId:'main',exerciseId:'e1',feedback:{verdict:'correct'}}],read:{}};
 const relations=[{kind:'book',id:'grammar-intermediate-003',title:'<Book>',relation:'alternative'},{kind:'lesson',id:'next',title:'Next skill',relation:'related'},{kind:'lesson',id:'main',title:'Self',relation:'alternative'},{kind:'book',id:'../secret',title:'Unsafe',relation:'related'}];
 const before=JSON.stringify({lesson,state,relations}),html=roadmapLessonHTML(lesson,state,'B1',[...relations,relations[0]]);
 assert.equal(lessonSourceRelations('main',[...relations,relations[0]]).length,2);
 assert.match(html,/>B1<small>1\/1/);assert.doesNotMatch(html,/B1–C2|href="[^\"]*\.\./);
 assert.match(html,/Альтернатива/);assert.match(html,/Связанный материал/);assert.match(html,/&lt;Book&gt;/);
 assert.match(html,/Другое объяснение, дополнительные упражнения и нюансы этой темы\./);
 assert.equal((html.match(/href="#\/lesson\/main"/g)||[]).length,1);
 assert.equal(JSON.stringify({lesson,state,relations}),before);
});

test('roadmap inflects actual course counts and retains the full ready ratio after loading',async t=>{
 const f=await studyUI(t,'journey.js',{'curriculum-coverage':{mountCurriculumCoverage(){},loadCurriculumCoverage:async()=>null}});
 const lessons=Array.from({length:5},(_,i)=>({id:'lesson-'+i,title:i?'Practice':'Find this lesson',goal:'Explain the idea.',level:'B1',group:'Core',minutes:20,exercises:[{id:'e1',kind:'write'}]}));
 const units=Array.from({length:931},(_,i)=>({id:'unit-'+i})),data={lessons,library:{books:[{units}]},studyRoute:{version:1,overviewLessonIds:['lesson-4'],relations:[],deepening:[]},state:{attempts:[],read:{},drafts:{}}};
 f.api=async()=>({units:Object.fromEntries(units.map(u=>[u.id,{status:'ready'}]))});f.module.mountRoadmap(f.root,data,'B1');await new Promise(setImmediate);
 assert.equal(f.root.querySelector('#path-main-label').textContent,'занятия основной программы');assert.equal(f.root.querySelector('[data-level-count="B1"]').textContent,'4 занятия');
 assert.match(f.root.querySelector('#path-list').innerHTML,/>4 занятия</);assert.match(f.root.querySelector('#path-overviews').innerHTML,/1 обзорное занятие/);
 const ratio=f.root.querySelector('#path-book-ready');assert.ok(ratio.classList.contains('path-book-ratio'));assert.equal(ratio.innerHTML.replace(/<[^>]+>/g,''),'931 / 931');
 const search=f.root.querySelector('#lesson-search');search.value='Find this lesson';search.oninput({target:search});assert.match(f.root.querySelector('#path-list').innerHTML,/>1 занятие</);
 assert.equal(f.root.querySelector('#path-main-count').textContent,4,'search cannot change whole-course counts');
});

test('roadmap totals, home badges and next-level navigation agree without replaying a finished level',async t=>{
 const f=await studyUI(t,'journey.js',{'curriculum-coverage':{mountCurriculumCoverage(){},loadCurriculumCoverage:async()=>null}});
 const first={id:'first',title:'First lesson',goal:'Explain the idea.',level:'B1–C2',group:'Core',minutes:20,exercises:[{id:'e1',kind:'write'}]},second={...first,id:'second',title:'Second lesson',level:'C2'};
 const data={lessons:[first,second,first],learningPath:{levels:[{id:'C2',lessonIds:['first','second']},{id:'B1',lessonIds:['first']}]},state:{attempts:[{lessonId:'first',exerciseId:'e1',feedback:{verdict:'correct'}}],read:{},drafts:{}}};
 const before=JSON.stringify(data);f.api=async()=>({units:{}});f.module.mountRoadmap(f.root,data,'B1');
 assert.equal(f.root.querySelector('#path-main-count').textContent,2);assert.equal(f.root.querySelector('#path-task-count').textContent,2);assert.equal(f.root.querySelector('#path-done-count').textContent,1);
 assert.match(f.root.querySelector('#level-focus').innerHTML,/1 из 1/);assert.doesNotMatch(f.root.querySelector('#level-focus').innerHTML,/#\/lesson\/first/);
 f.root.querySelector('[data-path-next-level="C2"]').click();
 assert.match(f.root.querySelector('#path-list').innerHTML,/#\/lesson\/second/);assert.doesNotMatch(f.root.querySelector('#path-list').innerHTML,/#\/lesson\/first/);
 const all=f.root.querySelector('#all-levels');all.checked=true;all.onchange();
 assert.equal((f.root.querySelector('#path-list').innerHTML.match(/href="#\/lesson\/first"/g)||[]).length,1);
 assert.equal(JSON.stringify(data),before);assert.equal(f.local.get('roadmap-level'),'C2');
});

test('the actual study route separates 22 optional overviews from 163 main lessons and retains distinct deepening',async t=>{
 const route=read('study-route.json'),overview=new Set(route.overviewLessonIds),main=roadmapLessons(lessons,path,null,'',true,route);
 assert.equal(overview.size,22);assert.equal(main.length,163);assert.equal(new Set(main.map(l=>l.id)).size,163);
 assert.ok(main.every(l=>!overview.has(l.id)));assert.equal(courseLevels.reduce((n,level)=>n+roadmapLessons(lessons,path,level,'',false,route).length,0),163);
 assert.ok(route.deepening.every(item=>main.some(l=>l.id===item.lessonId)));
 const f=await studyUI(t,'journey.js',{'curriculum-coverage':{mountCurriculumCoverage(){},loadCurriculumCoverage:async()=>null}}),data={lessons,learningPath:path,studyRoute:route,state:{attempts:[],read:{},drafts:{}}};
 const before=JSON.stringify(data);f.api=async()=>({units:{}});f.module.mountRoadmap(f.root,data,'B2');
 assert.equal(f.root.querySelector('#path-main-count').textContent,163);
 const optional=f.root.querySelector('#path-overviews').innerHTML;assert.match(optional,/22 обзорных занятия/);assert.match(optional,/Необязательное закрепление/);
 for(const id of overview)assert.match(optional,new RegExp('href="#/lesson/'+id+'"'));
 assert.match(f.root.querySelector('#path-list').innerHTML,/Углубление темы/);assert.match(f.root.querySelector('#path-list').innerHTML,/Опора перед занятием/);
 f.root.querySelector('[data-level="A1"]').click();assert.match(f.root.querySelector('#path-list').innerHTML,/grammar-intermediate-001/);assert.match(f.root.querySelector('#path-list').innerHTML,/Связанный материал/);
 assert.equal(JSON.stringify(data),before,'route grouping cannot migrate or fabricate learner evidence');
 assert.equal(lessonRouteInfo('present',{...route,version:999}).introduction,true,'unknown schema must not silently hide content');
});

test('reviewed deepening outcomes follow their prerequisites and optional overlaps remain reachable',()=>{
 const route=read('study-route.json'),main=roadmapLessons(lessons,path,null,'',true,route),position=new Map(main.map((l,i)=>[l.id,i]));
 assert.equal(route.deepening.length,27);
 for(const relation of route.deepening){
  assert.ok(position.has(relation.afterLessonId)&&position.has(relation.lessonId));
  assert.ok(position.get(relation.afterLessonId)<position.get(relation.lessonId),`${relation.lessonId} must follow ${relation.afterLessonId}`);
  assert.ok(relation.reason.trim().length>30,'the additional outcome is explained');
 }
 for(const id of ['path-cross-register','research-complaint-resolution','path-debate-synthesis']){
  assert.ok(route.overviewLessonIds.includes(id));assert.equal(position.has(id),false);
  assert.ok(route.relations.some(r=>r.kind==='lesson'&&r.id===id&&position.has(r.lessonId)),'an optional alternative stays attached to a main outcome');
 }
 assert.ok(position.has('extended-c2-register-performance'));assert.ok(position.has('extended-c2-consensus'),'different additional outcomes remain main work');
});

test('the C2 capstone stays last after explicit and future unlisted same-level additions',()=>{
 const additional={id:'future-c2',level:'C2',title:'An additional outcome'},sequence=lessonSequence([...lessons,additional],path),c2=sequence.filter(r=>r.level==='C2');
 assert.equal(c2.at(-1).lesson.id,'path-c2-capstone');
 assert.ok(c2.slice(0,-1).some(r=>r.lesson.id===additional.id));
 assert.equal(path.levels.find(l=>l.id==='C2').lessonIds.at(-1),'path-c2-capstone');
 const differentHome={levels:[{id:'A1',lessonIds:['early']},{id:'C2',lessonIds:['late'],finalLessonIds:['early']}]};
 assert.deepEqual(lessonSequence([{id:'early',level:'A1'},{id:'late',level:'C2'}],differentHome).map(r=>[r.lesson.id,r.level]),[['early','A1'],['late','C2']]);
});

test('actual rendered main links preserve all planned prerequisite edges and end with the C2 capstone',async t=>{
 const route=read('study-route.json'),f=await studyUI(t,'journey.js',{'curriculum-coverage':{mountCurriculumCoverage(){},loadCurriculumCoverage:async()=>null}});
 const data={lessons,learningPath:path,studyRoute:route,state:{attempts:[],read:{},drafts:{}}};f.api=async()=>({units:{}});f.module.mountRoadmap(f.root,data,'A1');
 const rendered=[];
 for(const level of courseLevels){
  f.root.querySelector(`[data-level="${level}"]`).click();
  const list=f.root.querySelector('#path-list'),ids=list.querySelectorAll('a').filter(a=>a.attrs.class==='path-lesson').map(a=>a.attrs.href.slice('#/lesson/'.length));
  assert.deepEqual(ids,roadmapLessons(lessons,path,level,'',false,route).map(l=>l.id),level+' primary DOM order differs from next-step order');
  if(level==='A1'){assert.match(list.innerHTML,/<h2>Произношение и аудирование<\/h2>/);assert.doesNotMatch(list.innerHTML,/<h2>Произношение и (слух|слушание)<\/h2>/);}
  if(level==='C2'){assert.equal(ids.at(-1),'path-c2-capstone');assert.match(list.innerHTML,/<h2>Итоговая мастерская C2<\/h2>/);}
  rendered.push(...ids);
 }
 assert.equal(rendered.length,163);assert.equal(new Set(rendered).size,163);
 for(const edge of route.deepening)assert.ok(rendered.indexOf(edge.afterLessonId)<rendered.indexOf(edge.lessonId),`${edge.lessonId} is rendered before ${edge.afterLessonId}`);
 const groups=roadmapLessonGroups([{id:'first',group:'Произношение и слух'},{id:'second',group:'Произношение и слушание'}]);
 assert.equal(groups.length,1);assert.deepEqual(groups[0].lessons.map(l=>l.id),['first','second']);
});

test('library search finds Russian topic descriptions and exact unit numbers across the books',()=>{
 const rows=library.books.filter(b=>!b.duplicateOf).flatMap(book=>book.units.map(unit=>({book,unit})));
 const matches=query=>rows.filter(({book,unit})=>libraryUnitMatches(book,unit,query));
 assert.ok(matches(' ПРЯМО СЕЙЧАС ').some(({unit})=>unit.id==='grammar-intermediate-001'));
 const numbered=matches('003');
 assert.equal(numbered.length,library.books.filter(b=>!b.duplicateOf).length);
 assert.ok(numbered.every(({unit})=>unit.unit===3));
 assert.ok(matches('Present continuous').length>1);
 assert.equal(matches('not a real book topic 998877').length,0);
});

test('read status survives either Murphy edition, legacy progress and prepared lesson availability',()=>{
 const duplicate=library.books.find(b=>b.duplicateOf).units[0];
 const canonical=library.books.flatMap(b=>b.units).find(u=>u.id===duplicate.equivalentUnitId);
 const status={units:{[canonical.id]:{status:'ready'}}};
 for(const key of [canonical.id,duplicate.id,'book-'+canonical.id,'book-'+duplicate.id]){
  const completed=readLibraryUnits(library.books,{[key]:'2026-09-10T12:00:00Z'});
  assert.ok(completed.has(canonical.id),key);
  assert.deepEqual(libraryUnitStatus(canonical,status,completed,'B1'),{label:'Прочитано',tone:'green'});
  assert.deepEqual(libraryUnitStatus(duplicate,status,completed,'B1'),{label:'Прочитано',tone:'green'});
 }
 const unread=readLibraryUnits(library.books,{});
 assert.deepEqual(libraryUnitStatus(duplicate,status,unread,'B1'),{label:'Урок готов',tone:'blue'});
 assert.deepEqual(libraryUnitStatus(canonical,{units:{}},unread,'B1'),{label:'B1',tone:''});
});
