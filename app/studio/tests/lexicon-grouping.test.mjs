import test from 'node:test';
import assert from 'node:assert/strict';
import {lexicalCollectionMembers,lexicalGroupProgress} from '../lexicon-grouping.js';
import {lexiconAnswerKey,lexiconStateKey} from '../lexicon-model.js';
import {studyUI} from './study-ui-fixture.mjs';

const data=()=>({state:{attempts:[],drafts:{}},settings:{}});
const member=(id,kind,ru)=>({id,word:'thread',kind,contextCount:1,preparedContexts:0,preview:{id:id+'-context',en:'A thread here.',ru,targetSpans:[{start:2,end:8,text:'thread'}]}});
const word=()=>member('lex-thread','word','Нить для шитья.'),phrase=()=>member('us-thread','phrase','Ветка обсуждения.');
const entry=member=>({...member,senses:[{id:member.id+'-sense',definition:member.kind==='word'?'A fiber for sewing.':'An online discussion.'}],contexts:[member.preview]});

test('group progress reads every original member without creating or inheriting shared knowledge',()=>{
 const members=lexicalCollectionMembers([word(),phrase(),word(),{id:'../bad'}]),drafts={[lexiconStateKey(word().id)]:JSON.stringify({version:1,status:'known'})},before=JSON.stringify(drafts);
 const progress=lexicalGroupProgress(members,key=>drafts[key]);
 assert.equal(members.length,2);assert.equal(progress.total,2);assert.equal(progress.known,1);assert.equal(progress.states[1].status,'new');assert.equal(JSON.stringify(drafts),before);
 assert.deepEqual(lexicalCollectionMembers(undefined,word()),[word()]);
});

test('one search tile displays both collections and separates headline and collection counts',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data(),members=[word(),phrase()];d.state.drafts[lexiconStateKey(word().id)]={text:JSON.stringify({version:1,status:'known'})};
 f.api=async()=>({items:[{...members[0],members,memberCount:2,allMemberCount:2,groupContextCount:2}],total:1,matchedEntries:2,offset:0,metadata:{words:1,phrases:1,uniqueHeadwords:1,sourceCollections:2}});
 await f.module.mountLexicon(f.root,d,async()=>d);
 const html=f.root.querySelector('#lexicon-results').innerHTML;
 assert.equal((html.match(/class="lexicon-word"/g)||[]).length,1);
 assert.match(html,/href="#\/lexicon\/lex-thread"/);assert.match(html,/href="#\/lexicon\/us-thread"/);
 assert.match(html,/1 из 2 подборок узнаёшь/);assert.match(html,/Нить для шитья/);assert.match(html,/Ветка обсуждения/);
 assert.match(f.root.querySelector('#lexicon-count').textContent,/1 слово или выражение · 2 подборки/);
 assert.match(f.root.querySelector('#lexicon-stats').innerHTML,/<strong>1<\/strong><span>разных слов/);assert.match(f.root.querySelector('#lexicon-stats').innerHTML,/<strong>2<\/strong><span>подборок контекстов/);
 assert.equal(f.local.size,0);
});

test('original entry links keep separate contexts, drafts and self-assessments; recall hides sibling hints',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data(),members=[word(),phrase()];
 let active=entry(word());f.api=async()=>({entry:active,siblings:members,metadata:{}});
 location.hash='#/lexicon/'+active.id;await f.module.mountLexicon(f.root,d,async()=>d,active.id);
 assert.match(f.root.innerHTML,/href="#\/lexicon\/us-thread"/);
 const target=f.root.querySelector('#lexicon-answer');target.value='My original sewing example.';target.oninput();f.root.querySelector('#lexicon-known').click();
 assert.equal(f.local.get(lexiconAnswerKey(word().id,word().preview.id)),target.value);
 assert.equal(JSON.parse(f.local.get(lexiconStateKey(word().id))).status,'known');assert.equal(f.local.has(lexiconStateKey(phrase().id)),false);
 f.root.querySelector('#lexicon-reveal').click();
 assert.equal(f.root.querySelectorAll('[data-lexicon-sibling-hint]').length,2);
 assert.ok(f.root.querySelectorAll('[data-lexicon-sibling-hint]').every(span=>span.hidden));
 active=entry(phrase());location.hash='#/lexicon/'+active.id;await f.module.mountLexicon(f.root,d,async()=>d,active.id);
 assert.equal(f.root.querySelector('#lexicon-answer').value,'');assert.match(f.root.innerHTML,/Ветка обсуждения\./);
 assert.match(f.root.innerHTML,/id="lexicon-known"[^>]*>Узнаю в контексте/);
 active=entry(word());location.hash='#/lexicon/'+active.id;await f.module.mountLexicon(f.root,d,async()=>d,active.id);
 assert.equal(f.root.querySelector('#lexicon-answer').value,'My original sewing example.');
});
