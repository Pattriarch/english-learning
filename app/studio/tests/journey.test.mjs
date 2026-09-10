import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {roadmapLessons,libraryUnitMatches,readLibraryUnits,libraryUnitStatus} from '../journey.js';

const content=new URL('../../content/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,content),'utf8'));
const library=read('library.json');
const path=read('learning-path.json');
const lessons=[...read('curriculum.json'),...readdirSync(new URL('courses/',content)).filter(n=>n.endsWith('.json')).flatMap(n=>read('courses/'+n))];

test('the roadmap starts each level in its published learning order and keeps cinema separate',()=>{
 for(const level of path.levels){
  const result=roadmapLessons(lessons,path,level.id);
  assert.deepEqual(result.slice(0,level.lessonIds.length).map(l=>l.id),level.lessonIds,level.id);
  assert.ok(result.every(l=>!l.id.startsWith('cinema-')));
 }
 const before=lessons.map(l=>l.id);
 assert.ok(roadmapLessons(lessons,path,'A1','past perfect',true).some(l=>l.id==='path-past-perfect'));
 assert.deepEqual(roadmapLessons(lessons,path,'A1','past perfect').map(l=>l.id),[]);
 assert.deepEqual(lessons.map(l=>l.id),before,'filtering must not reorder the shared lesson list');
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
