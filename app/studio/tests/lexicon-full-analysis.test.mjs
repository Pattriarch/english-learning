import test from 'node:test';
import assert from 'node:assert/strict';
import {lexicalContextGuide,lexicalFullAnalysis,lexicalStudyContexts,lexicalGuideNote,lexicalPracticeSpec,lexicalPracticeSignature} from '../lexicon-model.js';
import {studyUI} from './study-ui-fixture.mjs';

const data=()=>({state:{drafts:{},attempts:[]},settings:{provider:'offline'}});
const context=(overrides={})=>({
 id:'problem-context',en:'There is an issue with the report.',ru:'В отчёте есть проблема.',senseId:'problem',quality:'ai-context-reviewed',
 meaningRu:'Проблема, которую нужно решить.',explanation:'Здесь issue обозначает проблему в отчёте, а не выпуск журнала.',
 usageNotes:['Для указания проблемы используй an issue with + предмет или процесс.','Когда проблему решают, можно сказать resolve an issue.'],
 collocations:[{text:'an issue with the report',ru:'проблема с отчётом'},{text:'resolve an issue',ru:'решить проблему'}],
 commonMistakes:[{wrong:'an issue of the report',correct:'an issue with the report',why:'Для проблемы с чем-либо здесь нужен with; of может обозначать выпуск издания.'}],
 productionTask:'Напиши коллеге два предложения: обозначь проблему в другом документе и предложи следующий шаг.',
 targetSpans:[],...overrides,
});
const article=()=>({id:'issue',word:'issue',kind:'word',senses:[{id:'problem',pos:'noun',definition:'A problem that needs attention.'}],contexts:[context()]});

test('a full contextual analysis requires reviewed sense linkage and every usable learning component',()=>{
 const e=article();assert.equal(lexicalFullAnalysis(e,context()),true);
 for(const overrides of [
  {meaningRu:' '},{explanation:null},{usageNotes:['Only one']},{usageNotes:[null,{},' ']},
  {collocations:[{text:'one',ru:'один'}]},{collocations:[{text:'one',ru:'один'},{text:'two',ru:' '}]},
  {commonMistakes:[{wrong:'one',correct:'two'}]},{commonMistakes:[]},{productionTask:' '},
  {quality:'source-context'},{senseId:'unlinked'},{excludedFromStudy:true},
 ])assert.equal(lexicalFullAnalysis(e,context(overrides)),false,JSON.stringify(overrides));
 assert.equal(lexicalFullAnalysis({...e,senses:[]},context()),false);
 assert.equal(lexicalFullAnalysis({...e,quality:{status:'complete'}},context({meaningRu:''})),false);
});

test('malformed optional guidance stays harmless and partial legacy collocations remain readable',()=>{
 const c=context({usageNotes:[' one ',null,{}],collocations:[null,{text:' keep ',ru:' '},{text:' '},{text:8}],commonMistakes:[null,{wrong:' wrong ',correct:' correct ',why:' why '},{wrong:'incomplete'}]});
 const guide=lexicalContextGuide(c);
 assert.deepEqual(guide.usageNotes,['one']);assert.deepEqual(guide.collocations,[{text:'keep',ru:''}]);
 assert.deepEqual(guide.commonMistakes,[{wrong:'wrong',correct:'correct',why:'why'}]);
 assert.deepEqual(lexicalContextGuide({usageNotes:{},collocations:42,commonMistakes:'bad'}).usageNotes,[]);
 assert.equal(lexicalFullAnalysis(article(),c),false);
});

test('full analyses open before basic and reference contexts without changing identifiers or source order',()=>{
 const e=article();e.contexts=[context({id:'basic',usageNotes:[]}),context({id:'reference',quality:'source-context'}),context({id:'full'}),context({id:'archived-full',excludedFromStudy:true}),context({id:'second-full'})];
 const before=structuredClone(e);
 assert.deepEqual(lexicalStudyContexts(e).map(c=>c.id),['full','second-full','basic','reference']);
 assert.deepEqual(e,before);
});

test('guidance changes invalidate assessment provenance and travel with the review note',()=>{
 const e=article(),c=e.contexts[0],signature=lexicalPracticeSignature(lexicalPracticeSpec(e,c,c.ru,'B1'));
 for(const overrides of [
  {meaningRu:'Другой смысл'}, {usageNotes:['Другой способ использования']},
  {collocations:[{text:'a different issue',ru:'другая проблема'}]},
  {commonMistakes:[{wrong:'a',correct:'b',why:'Другое пояснение'}]},
  {register:'Только формальная речь'}, {registerTags:['formal','technical']}, {usAlternative:'A problem with the report'},
 ])assert.notEqual(lexicalPracticeSignature(lexicalPracticeSpec(e,{...c,...overrides},c.ru,'B1')),signature);
 const note=lexicalGuideNote(c);
 for(const expected of [c.meaningRu,...c.usageNotes,c.collocations[0].text,c.collocations[0].ru,c.commonMistakes[0].why])assert.ok(note.includes(expected));
 assert.match(note,/Не подходит здесь:/);assert.match(note,/Подходит:/);
});

test('full guidance renders Russian meanings and collocation translations, escapes content, and limits its completeness claim',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data(),e=article();
 e.contexts[0].meaningRu='Проблема <script>alert(1)</script>';
 e.contexts[0].commonMistakes[0].wrong='<img src=x onerror=alert(1)>';
 f.api=async()=>({entry:e,metadata:{}});await f.module.mountLexicon(f.root,d,async()=>d,e.id);
 const html=f.root.innerHTML;
 for(const title of ['Смысл именно здесь','Что это выражает и почему так','Как построить свою фразу','С чем употребляется','На что обратить внимание'])assert.ok(html.includes(title));
 assert.match(html,/Контекст 1 из 1 · полный разбор примера/);
 assert.match(html,/<dd>решить проблему<\/dd>/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<script>|<img src=x/);
});

test('recall hides English-bearing explanations and reveal shortcuts while preserving the learner draft',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data(),e=article();
 f.api=async()=>({entry:e,metadata:{}});await f.module.mountLexicon(f.root,d,async()=>d,e.id);
 const answer=f.root.querySelector('#lexicon-answer');answer.value='There is an issue with my proposal.';answer.oninput();
 await f.root.querySelector('#lexicon-reveal').click();
 assert.equal(f.root.querySelector('#lexicon-analysis').hidden,true);
 assert.equal(f.root.querySelector('.lexicon-example').hidden,true);
 assert.equal(f.root.querySelector('.lexicon-other-senses').hidden,true);
 assert.equal(f.root.querySelector('#lexicon-feedback').hidden,true);
 assert.equal(f.root.querySelector('#lexicon-reveal').attrs['aria-expanded'],'false');
 for(const id of ['lexicon-listen','lexicon-explain','lexicon-card'])assert.equal(f.root.querySelector('#'+id).disabled,true,id);
 assert.equal(f.root.querySelector('#lexicon-answer').value,answer.value);
 await f.root.querySelector('#lexicon-listen').click();assert.equal(f.spoken.length,0);
 await f.root.querySelector('#lexicon-reveal').click();
 assert.equal(f.root.querySelector('#lexicon-analysis').hidden,false);
 assert.equal(f.root.querySelector('#lexicon-answer').value,answer.value);
 assert.equal(f.root.querySelector('#lexicon-reveal').attrs['aria-expanded'],'true');
 await f.root.querySelector('#lexicon-listen').click();assert.equal(f.spoken[0][0],e.contexts[0].en);
});

test('requesting correction during recall shows feedback without revealing the source guidance',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data(),e=article();
 f.api=async(path,body)=>path.startsWith('/lexicon/')?{entry:e,metadata:{}}:{...body,feedback:{verdict:'correct',summary:'Your own wording works.',mistakes:[],alternatives:[]}};
 await f.module.mountLexicon(f.root,d,async()=>d,e.id);await f.root.querySelector('#lexicon-reveal').click();
 const target=f.root.querySelector('#lexicon-answer');target.value='There is an issue with our budget.';target.oninput();
 await f.root.querySelector('#lexicon-check').click();
 assert.equal(f.root.querySelector('#lexicon-analysis').hidden,true);
 assert.equal(f.root.querySelector('#lexicon-feedback').hidden,false);
 assert.match(f.root.querySelector('#lexicon-feedback').innerHTML,/Your own wording works/);
 assert.ok(f.requests.find(r=>r.path==='/check').body.context.includes(e.contexts[0].usageNotes[0]));
});

test('coverage counts only appear when the server supplies full-analysis counts',async t=>{
 const f=await studyUI(t,'lexicon.js'),d=data();let metadata={};
 f.api=async()=>({items:[],total:0,offset:0,metadata});
 await f.module.mountLexicon(f.root,d,async()=>d);assert.doesNotMatch(f.root.querySelector('#lexicon-quality').textContent,/Полные пояснения/);
 metadata={fullAnalysisEntries:100,fullAnalysisContexts:150};await f.module.mountLexicon(f.root,d,async()=>d);
 assert.match(f.root.querySelector('#lexicon-quality').textContent,/100 статей, 150 контекстов/);
 assert.match(f.root.querySelector('#lexicon-quality').textContent,/не разбор всех возможных значений/);
});
