import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI,deferred} from './study-ui-fixture.mjs';

const config={engine:'kokoro',voice:'af_heart',culture:'en-US',available:true,voices:[{id:'af_heart',name:'Heart',culture:'en-US'},{id:'af_bella',name:'Bella',culture:'en-US'},{id:'am_michael',name:'Michael',culture:'en-US'},{id:'am_fenrir',name:'Fenrir',culture:'en-US'}]};

test('previewing different voices uses identical text and only Save changes the configuration',async t=>{
 const f=await studyUI(t,'voice-settings.js');f.api=async(path,body)=>{assert.equal(path,'/speech/config');return{...config,...body};};
 await f.module.mountVoiceSettings(f.root);
 const select=f.root.querySelector('#speech-voice'),save=f.root.querySelector('#speech-save'),preview=f.root.querySelector('#speech-preview');assert.equal(select.value,'af_heart');assert.equal(save.disabled,true);
 await preview.click();select.value='am_fenrir';select.onchange();await preview.click();
 assert.equal(f.spoken.length,2);assert.equal(f.spoken[0][0],f.spoken[1][0]);assert.equal(f.spoken[1][3].voice,'am_fenrir');assert.equal(f.requests.length,1);assert.equal(save.disabled,false);
 await save.click();assert.deepEqual(f.requests[1],{path:'/speech/config',body:{voice:'am_fenrir'}});assert.equal(save.disabled,true);assert.match(f.root.querySelector('#speech-config-status').textContent,/сохранён/);
});

test('changing the preview selection invalidates the old playback request',async t=>{
 const f=await studyUI(t,'voice-settings.js');f.api=async()=>config;await f.module.mountVoiceSettings(f.root);await f.root.querySelector('#speech-preview').click();
 assert.equal(f.spoken[0][3].isCurrent(),true);f.root.querySelector('#speech-voice').value='af_bella';f.root.querySelector('#speech-voice').onchange();assert.equal(f.spoken[0][3].isCurrent(),false);
});

test('configuration failure can retry and a failed save keeps the change available to retry',async t=>{
 const f=await studyUI(t,'voice-settings.js');f.api=async()=>{throw Error('Service unavailable');};await f.module.mountVoiceSettings(f.root);assert.match(f.root.innerHTML,/Service unavailable/);
 f.api=async()=>config;await f.root.querySelector('#speech-retry').click();const select=f.root.querySelector('#speech-voice');select.value='af_bella';select.onchange();
 f.api=async()=>{throw Error('Saving failed');};await f.root.querySelector('#speech-save').click();assert.equal(select.disabled,false);assert.equal(f.root.querySelector('#speech-save').disabled,false);assert.match(f.root.querySelector('#speech-config-status').textContent,/Saving failed/);
});

test('a superseded configuration load cannot replace the latest voice selection',async t=>{
 const f=await studyUI(t,'voice-settings.js'),old=deferred();let calls=0;f.api=async()=>++calls===1?old.promise:{...config,voice:'af_bella'};
 const pending=f.module.mountVoiceSettings(f.root);await f.module.mountVoiceSettings(f.root);old.resolve(config);await pending;assert.equal(f.root.querySelector('#speech-voice').value,'af_bella');
});
