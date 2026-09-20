import test from 'node:test';
import assert from 'node:assert/strict';
import {spokenAnswer,answerAudioHTML,primaryAnswerAudio,bindAnswerAudio} from '../feedback-audio.js';
import {feedbackHTML} from '../core.js';

test('feedback offers English corrected/accepted answers and alternate models, never a rejected raw answer',()=>{
  const wrong={answer:'I is ready.',feedback:{verdict:'incorrect',corrected:'I am ready.',alternatives:["I'm ready.",'По-русски: я готов.']}};
  const html=feedbackHTML(wrong);
  assert.match(html,/data-answer-audio="I am ready\."/);
  assert.match(html,/data-answer-audio="I&#39;m ready\."/);
  assert.doesNotMatch(html,/data-answer-audio="I is ready/);
  assert.doesNotMatch(html,/data-answer-audio="По-русски/);
  assert.equal(primaryAnswerAudio({answer:'I am ready.',feedback:{verdict:'correct'}}),'I am ready.');
  assert.equal(primaryAnswerAudio({answer:'I is ready.',feedback:{verdict:'ungraded'}}),'');
  assert.equal(primaryAnswerAudio({answer:'I is ready.',feedback:{verdict:'incorrect'}}),'');
  assert.equal(spokenAnswer('This is /sɪt/.'),'');
  assert.equal(spokenAnswer('/si/'),'');
  assert.equal(spokenAnswer('Мой ответ I am ready.'),'');
  assert.equal(spokenAnswer('a'.repeat(6001)),'');
  assert.match(answerAudioHTML('He said "yes" & left.'),/He said &quot;yes&quot; &amp; left\./);
});

test('answer audio uses American Kokoro and cannot start after asynchronous route departure',async()=>{
  const button={dataset:{answerAudio:'I am ready.'},isConnected:true};
  const root={querySelectorAll:()=>[button]},spoken=[];
  bindAnswerAudio(root,async()=>({speak:async(...args)=>spoken.push(args)}));
  await button.onclick();assert.deepEqual(spoken[0].slice(0,3),['I am ready.',.9,'en-US']);
  assert.equal(spoken[0][3].isCurrent(),true);button.isConnected=false;
  assert.equal(spoken[0][3].isCurrent(),false);
  let resolve;button.isConnected=true;bindAnswerAudio(root,()=>new Promise(done=>resolve=done));
  const pending=button.onclick();button.isConnected=false;resolve({speak:async()=>assert.fail('Cannot play on departed page')});await pending;
});
