import test from 'node:test';
import assert from 'node:assert/strict';
import {restorePracticeTask,practiceTaskIndex} from '../pages.js';

test('A custom prompt, source and follow-up context survive reopening practice',()=>{
  const task={id:'custom-1',title:'Твоя задача',prompt:'Explain what changed.',passage:'The course moved to Friday.',level:'B2',conversation:[{question:'Why?',answer:'Because I work on Fridays.'}]};
  assert.deepEqual(restorePracticeTask(JSON.stringify(task)),task);
});

test('Invalid saved task data cannot replace the practice screen with broken content',()=>{
  for(const raw of ['null','[]','42','{}','{"id":"x","title":"x","prompt":42}','{"id":"x","title":"x","prompt":" "}','broken'])assert.equal(restorePracticeTask(raw),null);
});

test('Returning to a sample restores its stable draft key after cycling tasks',()=>{
  assert.equal(practiceTaskIndex('2',3),2);
  assert.equal(practiceTaskIndex('3',3),0);
  for(const raw of ['-1','NaN','2.2','Infinity'])assert.equal(practiceTaskIndex(raw,3),0);
});
