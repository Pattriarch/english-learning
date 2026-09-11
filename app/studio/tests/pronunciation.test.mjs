import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {savedChecklist,pronunciationComplete,pronunciationAccent,pronunciationModelLabel} from '../pronunciation.js';

import {studyUI,deferred} from './study-ui-fixture.mjs';

test('Pronunciation lessons contain usable audio words, reading tasks and self-check criteria',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../../content/pronunciation.json',import.meta.url),'utf8'));
  assert.ok(catalog.lessons.length>=12);
  assert.equal(new Set(catalog.lessons.map(l=>l.id)).size,catalog.lessons.length);
  for(const l of catalog.lessons){
    assert.match(l.id,/^[a-zA-Z0-9_-]{1,100}$/);
    assert.ok(['A1','A2','B1','B2','C1','C2'].includes(l.level),l.id);
    assert.ok(l.title&&l.goal&&l.minutes>0,l.id);
    assert.ok(l.explanation.length>=3&&l.explanation.every(s=>s.title&&s.body),l.id);
    assert.ok(l.examples.length>=2&&l.examples.every(e=>e.text&&e.note),l.id);
    for(const s of l.sounds){assert.ok(s.ipa&&s.label&&s.articulation);assert.ok(s.examples.length&&s.examples.every(e=>e.word&&e.ipa));}
    assert.ok(Array.isArray(l.contrastPairs));
    for(const pair of l.contrastPairs)for(const value of [pair.leftAudio,pair.rightAudio])if(value!==undefined){assert.equal(typeof value,'string');assert.doesNotMatch(value,/[А-Яа-яЁё/]/,'TTS must not read IPA or Russian instructions');}
    assert.ok(l.practice.prompt&&l.practice.reference&&l.practice.criteria.length>=3,l.id);
    assert.ok(l.practice.criteria.every(c=>typeof c==='string'&&c.trim()),l.id);
  }
  assert.ok(catalog.sources.length>=2);
  for(const source of catalog.sources)assert.equal(new URL(source.url).protocol,'https:');
});
test('Self-check progress restores only valid criterion indices and is distinct from assessed mastery',()=>{
  const state={drafts:{'pronunciation:ipa:checklist':{text:'[0,2,2,8,-1,"1"]',at:'2026-09-09'}},read:{'pronunciation:ipa':'2026-09-09'}};
  assert.deepEqual([...savedChecklist(state,'ipa',3)],[0,2]);
  assert.equal(pronunciationComplete(state,'ipa'),true);
  assert.equal(pronunciationComplete(state,'vowels'),false);
  state.drafts['pronunciation:ipa:checklist'].text='{invalid';
  assert.deepEqual([...savedChecklist(state,'ipa',3)],[]);
});
test('The US catalog and a still-running legacy UK catalog have truthful model labels',()=>{
  const current=JSON.parse(readFileSync(new URL('../../content/pronunciation.json',import.meta.url),'utf8'));
  assert.equal(pronunciationAccent(current),'en-US');
  assert.match(pronunciationModelLabel(current),/американская/);
  const old={description:'Транскрипция использует широкую британскую словарную модель; другие акценты также правильны.'};
  assert.equal(pronunciationAccent(old),'en-GB');
  assert.match(pronunciationModelLabel(old),/британская/);
});

function practiceData(){
 const lesson={id:'reading',title:'Read aloud',goal:'Notice the sound',minutes:10,level:'A1',explanation:[{title:'Meaning',body:'Notice the difference.'}],sounds:[],contrastPairs:[],examples:[{text:'I am working.',note:'Read the sentence.'}],practice:{prompt:'Explain what changed.',reference:'I noticed the stress.',criteria:['Listened','Read','Compared']}};
 return{pronunciation:{description:'Read and listen',lessons:[lesson],sources:[]},state:{drafts:{},read:{},attempts:[]}};
}

test('US voice is selected on new lessons and practice/checklist IDs stay unchanged',async t=>{
 const f=await studyUI(t,'pronunciation.js'),data=practiceData();
 data.state.drafts['pronunciation:reading']={text:'My saved reflection.'};
 data.state.drafts['pronunciation:reading:checklist']={text:'[0,2]'};
 f.module.mountPronunciation(f.root,data,'reading',async()=>data);
 assert.match(f.root.innerHTML,/<option value="en-US" selected>/);
 assert.equal(f.root.querySelector('#sound-answer').value,'My saved reflection.');
 assert.deepEqual(f.root.querySelectorAll('[data-criterion]').map(n=>n.checked),[true,false,true]);
});

test('pronunciation answer dictation saves in the answer field and submits that text',async t=>{
 const f=await studyUI(t,'pronunciation.js'),data=practiceData();
 f.module.mountPronunciation(f.root,data,'reading',async()=>data);
 const target=f.root.querySelector('#sound-answer');
 f.voice=async(_button,field,_settings,onText,options)=>{
  assert.equal(field,target);assert.equal(options.check,f.root.querySelector('#sound-check'));
  assert.equal(options.preview,f.root.querySelector('#sound-dictation-preview'));
  field.value='I noticed the stress on the second word.';onText();
 };
 await f.root.querySelector('#sound-dictate').click();
 assert.equal(f.local.get('pronunciation:reading'),target.value);
 f.api=async(path,body)=>{assert.equal(path,'/check');assert.equal(body.answer,target.value);return{...body,feedback:{verdict:'correct'}};};
 await f.root.querySelector('#sound-check').click();
 assert.ok(f.requests.some(r=>r.path==='/check'&&r.body.answer===target.value));
});

test('A saved pronunciation reflection keeps its assessment when the draft ends with a newline',async t=>{
 const f=await studyUI(t,'pronunciation.js'),data=practiceData();
 data.state.drafts['pronunciation:reading']={text:'I noticed the stress.\n'};
 data.state.attempts.push({lessonId:'pronunciation',exerciseId:'reading',answer:'I noticed the stress.',feedback:{verdict:'correct',summary:'Saved reflection feedback',explanation:'Good.'}});
 f.module.mountPronunciation(f.root,data,'reading',async()=>data);
 assert.equal(f.root.querySelector('#sound-answer').value,'I noticed the stress.\n');assert.match(f.root.innerHTML,/Saved reflection feedback/);
});

test('US and British pronunciation use Kokoro with honest accent selection and invalidate old requests',async t=>{
 const f=await studyUI(t,'pronunciation.js'),data=practiceData();f.fetch=async()=>assert.fail('Old pronunciation samples must not be used');
 f.module.mountPronunciation(f.root,data,'reading',async()=>data);await f.root.querySelector('[data-listen]').click();
 const old=f.spoken[0];assert.deepEqual(old.slice(0,3),['I am working.',.9,'en-US']);assert.equal(old[3].isCurrent(),true);
 const accent=f.root.querySelector('#sound-accent');accent.value='en-GB';accent.onchange();assert.equal(old[3].isCurrent(),false);assert.match(f.root.querySelector('#sound-voice-info').textContent,/Emma.*британский/);
 await f.root.querySelector('[data-listen]').click();assert.equal(f.spoken[1][2],'en-GB');
 f.root.querySelector('#sound-stop').click();assert.equal(f.spoken[1][3].isCurrent(),false);
});

test('Practice completion keeps its snapshot stable through durable writes and unlocks on failure',async t=>{
 const f=await studyUI(t,'pronunciation.js'),data=practiceData(),saving=deferred(),received=deferred();let first=true;
 data.state.drafts['pronunciation:reading']={text:'My reflection.'};data.state.drafts['pronunciation:reading:checklist']={text:'[0,1,2]'};
 f.api=async(path)=>{if(path==='/draft'&&first){first=false;received.resolve();return saving.promise;}if(path==='/read')throw Error('Saving failed');return{};};
 f.module.mountPronunciation(f.root,data,'reading',async()=>data);
 const target=f.root.querySelector('#sound-answer'),criteria=f.root.querySelectorAll('[data-criterion]'),pending=f.root.querySelector('#sound-complete').click();
 await received.promise;assert.equal(target.readOnly,true);assert.ok(criteria.every(input=>input.disabled));
 saving.resolve({});await pending;
 assert.equal(target.readOnly,false);assert.ok(criteria.every(input=>!input.disabled));assert.equal(target.value,'My reflection.');assert.match(f.alerts.at(-1),/Saving failed/);
 assert.equal(data.state.read['pronunciation:reading'],undefined);
});
