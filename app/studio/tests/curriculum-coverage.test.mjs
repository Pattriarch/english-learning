import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preparedCoverageModule,coverageSummary,coverageSupplementGroups,sourceURL} from '../curriculum-coverage-model.js';

const read=name=>JSON.parse(readFileSync(new URL('../../content/'+name,import.meta.url),'utf8'));
const plan=read('extended-course-plan.json'),audit=read('curriculum-gap-audit.json');
const metadata={...audit,modules:plan.modules,bookSupplements:read('book-supplements.json')};
const makeLesson=m=>({id:m.id,title:m.title,level:m.level,sections:[{body:'A complete explanation.'}],materials:m.materials.map(x=>({id:x.id,text:'Complete source text.'})),exercises:m.exercisePlan.map((e,i)=>({id:'e'+(i+1),prompt:'Write your own answer.',materialIds:e.materialIds}))});

test('planned metadata and previous lesson progress never count as available extended lessons',()=>{
 const summary=coverageSummary(metadata,[]);
 assert.equal(summary.total,plan.modules.length);assert.equal(summary.available,0);assert.equal(summary.planned,plan.modules.length);
 const legacy={id:'path-source-mediation',title:'Existing topic',exercises:[{id:'e1',prompt:'Answer'}]};
 assert.equal(coverageSummary(metadata,[legacy]).available,0);
 assert.ok(coverageSummary(metadata,[legacy],'C2').modules.some(m=>m.relatedLessons.includes(legacy)));
});

test('publication requires complete material and exercise references, not a matching id or stub',()=>{
 const module=plan.modules[0],lesson=makeLesson(module);
 assert.equal(preparedCoverageModule(module,lesson),true);
 for(const broken of [{...lesson,materials:[]},{...lesson,exercises:lesson.exercises.slice(1)},{...lesson,sections:[]},{...lesson,materials:lesson.materials.map((m,i)=>i?m:{...m,text:''})},{...lesson,exercises:lesson.exercises.map((e,i)=>i?e:{...e,materialIds:['missing']})},{...lesson,exercises:lesson.exercises.map(e=>({...e,id:'duplicate'}))}])assert.equal(preparedCoverageModule(module,broken),false);
 assert.equal(preparedCoverageModule(module,{id:module.id,title:module.title}),false);
});

test('level totals and publication update when actual lessons arrive, without mutating the frozen plan',()=>{
 const original=JSON.stringify(metadata),first=makeLesson(plan.modules.find(m=>m.level==='A1')),last=makeLesson(plan.modules.filter(m=>m.level==='C2').at(-1));
 const summary=coverageSummary(metadata,[first,last],'C2');
 assert.equal(summary.total,8);assert.equal(summary.available,1);assert.equal(summary.planned,7);assert.equal(summary.allAvailable,2);
 assert.equal(coverageSummary(metadata,[first],'A1').available,1);
 assert.equal(coverageSummary(metadata,[first],'B1').available,0);
 assert.equal(JSON.stringify(metadata),original);
 const duplicated={...metadata,modules:[...metadata.modules,metadata.modules[0]]};
 assert.equal(coverageSummary(duplicated,[first]).total,plan.modules.length);
});

test('all nine appendix families resolve to the exact 28 original PDF entries',()=>{
 const groups=coverageSupplementGroups(metadata),entries=groups.flatMap(g=>g.entries);
 assert.equal(groups.length,9);assert.equal(entries.length,28);assert.equal(new Set(entries.map(e=>e.id)).size,28);
 assert.ok(entries.every(e=>e.href.startsWith('/books/')&&e.href.endsWith('#page='+e.page)));
 assert.ok(groups.find(g=>g.id==='phonemic-chart').entries.length===3);
 assert.ok(groups.find(g=>g.id==='diagnostic-mixed').entries.length===5);
});

test('external and PDF links reject executable URLs, directory paths and invalid page numbers',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/a','not a url'])assert.equal(sourceURL(url),'');
 assert.equal(sourceURL('https://www.coe.int/'),'https://www.coe.int/');
 const item={id:'one',title:'Reference',page:-1};
 for(const filename of ['../book.pdf','C:\\private\\book.pdf','book.txt']){
  const value={supplements:{groups:[{entryIds:['one']}]},bookSupplements:{books:[{filename,entries:[item]}]}};
  assert.equal(coverageSupplementGroups(value)[0].entries[0].href,'');
 }
});
