import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {lessonSequence,lessonRouteInfo} from '../lesson-sequence.js';
import {bookPreparation,bookPreparationHTML} from '../book-preparation.js';
import {courseGuideHTML,lessonVisual} from '../course-guide.js';
import {beginnerPlan} from '../beginner-plan.js';
const dir=new URL('../../content/',import.meta.url),read=n=>JSON.parse(readFileSync(new URL(n,dir),'utf8'));
const base=[...read('curriculum.json'),...readdirSync(new URL('courses/',dir)).filter(n=>n.endsWith('.json')).flatMap(n=>read('courses/'+n))];
const guides=readdirSync(dir).filter(n=>/^course-guides-.*\.json$/.test(n)).flatMap(n=>read(n).lessons);
const lessons=base.map(l=>{const g=guides.find(g=>g.lessonId===l.id);return g?{...l,courseGuide:g,prerequisites:g.prerequisites,exercises:[...g.practice.map(e=>({...e,revision:e.revision||1})),...l.exercises.map(e=>(g.replacements||[]).find(r=>r.id===e.id)||e)]}:l;});
const path=read('learning-path.json'),library=read('library.json');
test('every authored course step has teaching and its dependencies precede it, without repeated topics',()=>{
 assert.equal(new Set(guides.map(g=>g.lessonId)).size,guides.length);
 assert.equal(lessons.length,215);
 const sequence=lessonSequence(lessons,path),seen=new Set();
 for(const {lesson:l,level} of sequence){
  assert.ok(l.beginner||l.courseGuide,'missing guide: '+l.id);
  for(const id of l.prerequisites||[])assert.ok(seen.has(id),l.id+' depends on missing/later '+id);
  seen.add(l.id);
  if(l.courseGuide){
   assert.ok(l.exercises.slice(0,2).every(e=>e.guidance&&e.practiceStage==='guided'));
   assert.ok(l.courseGuide.explanation.every(s=>s.body.length<1800),'intro must stay readable: '+l.id);
   if(['A1','A2'].includes(level))assert.ok(l.exercises.slice(0,2).every(e=>e.answers[0].split(/\s+/).length<=24),'short preparation: '+l.id);
  }
 }
 const main=sequence.filter(r=>!r.lesson.id.startsWith('cinema-')&&lessonRouteInfo(r.lesson.id,read('study-route.json')).introduction);
 assert.equal(main.length,163);assert.equal(main[0].lesson.id,'path-be');assert.equal(main.at(-1).lesson.id,'path-c2-capstone');
});
test('all 872 canonical book chapters have real language supports; duplicate editions preserve canonical IDs',()=>{
 const canonical=new Set();
 for(const book of library.books)for(const unit of book.units){
  const p=bookPreparation(book,unit,lessons);assert.ok(p.requestedIds.length,unit.id);
  assert.equal(p.supports.length,new Set(p.requestedIds).size,unit.id);
  canonical.add(p.unitId);
  if(unit.equivalentUnitId)assert.equal(p.unitId,unit.equivalentUnitId);
 }
 assert.equal(canonical.size,872);
 const first=library.books.find(b=>b.id==='grammar-elementary');
 assert.deepEqual(bookPreparation(first,first.units[0],lessons).requestedIds,['path-be']);
 assert.ok(bookPreparationHTML(first,first.units[0],lessons).includes('#/lesson/path-be'));
 for(const [bookId,n,expected] of [
  ['grammar-elementary',36,'path-past-habits'],['grammar-elementary',66,'path-plurals'],
  ['grammar-intermediate',1,'path-present-continuous'],['grammar-intermediate',9,'path-present-perfect-continuous'],
  ['grammar-intermediate',16,'path-past-perfect-continuous'],['grammar-advanced',1,'path-present-continuous'],
  ['grammar-advanced',25,'path-passive-advanced'],['grammar-advanced',95,'path-there-is']
 ]){const book=library.books.find(b=>b.id===bookId),unit=book.units.find(u=>u.unit===n);assert.equal(bookPreparation(book,unit,lessons).supports[0].id,expected,unit.title);}
});
test('new beginners stay on small supported practice after the first 30 foundation lessons',()=>{
 const now=new Date('2026-09-20T12:00:00Z'),attempts=lessons.filter(l=>l.beginner).flatMap(l=>l.exercises.map(e=>({lessonId:l.id,exerciseId:e.revision?e.id+'--revision-'+e.revision:e.id,answer:e.answers[0],at:now.toISOString(),feedback:{verdict:'correct'}})));
 const plan=beginnerPlan({lessons,learningPath:path,state:{attempts,cards:[]}},{level:'A1',minutes:60,domain:'everyday'},now);
 assert.ok(plan?.beginner);assert.ok(plan.blocks.every(b=>b.href.startsWith('#/lesson/')));
 assert.ok(plan.blocks.some(b=>b.target.exerciseIds.some(id=>id.startsWith('prepare-'))));
});
test('teaching renders escaped examples and actual illustration assets for the right topics',()=>{
 const g=lessons.find(l=>l.id==='path-present-perfect-continuous');
 assert.match(courseGuideHTML(g,0),/details class="course-guide card" open/);
 assert.ok(!courseGuideHTML(g,1).includes('card" open'));
 const malicious={...g,title:'<script>',courseGuide:{...g.courseGuide,purpose:'<script>'}};
 assert.ok(!courseGuideHTML(malicious).includes('<script>'));
 for(const id of ['path-articles-basic','path-present-perfect','path-deduction']){
  const visual=lessonVisual({id});assert.ok(visual);
  assert.ok(existsSync(new URL('../assets/course-scenes/'+visual.file,import.meta.url)));
 }
 assert.equal(lessonVisual({id:'path-be'}).en,'I am ready. I am tired.','the first be illustration must use only the taught am forms');
});
