import test from 'node:test';
import assert from 'node:assert/strict';
import {studyUI,deferred} from './study-ui-fixture.mjs';
const catalog={levels:[{level:'B1',indicators:[]}],sources:[]};
test('late mastery responses cannot replace the next route',async t=>{
 const f=await studyUI(t,'mastery.js'),pending=deferred();location.hash='#/mastery';
 f.api=path=>path==='/projects'?{units:[]}:pending.promise;
 const loading=f.module.mountMastery(f.root,{state:{}},async()=>{});
 location.hash='#/today';f.root.innerHTML='<h1 id="next-page">Today</h1>';
 pending.resolve(catalog);await loading;
 assert.ok(f.root.querySelector('#next-page'));
});
test('older mastery mount is ignored even after returning to the same route',async t=>{
 const f=await studyUI(t,'mastery.js'),pending=deferred();location.hash='#/mastery';
 f.api=path=>path==='/projects'?{units:[]}:pending.promise;
 const old=f.module.mountMastery(f.root,{state:{}},async()=>{});
 f.api=path=>path==='/projects'?{units:[]}:catalog;
 await f.module.mountMastery(f.root,{state:{}},async()=>{});
 const latest=f.root.innerHTML;
 pending.resolve({levels:[{level:'B2',indicators:[]}],sources:[]});await old;
 assert.equal(f.root.innerHTML,latest);
});
