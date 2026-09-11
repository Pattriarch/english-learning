import test from 'node:test';
import assert from 'node:assert/strict';
import {lexicalPreparedContext,lexicalStudyContexts} from '../lexicon-model.js';
import {studyUI} from './study-ui-fixture.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const data=()=>({state:{drafts:{},attempts:[]},settings:{provider:'offline'}});

const entry=()=>({
 id:'issue',quality:{status:'ai-context-reviewed'},
 senses:[{id:'problem',definition:'  a problem requiring attention  '},{id:'empty',definition:' \n\t '}],
 contexts:[],
});
const context=(id,overrides={})=>({id,en:'There is an issue with the account.',ru:'  С учетной записью возникла проблема.  ',quality:'ai-context-reviewed',senseId:'problem',...overrides});

test('prepared contexts require their own accepted review, translation, and linked nonempty sense',()=>{
 const article=entry();
 const cases=[
  ['AI-reviewed context',{},true],
  ['editorially reviewed context',{quality:'context-reviewed'},true],
  ['explicitly active context',{excludedFromStudy:false},true],
  ['archived context',{excludedFromStudy:true},false],
  ['missing translation',{ru:undefined},false],
  ['whitespace translation',{ru:' \n\t '},false],
  ['missing context review',{quality:undefined},false],
  ['unreviewed source context',{quality:'source-context'},false],
  ['near-match review label',{quality:'ai-reviewed'},false],
  ['review label with extra whitespace',{quality:' context-reviewed '},false],
  ['missing sense link',{senseId:undefined},false],
  ['null sense link',{senseId:null},false],
  ['unknown sense link',{senseId:'different-sense'},false],
  ['linked whitespace-only definition',{senseId:'empty'},false],
 ];
 for(const [label,overrides,expected] of cases){
  assert.equal(lexicalPreparedContext(article,context(label,overrides)),expected,label);
 }
 assert.equal(lexicalPreparedContext({...article,senses:[]},context('no-senses')),false);
 assert.equal(lexicalPreparedContext({...article,senses:[{id:'problem'}]},context('no-definition')),false);
});

test('entry-wide quality cannot prepare a context or disqualify a complete reviewed context',()=>{
 const article=entry();
 assert.equal(lexicalPreparedContext(article,context('entry-only',{quality:undefined})),false);
 assert.equal(lexicalPreparedContext({...article,quality:{status:'source-context'}},context('reviewed')),true);
 assert.equal(lexicalPreparedContext({...article,quality:undefined},context('reviewed')),true);
});

test('study contexts stably prioritize fully prepared examples and retain every other active example',()=>{
 const article=entry();
 article.contexts=[
  context('archived-prepared',{excludedFromStudy:true}),
  context('no-translation',{ru:' '}),
  context('reviewed-without-sense',{senseId:'missing'}),
  context('prepared-first'),
  context('unreviewed',{quality:undefined}),
  context('prepared-second',{quality:'context-reviewed'}),
  context('archived-unreviewed',{excludedFromStudy:true,quality:undefined}),
  context('empty-definition',{senseId:'empty'}),
  context('prepared-third'),
 ];
 const before=structuredClone(article);
 for(const item of article.contexts)Object.freeze(item);
 Object.freeze(article.contexts);
 const result=lexicalStudyContexts(article);
 assert.deepEqual(result.map(item=>item.id),[
  'prepared-first','prepared-second','prepared-third',
  'no-translation','reviewed-without-sense','unreviewed','empty-definition',
 ]);
 assert.equal(result[0],article.contexts[3],'the initial study example is the first actually prepared context');
 assert.notEqual(result,article.contexts,'the result is a separate array');
 assert.deepEqual(article,before,'sorting and filtering do not mutate the article or its contexts');
 assert.equal(result.length,article.contexts.filter(item=>!item.excludedFromStudy).length);
});

test('empty and entirely unprepared banks remain usable without inventing prepared contexts',()=>{
 assert.deepEqual(lexicalStudyContexts(entry()),[]);
 const article=entry();
 article.contexts=[context('first',{quality:undefined}),context('hidden',{excludedFromStudy:true}),context('last',{ru:''})];
 assert.deepEqual(lexicalStudyContexts(article).map(item=>item.id),['first','last']);
 assert.equal(lexicalStudyContexts(article).some(item=>lexicalPreparedContext(article,item)),false);
});

test('prepared filter displays the prepared count, preserves other filters, and restarts pagination',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data();let scheduled;
 t.mock.method(globalThis,'setTimeout',fn=>{scheduled=fn;return 1;});
 t.mock.method(globalThis,'clearTimeout',()=>{});
 f.api=async path=>{
  const params=new URLSearchParams(path.split('?')[1]);
  return{total:99,offset:Number(params.get('offset')),items:[{id:'issue',word:'issue',kind:'word',preview:{en:'There is an issue.',targetSpans:[]},contextCount:3,preparedContexts:1}],metadata:{words:10188,phrases:36,preparedEntries:1234,topics:[{id:'work',title:'Работа',count:99}]}};
 };
 await f.module.mountLexicon(f.root,d,async()=>d);
 assert.ok(f.root.querySelector('#lexicon-quality').textContent.includes((1234).toLocaleString('ru-RU')+' подборок с разобранным значением'));
 assert.ok(f.root.querySelector('#lexicon-prepared'));
 const query=f.root.querySelector('#lexicon-query');query.value='account issue';query.oninput({target:query});await scheduled();
 for(const [selector,value]of [['#lexicon-list','ngsl-1.2'],['#lexicon-kind','word'],['#lexicon-topic','work']]){
  const control=f.root.querySelector(selector);control.value=value;control.onchange({target:control});await tick();
 }
 f.root.querySelector('#lexicon-next').click();await tick();
 assert.equal(new URLSearchParams(f.requests.at(-1).path.split('?')[1]).get('offset'),'36');
 const prepared=f.root.querySelector('#lexicon-prepared');prepared.value='1';prepared.onchange({target:prepared});await tick();
 const params=new URLSearchParams(f.requests.at(-1).path.split('?')[1]);
 assert.deepEqual(Object.fromEntries(params),{q:'account issue',list:'ngsl-1.2',kind:'word',topic:'work',prepared:'1',offset:'0',limit:'36'});
 assert.equal(f.root.querySelector('#lexicon-prev').disabled,true);
});

test('entry opens the first prepared context while active reference examples keep their original draft IDs',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data(),article={...entry(),word:'issue',kind:'word'};
 article.contexts=[
  context('imported',{en:'An imported issue needs attention.',quality:undefined}),
  context('archived',{en:'An archived issue must stay hidden.',excludedFromStudy:true}),
  context('prepared',{en:'The prepared issue is easy to explain.'}),
  context('reference',{en:'A reference issue remains available.',senseId:undefined}),
 ];
 d.state.drafts['lexicon:answer:issue:prepared']={text:'My previously saved prepared answer.'};
 d.state.drafts['lexicon:answer:issue:imported']={text:'My previously saved imported answer.'};
 f.api=async()=>({entry:article,metadata:{}});
 await f.module.mountLexicon(f.root,d,async()=>d,article.id);
 assert.match(f.root.innerHTML,/The prepared issue is easy to explain\./);
 assert.match(f.root.innerHTML,/Контекст 1 из 3 · значение разобрано/);
 assert.doesNotMatch(f.root.innerHTML,/An archived issue must stay hidden/);
 let answer=f.root.querySelector('#lexicon-answer');
 assert.equal(answer.value,'My previously saved prepared answer.');
 answer.value='My revised prepared answer.';answer.oninput();
 assert.equal(f.local.get('lexicon:answer:issue:prepared'),answer.value);
 f.root.querySelector('#lexicon-next-context').click();
 assert.match(f.root.innerHTML,/An imported issue needs attention\./);
 assert.match(f.root.innerHTML,/Контекст 2 из 3 · справочный пример/);
 answer=f.root.querySelector('#lexicon-answer');assert.equal(answer.value,'My previously saved imported answer.');
 answer.value='My revised imported answer.';answer.oninput();
 assert.equal(f.local.get('lexicon:answer:issue:imported'),answer.value);
 f.root.querySelector('#lexicon-next-context').click();
 assert.match(f.root.innerHTML,/A reference issue remains available\./);
 assert.equal(f.root.querySelector('#lexicon-next-context').disabled,true);
 f.root.querySelector('#lexicon-prev-context').click();
 assert.equal(f.root.querySelector('#lexicon-answer').value,'My revised imported answer.');
 f.root.querySelector('#lexicon-prev-context').click();
 assert.equal(f.root.querySelector('#lexicon-answer').value,'My revised prepared answer.');
 assert.deepEqual([...f.local.keys()].sort(),['lexicon:answer:issue:imported','lexicon:answer:issue:prepared']);
});
