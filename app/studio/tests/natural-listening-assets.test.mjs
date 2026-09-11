import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {exerciseMaterials,materialHTML,originalMaterialAudioURL} from '../lesson-materials.js';

const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const lessons=read('../../content/courses/natural-listening.json');
const registry=read('../assets/authentic-listening/sources.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const expected={
 'natural-b2-leadership':{file:'nasa-leadership-management.mp3',start:847.8,end:1060.6,exercises:'a8b41666e370f2893550e893c1d20622d31305faee5b6f935b4ab7923e8828ea'},
 'natural-c1-teams':{file:'nasa-science-of-teams.mp3',start:976.9,end:1148.3,exercises:'86a4050dde00f7a7d7a6d8380e2ff61015cf0c0cf7e7b460a50b9d71f45d5a2e'}
};

for(const[id,spec]of Object.entries(expected)){
 test(`${id}: prepared excerpt preserves the existing tasks and keeps the transcript out of first attempts`,()=>{
  const lesson=lessons.find(row=>row.id===id),[audio,transcript]=lesson.materials;
  assert.equal(sha(canonical(lesson.exercises)),spec.exercises,'Access improvements must not silently replace existing questions or their answers');
  assert.equal(originalMaterialAudioURL(audio),'/assets/authentic-listening/'+spec.file);
  assert.match(materialHTML(audio,0,{drafts:{}},id),/data-natural-audio/);
  assert.doesNotMatch(materialHTML(audio,0,{drafts:{}},id),/data-material-play/);
  for(const exercise of lesson.exercises.slice(0,3))assert.ok(!exerciseMaterials(lesson,exercise).includes(transcript),'Initial listening questions cannot expose the source transcript');
  assert.ok(exerciseMaterials(lesson,lesson.exercises[3]).includes(transcript));
  assert.equal(transcript.kind,'reference');
  assert.match(materialHTML(transcript,1,{drafts:{}},id),/data-material-text="1" hidden/);
  assert.equal(lesson.provenance.sourceAccessRevision,2);
  assert.equal(lesson.provenance.sourceAccessChange.unchangedExercisesSHA256,spec.exercises);
 });

 test(`${id}: audio bytes, exact cut and official transcript bind to the same source record`,()=>{
  const lesson=lessons.find(row=>row.id===id),records=registry.recordings.filter(row=>row.file===spec.file);
  assert.equal(records.length,1);
  const record=records[0],raw=readFileSync(new URL('../assets/authentic-listening/'+spec.file,import.meta.url));
  assert.equal(record.lessonId,id);assert.equal(raw.length,record.bytes);assert.equal(sha(raw),record.sha256);
  assert.equal(lesson.provenance.localAudioSha256,record.sha256);
  assert.equal(record.clipStartSeconds,spec.start);assert.equal(record.clipEndSeconds,spec.end);
  assert.equal(record.boundaries.cutFrameEnd-record.boundaries.cutFrameStart,record.frames);
  assert.equal(record.frames/record.sampleRate,record.durationSeconds);
  const officialExcerpt=lesson.materials[1].text.split('\n\n').slice(1).join('\n\n');
  assert.ok(officialExcerpt.startsWith('Host: '+record.boundaries.startAnchor));
  assert.ok(officialExcerpt.includes(record.boundaries.endAnchor));
  assert.equal(sha(officialExcerpt),record.sourceTranscriptSHA256);
  assert.equal(lesson.provenance.localTranscriptSHA256,record.sourceTranscriptSHA256);
  assert.deepEqual(record.alignment.checkedTaskIds,lesson.exercises.map(e=>e.id));
  assert.equal(new URL(record.audioSourceUrl).hostname,'www.nasa.gov');
  assert.equal(record.sourceUrl,lesson.materials[0].sourceUrl);
  assert.match(record.rights,/without endorsement/);
  assert.ok(record.alignment.limitations.some(text=>text.includes('not human listening')));
  for(const hash of Object.values(record.alignment.privateEvidenceSHA256))assert.match(hash,/^[a-f0-9]{64}$/);
 });
}
