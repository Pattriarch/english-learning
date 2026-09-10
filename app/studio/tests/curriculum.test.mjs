import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const content=new URL('../../content/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,content),'utf8'));
const courses=readdirSync(new URL('courses/',content)).filter(n=>n.endsWith('.json')).flatMap(n=>read('courses/'+n));
const lessons=[...read('curriculum.json'),...courses],byID=new Map(lessons.map(l=>[l.id,l]));
test('A1–C2 pathway, all tense comparisons and cinema lessons resolve to prepared content',()=>{
 assert.equal(byID.size,lessons.length,'duplicate lesson IDs');
 const path=read('learning-path.json');
 assert.deepEqual(path.levels.map(l=>l.id),['A1','A2','B1','B2','C1','C2']);
 for(const level of path.levels){assert.ok(level.lessonIds.length>=15);for(const id of level.lessonIds){assert.ok(byID.has(id),id);assert.equal(byID.get(id).level,level.id);}}
 assert.equal(path.tenses.length,12);
 for(const tense of path.tenses)for(const id of [...tense.lessonIds,...(tense.compareLessonIds||[])])assert.ok(byID.has(id),id);
 const cinema=read('cinema.json');assert.equal(cinema.series[0].episodes.length,10);
 for(const episode of cinema.series[0].episodes){assert.equal(episode.lessonIds.length,3);for(const id of episode.lessonIds)assert.ok(byID.has(id),id);}
 for(const l of lessons){assert.ok(l.sections.length>=3,l.id);assert.ok(l.examples.length>=2,l.id);assert.ok(l.exercises.length>=5,l.id);assert.equal(new Set(l.exercises.map(e=>e.id)).size,l.exercises.length);for(const e of l.exercises){assert.ok(['translate','translation','rewrite','write','speak'].includes(e.kind),l.id+': '+e.kind);assert.ok(e.prompt&&e.context&&e.explanation);}}
});
test('Every numbered unit from all supplied books is present exactly once per edition',()=>{
 const catalog=read('library.json'),units=catalog.books.flatMap(b=>b.units);
 assert.equal(catalog.books.length,11);assert.equal(units.length,1017);assert.equal(new Set(units.map(u=>u.id)).size,1017);
 assert.equal(catalog.books.filter(b=>!b.duplicateOf).reduce((n,b)=>n+b.units.length,0),872);
 for(const b of catalog.books){assert.equal(b.unitCount,b.units.length);assert.deepEqual(b.units.map(u=>u.unit),Array.from({length:b.unitCount},(_,i)=>i+1));for(const u of b.units){assert.ok(u.title.trim()&&u.verified);assert.ok(u.page>0&&u.endPage>=u.page&&u.endPage<=b.pdfPageCount,u.id);}}
});
test('External skill tasks and subtitle sources have complete, resolvable provenance',()=>{
 const research=read('research-topics.json'),sources=new Map(research.sources.map(s=>[s.id,s])),ids=new Set();
 assert.equal(research.topics.length,48);assert.equal(sources.size,research.sources.length);
 for(const level of ['A1','A2','B1','B2','C1','C2'])assert.equal(research.topics.filter(t=>t.level===level).length,8);
 for(const t of research.topics){assert.ok(!ids.has(t.id),t.id);ids.add(t.id);assert.ok(t.title&&t.why&&t.practicePrompt);assert.equal(t.successCriteria.length,3);assert.ok(t.sourceIds.length>0);for(const source of t.sourceIds)assert.ok(sources.has(source),source);for(const lesson of t.lessonIds)assert.ok(byID.has(lesson),lesson);}
 for(const s of research.sources)assert.ok(['https:','http:'].includes(new URL(s.url).protocol));
 const subtitles=read('subtitle-sources.json'),episodes=read('cinema.json').series[0].episodes,sourceIDs=new Set(subtitles.sources.map(s=>s.id));
 assert.equal(subtitles.episodes.length,10);assert.equal(new Set(subtitles.episodes.map(e=>e.episodeId)).size,10);
 for(const e of subtitles.episodes){assert.ok(episodes.some(x=>x.id===e.episodeId&&x.number===e.episode),e.episodeId);assert.ok(e.links.some(l=>l.verified&&l.sourceId==='tvsubtitles'));for(const link of e.links){assert.ok(sourceIDs.has(link.sourceId));assert.equal(typeof link.verified,'boolean');assert.equal(new URL(link.url).protocol,'https:');}}
});
