import test from 'node:test';
import assert from 'node:assert/strict';
import {russianCount,russianPlural} from '../russian-count.js';

test('Russian count labels handle singular, small plurals and teen exceptions',()=>{
 const forms=['занятие','занятия','занятий'];
 for(const [n,label] of [[0,'занятий'],[1,'занятие'],[2,'занятия'],[4,'занятия'],[5,'занятий'],[11,'занятий'],[12,'занятий'],[14,'занятий'],[21,'занятие'],[22,'занятия'],[111,'занятий'],[114,'занятий']])assert.equal(russianPlural(n,forms),label,String(n));
 assert.equal(russianCount(1,forms),'1 занятие');assert.equal(russianCount(4,forms),'4 занятия');assert.equal(russianCount(19,['обзорное занятие','обзорных занятия','обзорных занятий']),'19 обзорных занятий');
});
