import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {lessonSequence} from '../lesson-sequence.js';
import {lessonIntroHTML,lessonIntroParts} from '../lesson-intro.js';
import {isGuidedLesson} from '../authored-exercise.js';
import {esc} from '../core.js';

// Invariants of docs/COURSE-STANDARD.md for every rewritten lesson. The full
// editorial gate is app/scripts/course_standard_lint.py; this keeps the
// essentials from regressing in ordinary test runs.
const dir=new URL('../../content/',import.meta.url),read=n=>JSON.parse(readFileSync(new URL(n,dir),'utf8'));
const lessons=[...read('curriculum.json'),...readdirSync(new URL('courses/',dir)).filter(n=>n.endsWith('.json')).flatMap(n=>read('courses/'+n))];
const guides=readdirSync(dir).filter(n=>/^course-guides-.*\.json$/.test(n)).flatMap(n=>read(n).lessons);
const guided=lessons.filter(l=>l.guided);
const norm=s=>String(s||'').toLowerCase().replace(/[\s’'".,!?;:—–-]+/g,' ').trim();
const british=/(?<![A-Za-z'’-])(colour|favourite|centre|theatre|organis(e|ed|ing|ation)|realis(e|ed)|programme|travelled|cancelled|neighbour|behaviour|grey|learnt|whilst|autumn|mobile phone|ground floor|at the weekend|Have you got|have got|has got|CV|£)(?![A-Za-z-])/;

test('guided lessons carry one explanation layer and teach before asking',()=>{
 assert.ok(guided.length>0);
 for(const l of guided){
  assert.ok(!guides.some(g=>g.lessonId===l.id),'second explanation layer: '+l.id);
  assert.ok(isGuidedLesson(l));
  const stages=l.exercises.map(e=>e.practiceStage);
  assert.equal(stages[0],'guided',l.id);
  assert.ok(stages.includes('independent'),l.id);
  assert.ok(!stages.slice(stages.indexOf('independent')).includes('guided'),'guided after independent: '+l.id);
  const sections=new Set(l.sections.map(s=>norm(s.body))),cards=new Set();
  for(const e of l.exercises){
   if(e.guidance){
    for(const k of ['title','body','example','translation'])assert.ok(e.guidance[k]?.trim(),l.id+e.id+k);
    assert.ok(!sections.has(norm(e.guidance.body)),'card copies theory: '+l.id+'/'+e.id);
    assert.ok(!cards.has(norm(e.guidance.body)),'card repeated: '+l.id+'/'+e.id);cards.add(norm(e.guidance.body));
    assert.notEqual(norm(e.hint),norm(e.guidance.body),'hint repeats card: '+l.id+'/'+e.id);
    assert.ok(!(e.answers||[]).some(a=>norm(a)===norm(e.guidance.example)),'card example gives the answer: '+l.id+'/'+e.id);
   }
   assert.notEqual(norm(e.hint),norm(l.goal),'hint repeats goal: '+l.id+'/'+e.id);
   for(const a of e.answers||[]){assert.doesNotMatch(a,/[А-Яа-яЁё]/,l.id+'/'+e.id);assert.doesNotMatch(a,british,'British form in answer: '+l.id+'/'+e.id);}
  }
  const contexts=l.exercises.map(e=>norm(e.context)).filter(Boolean);
  for(const c of new Set(contexts))assert.ok(contexts.filter(x=>x===c).length<=2,'repeated context: '+l.id);
  for(const e of l.examples)assert.doesNotMatch(e.en,british,'British form in example: '+l.id);
  for(const m of l.materials||[])if(!m.audioFile&&!m.sourceUrl&&!m.inputSkill)assert.doesNotMatch(m.text,british,'British form in material: '+l.id+'/'+m.id);
  assert.ok((l.sources||[]).length>=1&&l.sources.every(s=>s.url.startsWith('https://')&&s.title&&s.notes),'checked sources: '+l.id);
 }
});

test('prerequisites and recycled topics come earlier in the one route',()=>{
 const order=lessonSequence(lessons,read('learning-path.json')).map(r=>r.lesson.id),at=new Map(order.map((id,i)=>[id,i]));
 for(const l of guided)for(const id of [...(l.prerequisites||[]),...(l.recycles||[])]){
  assert.ok(at.has(id),l.id+' refers to missing '+id);
  assert.ok(at.get(id)<at.get(l.id),l.id+' depends on later '+id);
 }
});

test('the introduction shows the opening idea once and later points arrive before their tasks',()=>{
 for(const l of guided){
  const parts=lessonIntroParts(l),html=lessonIntroHTML(l,0,lessons);
  assert.ok(parts.sections.length>=1);
  for(const s of parts.sections)assert.ok(html.includes(esc(s.title)),l.id);
  if(parts.later)assert.match(html,/Остальное разберём по шагам/);
  assert.doesNotMatch(lessonIntroHTML({...l,title:'<script>',sections:[{title:'<img onerror=1>',body:'<b>'}],sources:[{title:'<x>',url:'https://example.com/"><script>',notes:'<y>'}]}),/<script>|<img onerror|<b>|<x>|<y>/);
 }
});
