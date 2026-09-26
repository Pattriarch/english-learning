import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
const content=new URL('../../content/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,content),'utf8'));
const list=value=>Array.isArray(value)?value:value.lessons;

test('every applied A1/A2 lesson teaches in one layer, with short supported steps before its own tasks',()=>{
  const applied=['extended-skills.json','research-expansion.json','natural-listening.json'].flatMap(file=>list(read('courses/'+file))).filter(l=>['A1','A2'].includes(l.level));
  const all=list(read('curriculum.json')).concat(readdirSync(new URL('courses/',content)).filter(file=>file.endsWith('.json')).flatMap(file=>list(read('courses/'+file))));
  const lessons=new Map(all.map(l=>[l.id,l]));
  const overlays=readdirSync(content).filter(n=>/^course-guides-.*\.json$/.test(n)).flatMap(n=>read(n).lessons.map(g=>g.lessonId));
  assert.equal(applied.length,20);
  for(const lesson of applied){
    assert.equal(lesson.guided,true,lesson.id);
    assert.ok(!overlays.includes(lesson.id),lesson.id+' keeps a second explanation layer');
    assert.ok(lesson.prerequisites.length>0,lesson.id);
    for(const id of lesson.prerequisites){assert.ok(lessons.has(id),`${lesson.id}: missing ${id}`);assert.notEqual(id,lesson.id);}
    const guided=lesson.exercises.filter(e=>e.practiceStage==='guided');
    assert.ok(guided.length>=3,lesson.id+' needs supported steps');
    for(const task of guided){
      assert.ok(task.guidance.body&&task.guidance.example&&task.guidance.translation,lesson.id);
      assert.ok(task.answers.every(a=>!/[А-Яа-яЁё]/.test(a)),lesson.id);
      // Correcting a short text may be longer; a supported answer otherwise stays short.
      assert.ok(task.answers.every(a=>a.split(/\s+/).length<=(task.kind==='rewrite'?40:24)),`${lesson.id}/${task.id}: short supported answer`);
    }
    for(const task of lesson.exercises){
      assert.doesNotMatch(task.prompt,/\d+\s*[–-]\s*\d+\s*(?:английских\s+)?слов/,'No minimum output length replaces a communicative task');
      for(const material of task.materialIds||[])assert.ok(lesson.materials.some(m=>m.id===material),lesson.id+' referenced material exists');
    }
    for(const m of lesson.materials||[])if(m.audioFile)assert.ok(existsSync(new URL(m.audioFile.replace(/^\//,''),new URL('../',import.meta.url))),lesson.id+' recording is bundled');
  }
  const visiting=new Set(),done=new Set();
  function visit(id){assert.ok(!visiting.has(id),`cycle at ${id}`);if(done.has(id))return;visiting.add(id);for(const dep of lessons.get(id)?.prerequisites||[])visit(dep);visiting.delete(id);done.add(id);}
  applied.forEach(l=>visit(l.id));
});
