import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI} from './study-ui-fixture.mjs';

const data=()=>({state:{drafts:{},attempts:[]},settings:{provider:'offline'}});
const alias={word:'wrote',entryIds:['write'],relation:'Прошедшее время write',sourceRow:27};
const entry={id:'write',word:'write',kind:'word',senses:[{id:'writing',definition:'To produce text.'}],contexts:[{id:'write-context',en:'I write daily.',ru:'Я пишу каждый день.',targetSpans:[{start:2,end:7,text:'write'}],senseId:'writing',quality:'ai-context-reviewed'}]};

test('search explains the matched source form and distinguishes import totals from original coverage',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data();
 f.api=async()=>({total:1,offset:0,items:[{...entry,preview:entry.contexts[0],contextCount:1,preparedContexts:1,matchedForms:[alias]}],metadata:{words:3,phrases:0,preparedEntries:2,coverage:{publishedWords:2,aiReviewedContexts:5},sources:{sources:[]},cocaExtension:{newEntries:1,aliasCount:1,importSummary:{sourceRows:5,linkedForms:1,referenceOnly:1,unresolved:0},sources:[{title:'Uploaded <COCA> file',author:'User-provided',license:'Unverified'}]}}});
 await f.module.mountLexicon(f.root,d,async()=>d);
 const results=f.root.querySelector('#lexicon-results').innerHTML;
 assert.match(results,/wrote → write/);
 assert.match(results,/Прошедшее время write/);
 assert.match(results,/строка 27/);
 const sources=f.root.querySelector('#lexicon-sources').innerHTML;
 assert.match(sources,/добавлено 1 статей/);
 assert.match(sources,/1 справочных записей/);
 assert.match(sources,/официальный ранг корпуса и уровни CEFR этим импортом не подтверждаются/);
 assert.match(sources,/Uploaded &lt;COCA&gt; file/);
 assert.doesNotMatch(sources,/<COCA>/);
 assert.match(f.root.querySelector('#lexicon-stats').innerHTML,/<strong>3<\/strong>/);
 assert.match(f.root.querySelector('#lexicon-quality').textContent,/6 контекстов дополнительно разобраны с ИИ/);
 assert.match(f.root.innerHTML,/user-coca-wslx-2026-09/);
 const filter=f.root.querySelector('#lexicon-list');filter.value='user-coca-wslx-2026-09';filter.onchange({target:filter});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(new URLSearchParams(f.requests.at(-1).path.split('?')[1]).get('list'),'user-coca-wslx-2026-09');
});

test('new entries label their uploaded source position rather than an official frequency rank',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data();
 f.api=async()=>({entry:{...entry,rank:{sourceId:'user-coca-wslx-2026-09',sourceRow:812,value:812,metric:'position in user-supplied list'}},aliases:[],metadata:{}});
 await f.module.mountLexicon(f.root,d,async()=>d,entry.id);
 assert.match(f.root.innerHTML,/Позиция в твоём файле: 812/);
 assert.match(f.root.innerHTML,/номер строки загруженного списка, а не подтверждённый частотный ранг COCA/);
});

test('detail keeps form provenance separate from the saved base entry and its answer keys',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data(),original=structuredClone(entry);
 f.api=async()=>({entry,aliases:[{...alias,relation:'Form <note>'}],metadata:{}});
 await f.module.mountLexicon(f.root,d,async()=>d,entry.id);
 assert.match(f.root.innerHTML,/Формы этого слова в твоём списке/);
 assert.match(f.root.innerHTML,/wrote → write/);
 assert.match(f.root.innerHTML,/Form &lt;note&gt;/);
 const answer=f.root.querySelector('#lexicon-answer');answer.value='I write reports every week.';answer.oninput();
 assert.equal(f.local.get('lexicon:answer:write:write-context'),answer.value);
 assert.deepEqual(entry,original);
 assert.equal(f.local.has('lexicon:answer:wrote:write-context'),false);
});
