import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newNotebookEntry,parseNotebookEntry,parseNotebookResult,notebookSource,notebookFingerprint,notebookResultCurrent,notebookAudioURL,notebookEntries,notebookRecordings,notebookJSON} from '../notebook-model.js';

test('saved thoughts restore Russian, personal output and exact recording context',()=>{
 const entry={...newNotebookEntry('note-1',new Date('2026-09-10T12:00:00Z')),russian:'Я пока не разобрался.',ownEnglish:"I haven't figured it out yet.",context:'Чат с коллегой',register:'work',recordings:[{file:'a'.repeat(64)+'.webm',at:'2026-09-10T12:01:00Z',text:'I was still working on it.',kind:'own'}]};
 assert.deepEqual(parseNotebookEntry(notebookJSON(entry)),entry);
 assert.match(notebookAudioURL(entry.recordings[0].file),/^\/media\//);
 assert.equal(notebookAudioURL('../outside.wav'),'');
 assert.equal(notebookAudioURL('https://example.org/a.wav'),'');
});
test('changing source or register makes an old translation visibly stale; own practice does not',()=>{
 const entry={...newNotebookEntry('n'),russian:'Спасибо за помощь.',register:'work'};
 const result=parseNotebookResult({version:1,source:notebookSource(entry),english:'Thanks for your help.',explanation:'Естественная благодарность.',phrases:[]});
 assert.equal(notebookResultCurrent(entry,result),true);
 assert.equal(notebookResultCurrent({...entry,ownEnglish:'Thank you.'},result),true);
 assert.equal(notebookResultCurrent({...entry,register:'internet'},result),false);
 assert.equal(notebookResultCurrent({...entry,russian:'Спасибо за совет.'},result),false);
});
test('unrelated drafts, mismatched IDs and corrupt recordings do not become notebook entries',()=>{
 const entry={...newNotebookEntry('one'),russian:'Мысль',recordings:[{file:'../../x.webm',at:new Date().toISOString()}]};
 const list=notebookEntries({'planner:day':{text:'{}'},'notebook:entry:one':{text:JSON.stringify(entry)},'notebook:entry:two':{text:JSON.stringify(entry)},'notebook:entry:broken':{text:'{'}});
 assert.equal(list.length,1);assert.deepEqual(list[0].recordings,[]);
});
test('draft byte limit never silently truncates a Russian thought',()=>{
 assert.throws(()=>notebookJSON({russian:'я'.repeat(10000)}),/длинной/);
 assert.equal(JSON.parse(notebookJSON({russian:'Мысль'})).russian,'Мысль');
});
test('many recordings use separate drafts and never erase earlier recordings',()=>{
 const entry=newNotebookEntry('voice-only'),drafts={'notebook:entry:voice-only':{text:notebookJSON(entry)}};
 for(let i=0;i<35;i++)drafts['notebook:recording:'+i]={text:notebookJSON({entryId:entry.id,file:i.toString(16).padStart(64,'0')+'.webm',at:new Date(2026,0,1,i).toISOString(),kind:'own',text:'Saved full recording context '.repeat(100)})};
 assert.equal(notebookRecordings(drafts,entry).length,35);
 assert.equal(notebookEntries(drafts)[0].recordings.length,35);
 assert.equal(notebookRecordings(drafts,newNotebookEntry('another')).length,0);
});

test('source fingerprints match native SHA-256 across UTF-8 and block boundaries',()=>{
 for(const source of ['', 'abc', 'Спасибо 😀 за помощь.','x'.repeat(55),'x'.repeat(56),'x'.repeat(63),'x'.repeat(64),'я'.repeat(2800),'\u2028\u0000\ud800']){
  const entry={...newNotebookEntry('n'),russian:source,context:'Ситуация 😃',register:'work'};
  assert.equal(notebookFingerprint(entry),'sha256:'+createHash('sha256').update(notebookSource(entry),'utf8').digest('hex'));
 }
 const entry={...newNotebookEntry('n'),russian:'Мысль',register:'work'},result={source:notebookFingerprint(entry)};
 assert.equal(notebookResultCurrent(entry,result),true);
 assert.equal(notebookResultCurrent({...entry,context:'Новая ситуация'},result),false);
 assert.equal(notebookResultCurrent(entry,{source:notebookSource(entry)}),true,'Existing saved translations remain compatible');
});

test('a large complete translation and source fingerprint fit one draft without truncation',()=>{
 const entry={...newNotebookEntry('long'),russian:'я'.repeat(2800),context:'ю'.repeat(800),register:'work'};
 const result={version:1,at:'2026-09-10T12:00:00Z',english:'Thanks '+'a'.repeat(7993),explanation:'я'.repeat(2200),phrases:[{english:'Thanks',russian:'Благодарность'}],alternative:'',practice:'Используй фразу в другой ситуации.'};
 assert.throws(()=>notebookJSON({...result,source:notebookSource(entry)}),/длинной/);
 const saved=notebookJSON({...result,source:notebookFingerprint(entry)});
 assert.ok(new TextEncoder().encode(saved).length<19500);
 assert.equal(JSON.parse(saved).english,result.english);
 assert.equal(JSON.parse(saved).explanation,result.explanation);
 assert.equal(notebookResultCurrent(entry,parseNotebookResult(saved)),true);
});
