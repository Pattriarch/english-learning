import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI,deferred} from './study-ui-fixture.mjs';

function reviewData(){return{state:{cards:['A','B','C'].map((id,i)=>({id,front:'Meaning '+id,back:'English '+id,note:'Context',source:'Test',due:`2020-01-0${i+1}T00:00:00Z`,repetitions:0})),drafts:{},read:{},attempts:[]},settings:{}};}
function enterRecall(f,text){const target=f.root.querySelector('#recall');target.value=text;target.oninput();return target;}
function rate(f,rating=2){f.root.querySelector('#reveal').click();return f.root.querySelectorAll('[data-rating]')[rating].click();}
async function deleteCard(f,id){f.root.querySelectorAll('[data-delete]').find(button=>button.dataset.delete===id).click();await f.modal.querySelector('#confirm-delete').click();}

test('Review restores each recall draft, including a deliberately emptied local edit',async t=>{
 const f=await studyUI(t,'pages.js'),data=reviewData();data.state.drafts['review:A']={text:'Saved recall A'};
 f.module.mountReview(f.root,data,async()=>data);assert.equal(f.root.querySelector('#recall').value,'Saved recall A');
 enterRecall(f,'My newer recall A');f.module.mountReview(f.root,data,async()=>data);assert.equal(f.root.querySelector('#recall').value,'My newer recall A');
 enterRecall(f,'');f.module.mountReview(f.root,data,async()=>data);assert.equal(f.root.querySelector('#recall').value,'');
 assert.equal(f.local.get('review:A'),'');
});

test('A late successful rating of deleted A keeps B and its new input, then advances only after B is rated',async t=>{
 const f=await studyUI(t,'pages.js'),data=reviewData(),ratingA=deferred();
 f.api=async(path,body)=>{if(path==='/review'&&body.cardId==='A')return ratingA.promise;if(path==='/cards/A'){data.state.cards=data.state.cards.filter(card=>card.id!=='A');return{};}return{};};
 f.module.mountReview(f.root,data,async()=>data);enterRecall(f,'Recalled A');const pendingA=rate(f);
 await deleteCard(f,'A');assert.match(f.root.querySelector('#review-work').innerHTML,/Meaning B/);
 const recallB=enterRecall(f,'My unfinished recall B');ratingA.resolve({});await pendingA;
 assert.equal(f.root.querySelector('#recall'),recallB);assert.equal(recallB.value,'My unfinished recall B');assert.equal(f.local.get('review:B'),'My unfinished recall B');
 assert.match(f.root.querySelector('#review-work').innerHTML,/Meaning B/);assert.equal(f.local.get('review:A'),'');
 await rate(f);assert.match(f.root.querySelector('#review-work').innerHTML,/Meaning C/);
 assert.deepEqual(f.requests.filter(request=>request.path==='/review').map(request=>[request.body.cardId,request.body.answer]),[['A','Recalled A'],['B','My unfinished recall B']]);
});

test('A late failed rating of deleted A cannot disturb B after its answer is revealed',async t=>{
 const f=await studyUI(t,'pages.js'),data=reviewData(),ratingA=deferred();
 f.api=async(path,body)=>{if(path==='/review'&&body.cardId==='A'){await ratingA.promise;throw Error('Old A rating failed');}if(path==='/cards/A'){data.state.cards=data.state.cards.filter(card=>card.id!=='A');return{};}return{};};
 f.module.mountReview(f.root,data,async()=>data);enterRecall(f,'Recalled A');const pendingA=rate(f);
 await deleteCard(f,'A');const recallB=enterRecall(f,'Recalled B');f.root.querySelector('#reveal').click();
 const ratings=f.root.querySelectorAll('[data-rating]');ratingA.resolve();await pendingA;
 assert.equal(f.root.querySelector('#recall'),recallB);assert.equal(recallB.value,'Recalled B');assert.ok(ratings.every(button=>!button.disabled));assert.equal(f.alerts.length,0);
 await ratings[2].click();assert.match(f.root.querySelector('#review-work').innerHTML,/Meaning C/);assert.equal(f.local.get('review:B'),'');
});
