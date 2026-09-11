import test from 'node:test';
import assert from 'node:assert/strict';
import {bookIntakeSummary,bookIntakeNotice} from '../book-intake.js';
import {studyUI} from './study-ui-fixture.mjs';

const status=(cataloged,ready)=>({total:872+cataloged,ready:872+ready,intake:{state:'available',total:59,books:6,ready,pending:59-ready,cataloged,complete:ready===59}});

test('baseline, partial and full new-book releases retain one combined chapter count',()=>{
 for(const [cataloged,ready]of [[0,0],[1,1],[59,58],[59,59]]){
  const source=status(cataloged,ready),before=JSON.stringify(source),summary=bookIntakeSummary(source);
  assert.equal(summary.plannedTotal,931);assert.equal(summary.pending,59-ready);assert.equal(JSON.stringify(source),before);
  const html=bookIntakeNotice(source);assert.match(html,new RegExp(ready+' / 59'));
  if(ready<59){assert.match(html,/в книжном плане/);assert.doesNotMatch(html,/доступно целиком/);}
  else{assert.match(html,/Дополнение доступно целиком/);assert.doesNotMatch(html,/990|Пока недоступно/);}
 }
});

test('missing, malformed or contradictory intake status cannot announce zero-of-zero completion',()=>{
 for(const source of [null,{}, {intake:{state:'missing'}},{intake:{state:'invalid'}}, {...status(0,0),intake:{...status(0,0).intake,total:0}},status(0,59),{...status(59,59),total:20}, {...status(1,1),intake:{...status(1,1).intake,pending:0}}]){
  assert.equal(bookIntakeSummary(source),null);const html=bookIntakeNotice(source);
  assert.match(html,/пока недоступен/);assert.doesNotMatch(html,/доступно целиком|0 \/ 0|931/);
 }
 const claimsComplete={...status(0,0),intake:{...status(0,0).intake,complete:true}};
 assert.match(bookIntakeNotice(claimsComplete),/Пока недоступно: 59/,'derive availability from actual counts, not a standalone completion flag');
});

test('roadmap shows published chapters and the separate unfinished intake without inflating authored lessons',async t=>{
 const f=await studyUI(t,'journey.js',{'curriculum-coverage':{mountCurriculumCoverage(){},loadCurriculumCoverage:async()=>null}});
 const lesson={id:'main',title:'One actual topic',level:'B1',goal:'Produce an answer.',exercises:[{id:'e1'}]},data={lessons:[lesson],library:{books:[]},state:{attempts:[],drafts:{},read:{}}};
 f.api=async()=>status(0,0);f.module.mountRoadmap(f.root,data,'B1');await new Promise(setImmediate);
 assert.equal(f.root.querySelector('#path-main-count').textContent,1);
 assert.equal(f.root.querySelector('#path-book-ready').innerHTML.replace(/<[^>]+>/g,''),'872 / 872');
 const note=f.root.querySelector('#path-book-intake').innerHTML;assert.match(note,/0 \/ 59/);assert.match(note,/931 глава/);assert.match(note,/Пока недоступно: 59/);
});

test('unavailable status stays explicit in the roadmap while the main course remains accessible',async t=>{
 const f=await studyUI(t,'journey.js',{'curriculum-coverage':{mountCurriculumCoverage(){},loadCurriculumCoverage:async()=>null}}),data={lessons:[],state:{attempts:[],drafts:{},read:{}}};
 f.api=async()=>{throw Error('Temporary availability failure');};f.module.mountRoadmap(f.root,data,'B1');await new Promise(setImmediate);
 assert.match(f.root.querySelector('#path-book-intake').innerHTML,/готовность новых глав сейчас не подтверждена/i);assert.ok(f.root.querySelector('#path-list'));
});

test('books hide duplicate editions and keep the pending new-book count through status polling',async t=>{
 let poll;t.mock.method(globalThis,'setTimeout',fn=>{poll=fn;return 0;});
 const f=await studyUI(t,'journey.js',{'curriculum-coverage':{mountCurriculumCoverage(){},loadCurriculumCoverage:async()=>null}}),unit={id:'base-001',unit:1,title:'Original topic',page:1,endPage:2};
 const book={id:'base',title:'English Grammar in Use',level:'B1',unitCount:1,units:[unit]},data={library:{uniqueUnits:1,totalUnits:2,books:[book,{...book,id:'copy',duplicateOf:'base',units:[{...unit,id:'copy-001',equivalentUnitId:unit.id}]}]},state:{attempts:[],drafts:{},read:{}}};
 let current={total:1,ready:1,units:{[unit.id]:{status:'ready'}},books:{base:{ready:1}},intake:{state:'available',total:2,ready:0,pending:2,cataloged:0,books:1}};
 location.hash='#/books';f.fetch=async()=>({ok:true,json:async()=>current});await f.module.mountLibrary(f.root,data);
 assert.match(f.root.querySelector('#library-book-intake').innerHTML,/0 \/ 2/);assert.match(f.root.querySelector('#library-book-intake').innerHTML,/3 главы/);
 assert.doesNotMatch(f.root.querySelector('#unit-list').innerHTML,/#\/unit\/copy-001/);
 assert.match(f.root.querySelector('#unit-list').innerHTML,/#\/unit\/base-001/);
 current={...current,total:3,ready:3,intake:{state:'available',total:2,ready:2,pending:0,cataloged:2,books:1}};await poll();
 assert.match(f.root.querySelector('.library-build-summary').innerHTML,/3 из 3/,'fresh server counts cannot render as three ready out of one');
 assert.match(f.root.querySelector('#library-book-intake').innerHTML,/Дополнение доступно целиком/);
 assert.equal(bookIntakeSummary(current).plannedTotal,3,'published intake is never added twice');
});

test('expanded bookshelf labels other coursebooks honestly and reuses valid cover colors',async t=>{
 t.mock.method(globalThis,'setTimeout',()=>0);
 const f=await studyUI(t,'journey.js',{'curriculum-coverage':{mountCurriculumCoverage(){},loadCurriculumCoverage:async()=>null}});
 const titles=['English Grammar in Use',...Array.from({length:9},(_,i)=>'Vocabulary '+i),'Clear Speech','Great Writing 1','Viewpoint 1'];
 const books=titles.map((title,i)=>({id:'book-'+i,title,level:'B1',unitCount:1,units:[{id:'book-'+i+'-001',unit:1,title:'Chapter',page:1,endPage:2}]}));
 f.fetch=async()=>({ok:true,json:async()=>({total:13,ready:0,units:{},books:{}})});location.hash='#/books';
 await f.module.mountLibrary(f.root,{library:{uniqueUnits:13,totalUnits:13,books},state:{attempts:[],drafts:{},read:{}}});
 const html=f.root.innerHTML,colors=f.root.querySelectorAll('.shelf-book').map(book=>book.attrs.style);
 assert.equal((html.match(/<span>IN USE<\/span>/g)||[]).length,1);
 assert.equal((html.match(/<span>COURSEBOOK<\/span>/g)||[]).length,12);
 assert.equal(colors.length,13);assert.ok(colors.every(color=>/^--book-hue:\d+$/.test(color)));
 assert.equal(colors[0],colors[10]);assert.equal(colors[1],colors[11]);
});
