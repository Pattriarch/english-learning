import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lexicalImage,lexicalImageURL} from '../lexicon-model.js';
import {studyUI} from './study-ui-fixture.mjs';

const registry=JSON.parse(readFileSync(new URL('../../content/lexicon/context-images.json',import.meta.url),'utf8'));
const asset=registry.assets[0],binding=registry.bindings[0];
const image={...asset,sceneId:asset.id,contextId:binding.contextId,overlayVersion:registry.version};
const context={id:binding.contextId,en:'He sat down on the bench and began to read the book.',ru:'Он сел на скамейку и начал читать книгу.',targetSpans:[{start:19,end:24,text:'bench'}],productionTask:'Describe your own place to read using bench.',explanation:'Bench means a seat here.'};
const entry=()=>({id:binding.entryId,word:'bench',kind:'word',senses:[],contexts:[context,{...context,id:'a-different-sense',en:'The judge took her place on the bench.',ru:'Судья заняла своё место.'}],images:[image]});
const data=()=>({state:{drafts:{},attempts:[]},settings:{provider:'offline'}});

test('verified learning figures use safe local PNG paths without expanding to private or remote media',()=>{
 assert.equal(lexicalImageURL(image),'/assets/learning-figures/courtyard-actions.png');
 for(const src of ['/assets/learning-figures/../secret.png','/assets/learning-figures/other%2fimage.png','/assets/learning-figures/x.png?y','/assets/learning-figures/x.svg','/media/private.png','https://example.com/x.png','//example.com/x.png'])assert.equal(lexicalImageURL({...image,src}),'');
 assert.equal(lexicalImage(entry(),context).src,asset.src);
 assert.equal(lexicalImage(entry(),entry().contexts[1]),null);
 assert.equal(lexicalImageURL({src:'/assets/vocabulary-scenes/friends-cafe.png'}),'/assets/vocabulary-scenes/friends-cafe.png');
});

test('the exact bench scene and its limited description travel through the existing media/card flow',async t=>{
 const cards=[],key='capturedLexicalImageCard';
 const previous=Object.getOwnPropertyDescriptor(globalThis,key);
 Object.defineProperty(globalThis,key,{configurable:true,value:async card=>cards.push(card)});
 t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);
 const f=await studyUI(t,'lexicon.js',{},source=>source.replace('await cardModal(',`await globalThis.${key}(`)),d=data();
 const png=readFileSync(new URL('../assets/learning-figures/courtyard-actions.png',import.meta.url));
 const mediaName=asset.sha256+'.png';let fetched;
 f.api=async(path,body)=>{
  if(path.startsWith('/lexicon/'))return{entry:entry(),metadata:{}};
  assert.equal(path,'/media');assert.ok(body instanceof FormData);
  const upload=body.get('file');assert.equal(upload.name,'context.png');
  assert.deepEqual(Buffer.from(await upload.arrayBuffer()),png);
  return{image:mediaName};
 };
 f.fetch=async path=>{fetched=path;return{ok:true,blob:async()=>new Blob([png],{type:'image/png'})};};
 await f.module.mountLexicon(f.root,d,async()=>d,binding.entryId);
 assert.match(f.root.innerHTML,/courtyard-actions\.png/);
 assert.ok(f.root.innerHTML.includes(asset.associationRu));
 await f.root.querySelector('#lexicon-card').click();
 assert.equal(fetched,asset.src);assert.equal(cards.length,1);
 assert.equal(cards[0].image,mediaName);assert.equal(cards[0].front,context.ru);assert.equal(cards[0].back,context.en);
 assert.ok(cards[0].note.includes(asset.associationRu));
 assert.equal(f.requests.filter(r=>r.path==='/media').length,1);
 await f.root.querySelector('#lexicon-next-context').click();
 assert.doesNotMatch(f.root.innerHTML,/courtyard-actions\.png/);
 await f.root.querySelector('#lexicon-card').click();
 assert.equal(cards[1].image,'');assert.equal(f.requests.filter(r=>r.path==='/media').length,1,'sibling meaning must not upload the first context’s picture');
 assert.equal(f.local.size,0,'saving an image card must not change unrelated learner drafts');
});
