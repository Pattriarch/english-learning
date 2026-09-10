import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreMediaAttachment,cropImage} from '../media.js';

const image='a'.repeat(64)+'.png';
const phrase='I have been working on it.';
const raw=JSON.stringify({phrase,image,source:'Episode 1 · 12:34'});

test('a media draft restores its uploaded frame and source only for the matching phrase',()=>{
 assert.deepEqual(restoreMediaAttachment(raw,phrase),{image,source:'Episode 1 · 12:34'});
 assert.deepEqual(restoreMediaAttachment(raw,'A new subtitle.'),{image:'',source:''});
 assert.deepEqual(restoreMediaAttachment(raw,''),{image:'',source:''});
 assert.deepEqual(restoreMediaAttachment(JSON.stringify({phrase:'',image:'',source:''}),''),{image:'',source:''});
});

test('invalid attachment data cannot turn a restored draft into an external or arbitrary local image',()=>{
 for(const bad of ['not JSON','null','{}'])assert.deepEqual(restoreMediaAttachment(bad,phrase),{image:'',source:''});
 for(const bad of ['../../settings.json','https://example.com/frame.png','data:image/png;base64,abc']){
  assert.deepEqual(restoreMediaAttachment(JSON.stringify({phrase,image:bad,source:'Source'}),phrase),{image:'',source:'Source'});
 }
 assert.deepEqual(restoreMediaAttachment(JSON.stringify({phrase,image,source:123}),phrase),{image,source:''});
});

test('finishing image decoding after media navigation never opens the crop modal',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Image');
 let finishDecode;
 Object.defineProperty(globalThis,'Image',{configurable:true,value:class{decode(){return new Promise(resolve=>{finishDecode=resolve;});}}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'Image',descriptor);else delete globalThis.Image;});
 const controller=new AbortController();
 const pending=cropImage(new Blob(['image']),()=>true,controller.signal);
 controller.abort();finishDecode();
 assert.equal(await pending,null);
 // There is deliberately no document in this test. Any late modal access
 // would throw instead of returning quietly after decoding.
 const active=new AbortController(),superseded=cropImage(new Blob(['image']),()=>false,active.signal);
 finishDecode();assert.equal(await superseded,null);
});
