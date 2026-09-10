import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceStudySession,restoreStudySession} from '../study-session.js';
const session={version:1,day:'2026-09-10',blockId:'reading',title:'Прочитать',minutes:15,seconds:4,sinceBreak:100,totals:{},active:true,stage:'study',breakSeconds:300};
test('A reopened session resumes paused and never credits time while the app was closed',()=>{
  assert.equal(restoreStudySession(JSON.stringify(session),'2026-09-10').active,false);
  assert.equal(restoreStudySession(JSON.stringify(session),'2026-09-11'),null);
});
test('Hidden and paused sessions do not add study time; long suspension is bounded',()=>{
  assert.equal(advanceStudySession(session,30,false),session);
  const paused={...session,active:false};assert.equal(advanceStudySession(paused,30),paused);
  const advanced=advanceStudySession(session,300);assert.equal(advanced.seconds,9);assert.equal(advanced.totals.reading,9);
  assert.equal(session.seconds,4);
});
test('A break counts down without adding study time or completing a task',()=>{
  const result=advanceStudySession({...session,stage:'break',breakSeconds:2},3);
  assert.equal(result.breakSeconds,0);assert.equal(result.active,false);assert.equal(result.seconds,4);
});
test('A five-minute break finishes while the screen is hidden or the computer is asleep',()=>{
  const value={...session,stage:'break',breakEndsAt:301000};
  assert.equal(advanceStudySession(value,1,false,301000).breakSeconds,0);
  assert.equal(restoreStudySession(JSON.stringify(value),session.day,400000).breakSeconds,0);
  assert.equal(advanceStudySession(value,1,false,301000).seconds,session.seconds);
});
