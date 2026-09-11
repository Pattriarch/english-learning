import test from 'node:test';
import assert from 'node:assert/strict';
import {fastVocabOptions,fastVocabURL,fastDueCards,fastExistingCard,fastCardEntryID,fastSavedTarget,fastLexicalCard,fastSwipeRating,fastKeyAction} from '../fast-vocab-model.js';

const source=()=>({id:'approve',word:'approve',senses:[{id:'s1',definition:'Accept officially.'}],contexts:[{id:'c1',en:'They approved the plan.',ru:'Они одобрили план.',targetSpans:[{start:5,end:13,text:'approved'}],senseId:'s1',quality:'ai-context-reviewed',explanation:'Approve means accept a plan.',source:{author:'Author',license:'CC BY',url:'https://example.test/context'}}]});
test('fast practice supports its two directions and preserves lexical filters in the route',()=>{
 const options=fastVocabOptions({q:'a/b',list:'ngsl-1.2',topic:'work',kind:'word',direction:'produce',deck:'saved'});
 assert.equal(fastVocabURL(options),'#/lexicon/quick?deck=saved&direction=produce&q=a%2Fb&list=ngsl-1.2&kind=word&topic=work');
 assert.equal(fastVocabOptions({direction:'anything'}).direction,'recognize');
});
test('only due cards enter the existing review queue; malformed dates and duplicate IDs do not',()=>{
 const make=(id,due)=>({id,due,front:'RU',back:'EN'});
 const cards=[make('future','2099-01-01'),make('newer','2025-01-02'),make('older','2025-01-01'),make('bad','bad'),make('older','2024-01-01')];
 assert.deepEqual(fastDueCards(cards,Date.parse('2026-01-01')).map(c=>c.id),['older','newer']);
 assert.equal(fastExistingCard(cards,' RU ','EN'),cards[0]);
});
test('prepared context creates stable card identity, original attribution, and inflected target after reload',async()=>{
 const entry=source(),row=await fastLexicalCard(entry,entry.contexts[0]),same=await fastLexicalCard(entry,entry.contexts[0]);
 assert.equal(row.card.id,same.card.id);assert.match(row.card.id,/^lexq-[a-f0-9]{64}$/);
 assert.equal(fastCardEntryID(row.card),entry.id);assert.deepEqual(fastSavedTarget(row.card),entry.contexts[0].targetSpans);
 assert.match(row.card.note,/CC BY/);assert.match(row.card.note,/https:\/\/example.test\/context/);
 const changed=await fastLexicalCard(entry,{...entry.contexts[0],ru:'Изменённый смысл.'});assert.notEqual(changed.card.id,row.card.id);
 assert.equal(await fastLexicalCard(entry,{...entry.contexts[0],quality:'imported'}),null);
 assert.equal(await fastLexicalCard(entry,{...entry.contexts[0],excludedFromStudy:true}),null);
});
test('keyboard and swipe grading require the answer to be revealed; scrolling and small gestures never grade',()=>{
 assert.equal(fastKeyAction(' ',false),'reveal');assert.equal(fastKeyAction('2',false),null);assert.equal(fastKeyAction('ArrowRight',true),2);
 assert.equal(fastKeyAction('3',true),3);assert.equal(fastKeyAction('Enter',true),null);
 assert.equal(fastSwipeRating(120,3,false),null);assert.equal(fastSwipeRating(30,2,true),null);assert.equal(fastSwipeRating(80,90,true),null);
 assert.equal(fastSwipeRating(-90,5,true),0);assert.equal(fastSwipeRating(90,5,true),2);
});
