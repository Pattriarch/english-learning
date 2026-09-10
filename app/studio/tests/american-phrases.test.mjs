import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {highlightLexicon, lexicalLinkedSense, lexicalImage, lexicalImageURL} from '../lexicon-model.js';

const phrases = JSON.parse(readFileSync(new URL('../../content/lexicon/american-phrases.json', import.meta.url), 'utf8'));
const sceneData = JSON.parse(readFileSync(new URL('../../content/lexicon/scenes.json', import.meta.url), 'utf8'));
const requiredWords = [
 'figure out', 'look into', 'run into a problem', 'roll back', 'workaround', 'deadline',
 'on the same page', 'follow up', 'keep someone posted', 'push back', 'trade-off', 'deliverable',
 'catch up', 'hang out', 'my bad', 'no worries', 'take a rain check', "I'm down",
 'thread', 'OP', 'IMO', 'FWIW', 'TL;DR', 'lurker',
 'sketchy', 'red flag', 'no-brainer', 'heads-up', 'give someone the benefit of the doubt', 'call someone out',
 'runway', 'burn rate', 'break even', 'cash flow', 'bootstrap', 'cut corners',
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('American collection has exactly the 36 requested stable entries and no invented rank or CEFR', () => {
 assert.equal(phrases.version, 'context-lexicon-v1');
 assert.equal(phrases.targetVariety, 'en-US');
 assert.equal(phrases.spanEncoding, 'utf-16');
 assert.deepEqual(phrases.entries.map(e => e.word), requiredWords);
 assert.equal(new Set(phrases.entries.map(e => e.id)).size, 36);
 for (const entry of phrases.entries) {
  assert.match(entry.id, /^us-[a-z0-9-]+$/);
  assert.equal(entry.kind, 'phrase');
  assert.equal(entry.rank, null);
  assert.equal(entry.cefr, null);
  assert.deepEqual(entry.memberships, [{sourceId:'english-american-phrases'}]);
 }
});

test('each original context is two full sentences with a complete Russian translation and its own task', () => {
 const contextIDs = new Set(), enTexts = new Set(), tasks = new Set();
 for (const entry of phrases.entries) {
  assert.equal(entry.contexts.length, 1, entry.id);
  const c = entry.contexts[0];
  assert.equal((c.en.match(/[.!?](?:\s|$)/g)||[]).length, 2, entry.id + ' English sentences');
  assert.equal((c.ru.match(/[.!?](?:\s|$)/g)||[]).length, 2, entry.id + ' Russian sentences');
  assert.ok(c.en.split(/\s+/).length >= 23, entry.id);
  assert.match(c.ru, /[А-Яа-яЁё]/);
  assert.ok(c.ru.length > 100, entry.id + ' full translation');
  assert.ok(c.productionTask.length > 90, entry.id + ' new production task');
  assert.equal(c.variety, 'en-US-compatible');
  contextIDs.add(c.id); enTexts.add(c.en); tasks.add(c.productionTask);
 }
 assert.equal(contextIDs.size, 36); assert.equal(enTexts.size, 36); assert.equal(tasks.size, 36);
});

test('all 36 linked senses, explanations and register notes are available through the actual UI contract', () => {
 for (const entry of phrases.entries) {
  const c = entry.contexts[0], sense = lexicalLinkedSense(entry,c);
  assert.equal(entry.senses.length, 1, entry.id);
  assert.equal(sense?.id, entry.id + '-sense-1');
  assert.ok(sense.definition.length > 30 && sense.definitionRu.length > 25, entry.id);
  assert.equal(sense.source.kind, 'original-editorial');
  assert.ok(c.explanation.length > 300, entry.id + ' meaning, grammar and contrast explanation');
  assert.equal(typeof c.register, 'string');
  assert.ok(c.register.length > 30, entry.id + ' register');
  for (const collocation of c.collocations) {
   assert.equal(collocation.contextId, c.id);
   assert.ok(c.en.includes(collocation.text), entry.id + ': ' + collocation.text);
  }
 }
});

test('every highlighted surface form survives native JavaScript UTF-16 slicing and rendering', () => {
 for (const entry of phrases.entries) {
  const c = entry.contexts[0];
  assert.equal(c.targetSpans.length, 1);
  const span = c.targetSpans[0];
  assert.ok(Number.isInteger(span.start) && Number.isInteger(span.end));
  assert.equal(c.en.slice(span.start,span.end), span.text, entry.id);
  const html = highlightLexicon(c.en,c.targetSpans);
  assert.equal((html.match(/<mark>/g)||[]).length, 1, entry.id);
  assert.ok(html.includes('</mark>'), entry.id);
 }
 const find = id => phrases.entries.find(e=>e.id===id).contexts[0].targetSpans[0].text;
 assert.equal(find('us-run-into-a-problem'), 'ran into a problem');
 assert.equal(find('us-keep-someone-posted'), 'keep you posted');
 assert.equal(find('us-call-someone-out'), 'called the seller out');
});

test('six verified PNG scenes map to six contexts each, with explicit association and exact asset SHA', () => {
 assert.equal(sceneData.scenes.length, 6);
 assert.equal(new Set(sceneData.scenes.map(s=>s.id)).size, 6);
 for (const scene of sceneData.scenes) {
  assert.equal(scene.entryIds.length, 6, scene.id);
  assert.equal(new Set(scene.entryIds).size, 6);
  assert.equal(scene.association, 'shared-scene-not-literal-depiction-of-every-context');
  const raw = readFileSync(new URL('..' + scene.src, import.meta.url));
  assert.equal(raw.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(raw.readUInt32BE(16), scene.width);
  assert.equal(raw.readUInt32BE(20), scene.height);
  assert.equal(sha(raw), scene.sha256);
  assert.equal(scene.generation.kind, 'original-ai-generated-image');
  assert.match(scene.generation.sourceBasename, /^exec-[a-f0-9-]+\.png$/);
  assert.equal(scene.generation.sourceSHA256, scene.sha256);
  for (const id of scene.entryIds) {
   const entry = phrases.entries.find(e=>e.id===id);
   assert.ok(entry, id);
   const c = entry.contexts[0], image = lexicalImage(entry,c);
   assert.equal(image.contextId, c.id);
   assert.equal(image.sceneId, scene.id);
   assert.equal(image.alt, scene.alt);
   assert.equal(image.sha256, scene.sha256);
   assert.equal(lexicalImageURL(image), scene.src);
   assert.equal(lexicalImage(entry,{id:'unrelated-context'}), null);
  }
 }
 assert.equal(new Set(sceneData.scenes.flatMap(s=>s.entryIds)).size,36);
});

test('authorship is distinct from dictionary verification and no missing reference is disguised as a source', () => {
 for (const entry of phrases.entries) {
  const c = entry.contexts[0];
  for (const source of [c.source,c.translationSource,entry.senses[0].source]) {
   assert.equal(source.kind,'original-editorial');
   assert.equal(source.license,'original-project-content');
   assert.equal(source.attribution,'English project contributors');
   assert.equal(source.url,undefined);
  }
  for (const source of c.verificationSources) {
   assert.match(source.url,/^https:\/\/(www\.)?(merriam-webster\.com|collinsdictionary\.com|oxfordlearnersdictionaries\.com|dictionary\.cambridge\.org|support\.reddithelp\.com|ycombinator\.com)\//);
   assert.equal(source.purpose,'meaning-verification-only');
   assert.match(source.note,/no context, translation or definition is copied/);
  }
 }
 assert.deepEqual(phrases.entries.find(e=>e.id==='us-im-down').contexts[0].verificationSources,[]);
 assert.match(phrases.entries.find(e=>e.id==='us-no-worries').contexts[0].explanation,/не принадлежит исключительно американской/);
});
