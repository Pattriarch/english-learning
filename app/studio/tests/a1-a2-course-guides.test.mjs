import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const content=new URL('../../content/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,content),'utf8'));
const list=value=>Array.isArray(value)?value:value.lessons;

test('every applied A1/A2 lesson gets short preparation after actual prerequisites',()=>{
  const expected=['extended-skills.json','research-expansion.json','natural-listening.json'].flatMap(file=>list(read('courses/'+file))).filter(l=>['A1','A2'].includes(l.level));
  const guideSet=read('course-guides-a1-a2.json'),guides=new Map(guideSet.lessons.map(g=>[g.lessonId,g]));
  const all=list(read('curriculum.json')).concat(readdirSync(new URL('courses/',content)).filter(file=>file.endsWith('.json')).flatMap(file=>list(read('courses/'+file))));
  const lessons=new Map(all.map(l=>[l.id,l])),sourceIDs=new Set(guideSet.sources.map(s=>s.id));
  assert.equal(expected.length,20);assert.equal(guides.size,20);
  assert.equal(guideSet.lessons.reduce((n,g)=>n+g.practice.length,0),60);
  for(const lesson of expected){
    const guide=guides.get(lesson.id);assert.ok(guide,lesson.id);
    assert.ok(guide.prerequisites.length>0,lesson.id);
    for(const id of guide.prerequisites){assert.ok(lessons.has(id),`${lesson.id}: missing ${id}`);assert.notEqual(id,lesson.id);}
    assert.equal(guide.explanation.length,3);assert.equal(guide.examples.length,3);assert.equal(guide.practice.length,3);
    assert.ok(guide.sourceIds.length>0);assert.ok(guide.sourceIds.every(id=>sourceIDs.has(id)));
    for(const section of guide.explanation){assert.ok(section.title&&section.body);assert.ok(section.body.length<=700,lesson.id);}
    for(const task of guide.practice){
      assert.ok(!lesson.exercises.some(e=>e.id===task.id));assert.match(task.id,/^prepare-\d+$/);assert.ok(Number.isInteger(task.revision)&&task.revision>=1);
      assert.equal(task.practiceStage,'guided');assert.ok(task.guidance.body&&task.guidance.example&&task.guidance.translation);
      assert.ok(task.context&&task.hint&&task.explanation);
      assert.ok(task.answers.every(a=>!/[А-Яа-яЁё]/.test(a)),lesson.id);
      assert.ok(task.answers.every(a=>a.split(/\s+/).length<=14),`${lesson.id}: no long output before preparation`);
    }
    assert.equal(guide.replacements.length,lesson.exercises.length,lesson.id+' entire original lesson reviewed');
    for(const replacement of guide.replacements){
      const prior=lesson.exercises.find(e=>e.id===replacement.id);
      assert.ok(prior);assert.ok(replacement.revision>(prior.revision||0));
      assert.notEqual(replacement.prompt,prior.prompt);
      assert.ok(replacement.context&&replacement.hint&&replacement.explanation);
      if(replacement.guidance){
        assert.equal(replacement.practiceStage,'guided',lesson.id+' preparation must pass the server contract');
        for(const key of ['title','body','example','translation'])assert.ok(replacement.guidance[key]?.trim(),lesson.id+' guidance '+key);
      }
      assert.ok(replacement.answers.every(a=>a.split(/\s+/).length<=24),lesson.id+' practical short model');
      assert.doesNotMatch(replacement.prompt,/\d+\s*[–-]\s*\d+\s*(?:английских\s+)?слов/,'No minimum output length replaces a communicative task');
      for(const material of replacement.materialIds||[])assert.ok(lesson.materials.some(m=>m.id===material),lesson.id+' referenced material exists');
    }
  }
  assert.equal(guideSet.lessons.reduce((n,g)=>n+g.replacements.length,0),143);
  const visiting=new Set(),done=new Set();
  function visit(id){assert.ok(!visiting.has(id),`cycle at ${id}`);if(done.has(id))return;visiting.add(id);for(const dep of guides.get(id)?.prerequisites||lessons.get(id)?.prerequisites||[])visit(dep);visiting.delete(id);done.add(id);}
  expected.forEach(l=>visit(l.id));
});
