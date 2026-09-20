import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {teachingVisuals,lessonDiagramHTML,visualSentence,bindLessonVisuals} from '../lesson-visuals.js';
import {courseGuideHTML,lessonVisual,lessonVisualSupportHTML} from '../course-guide.js';
import {beginnerBookNotes} from '../book-beginner-notes.js';
import {bookBeginnerNotesHTML} from '../book-preparation.js';
const dir=new URL('../../content/',import.meta.url),read=n=>JSON.parse(readFileSync(new URL(n,dir),'utf8'));
const lessons=[...read('curriculum.json'),...readdirSync(new URL('courses/',dir)).filter(n=>n.endsWith('.json')).flatMap(n=>read('courses/'+n))];

test('visual explanations cover every foundational A1/A2 lesson and only existing topics',()=>{
 assert.equal(Object.keys(teachingVisuals).length,70);
 for(const l of lessons.filter(l=>l.beginner))assert.ok(teachingVisuals[l.id],l.id);
 let examples=0;
 for(const [id,v] of Object.entries(teachingVisuals)){
  assert.ok(lessons.some(l=>l.id===id),id);assert.ok(v.title&&v.why);
  assert.ok(v.items.length>=2&&v.items.length<=4,id);
  assert.ok(['sequence','contrast','timeline','scale'].includes(v.kind));
  for(const item of v.items)assert.ok(item.label&&item.en&&item.ru&&item.note,id);
  assert.equal((lessonDiagramHTML({id}).match(/data-visual-speak=/g)||[]).length,v.items.length);
  examples+=v.items.length;
 }
 assert.equal(examples,214);
});

test('visual support is optional and does not dump later forms before the first beginner step',()=>{
 const l=lessons.find(l=>l.id==='path-be'),html=courseGuideHTML(l,0);
 assert.match(html,/<details class="course-visual-support">/);
 assert.doesNotMatch(html,/course-visual-support" open/);
 assert.equal(lessonDiagramHTML({id:'missing'}),'');
 assert.equal(lessonVisualSupportHTML({id:'missing'}),'');
 assert.equal(visualSentence('I am ready.','path-be'),'I <mark>am</mark> ready.');
 assert.equal(visualSentence('This is a sample.','path-be'),'This <mark>is</mark> a sample.');
 assert.doesNotMatch(visualSentence('<script>am</script>','path-be'),/<script>/);
});

test('all nine original images are attached to a suitable course explanation and have English audio',()=>{
 const used=new Set();
 for(const lesson of lessons){
  const scene=lessonVisual(lesson);if(!scene)continue;
  used.add(scene.file);assert.ok(existsSync(new URL('../assets/course-scenes/'+scene.file,import.meta.url)));
  assert.ok(scene.alt&&scene.en&&scene.ru&&scene.why);
  assert.match(lessonVisualSupportHTML(lesson),/data-scene-speak/);
 }
 assert.equal(used.size,9);
 assert.doesNotMatch(lessonVisual({id:'path-plurals'}).en,/Some water/,'countability is not taught yet');
});

test('recall hides and restores English, notes and footnotes without writing a graded attempt',()=>{
 const answers=[{hidden:false},{hidden:false}],prompts=[{hidden:true},{hidden:true}];
 const panel={querySelectorAll:s=>s==='.diagram-recall-prompt'?prompts:answers};
 const button={pressed:'false',getAttribute(){return this.pressed},setAttribute(k,v){this.pressed=v},closest:()=>panel};
 bindLessonVisuals({querySelectorAll:s=>s==='[data-visual-recall]'?[button]:[]},{id:'path-be'});
 button.onclick();assert.equal(button.pressed,'true');assert.ok(answers.every(n=>n.hidden));assert.ok(prompts.every(n=>!n.hidden));
 button.onclick();assert.equal(button.pressed,'false');assert.ok(answers.every(n=>!n.hidden));assert.ok(prompts.every(n=>n.hidden));
});

test('the reviewed first ten book chapters have exact extra supports with audio and translated vocabulary',()=>{
 const book=read('library.json').books.find(b=>b.id==='grammar-elementary');
 assert.equal(Object.keys(beginnerBookNotes).length,10);
 for(const unit of book.units.slice(0,10)){
  const n=beginnerBookNotes[unit.id];assert.ok(n?.body&&n?.title,unit.id);
  for(const e of [...n.examples,...n.vocabulary])assert.ok(e.en&&e.ru);
  assert.equal((bookBeginnerNotesHTML(unit.id).match(/data-book-note-speak=/g)||[]).length,n.examples.length);
 }
 assert.match(bookBeginnerNotesHTML('grammar-elementary-001'),/visitors/);
 assert.match(bookBeginnerNotesHTML('grammar-elementary-010'),/was/);
 assert.match(bookBeginnerNotesHTML('grammar-elementary-010'),/were/);
 assert.equal(bookBeginnerNotesHTML('grammar-elementary-011'),'');
});
