import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decoderKey,decoderResult,decoderProgress,correctDecoding} from '../pronunciation-decoder.js';
import {studyUI,deferred} from './study-ui-fixture.mjs';
const catalog=JSON.parse(readFileSync(new URL('../../content/pronunciation.json',import.meta.url),'utf8'));
const data=()=>({pronunciation:catalog,state:{drafts:{},attempts:[],read:{}}});

test('IPA decoding is cumulative: every target symbol was introduced and every word was taught',()=>{
  assert.equal(catalog.decoder.stages.length,14);
  const known=new Set(),ids=new Set();let count=0;
  for(const stage of catalog.decoder.stages){
    assert.ok(!ids.has(stage.id));ids.add(stage.id);stage.symbols.forEach(s=>known.add(s));
    const tokens=[...known].sort((a,b)=>b.length-a.length);
    assert.equal(stage.tasks.length,4);assert.ok(stage.explanation.length>=3);
    assert.ok(stage.explanation.every(p=>p.length<650),stage.id);
    for(const task of stage.tasks){
      count++;assert.ok(stage.words.some(w=>w.word===task.answer&&w.ipa===task.ipa&&w.meaning===task.meaning),stage.id);
      assert.doesNotMatch(task.answer,/[А-Яа-яЁё]/);assert.ok(task.explanation);
      let remaining=task.ipa.replace(/[ /]/g,'');
      while(remaining){const token=tokens.find(t=>t.trim()&&remaining.startsWith(t));assert.ok(token,`${stage.id}: untaught symbol in ${remaining}`);remaining=remaining.slice(token.length);}
    }
  }
  assert.equal(count,56);
  assert.ok(['i','ɪ','æ','ə','ɝ','ɚ','ˈ','ˌ'].every(s=>known.has(s)));
  assert.ok(catalog.lessons.some(l=>l.id==='pron-02-ipa-and-dictionary'),'existing lesson IDs remain');
});

test('decoding results require the current revision and exact saved attempt; edited answers invalidate progress',()=>{
  const stage=catalog.decoder.stages[0],task=stage.tasks[0],key=decoderKey(stage,task),d=data();
  const read=(key,state)=>state.drafts[key]?.text||'';
  d.state.drafts[key]={text:'me'};d.state.drafts[key+':result']={text:JSON.stringify({answer:'me',correct:true,revealed:false})};
  assert.equal(decoderResult(stage,task,d.state,read).correct,true);
  assert.equal(decoderProgress(catalog,d.state,read)[0].done,1);
  d.state.drafts[key].text='meet';assert.equal(decoderResult(stage,task,d.state,read),null);
  d.state.drafts[key].text='me';assert.equal(decoderResult({...stage,revision:2},task,d.state,read),null);
  assert.equal(correctDecoding({answer:"I'm"},' I’m. '),true);
  assert.equal(correctDecoding({answer:'me'},'mе'),false,'Cyrillic lookalike is not an English answer');
});

test('typed IPA practice saves locally/server drafts, reveals spoken English and never calls an AI checker',async t=>{
  const f=await studyUI(t,'pronunciation-decoder.js'),d=data();
  f.module.mountIPADecoder(f.root,d);
  assert.match(f.root.innerHTML,/Напиши английскими буквами/);
  const target=f.root.querySelector('#ipa-answer');target.value='me';target.oninput();
  await f.root.querySelector('#ipa-check').click();
  const result=f.root.querySelector('#ipa-result');assert.match(result.innerHTML,/Да, ты прочитал верно/);
  const saved=JSON.parse(f.local.get('ipa-decoder:first-sounds:v1:w1:result'));assert.equal(saved.correct,true);
  await result.querySelector('[data-ipa-audio]').click();
  assert.deepEqual(f.spoken[0].slice(0,3),['me',.85,'en-US']);
  assert.equal(f.spoken[0][3].isCurrent(),true);
  f.root.querySelector('#ipa-next').click();assert.equal(f.spoken[0][3].isCurrent(),false);
  assert.ok(f.requests.every(r=>r.path!=='/check'));
  assert.equal(f.root.querySelector('#ipa-finish').disabled,true);
});

test('revealing an answer does not complete it; stored progress resumes without skipping untaught stages',async t=>{
  const f=await studyUI(t,'pronunciation-decoder.js'),d=data();
  d.state.drafts['ipa-decoder:position']={text:JSON.stringify({stage:'first-sounds',task:1.5})};
  f.module.mountIPADecoder(f.root,d);
  await f.root.querySelector('#ipa-reveal').click();
  assert.equal(JSON.parse(f.local.get('ipa-decoder:first-sounds:v1:w1:result')).correct,false);
  assert.equal(f.root.querySelector('#ipa-finish').disabled,true);
  const target=f.root.querySelector('#ipa-answer');target.value='me';target.oninput();await f.root.querySelector('#ipa-check').click();
  assert.equal(JSON.parse(f.local.get('ipa-decoder:first-sounds:v1:w1:result')).revealed,true);
  f.module.mountIPADecoder(f.root,d);assert.match(f.root.innerHTML,/Да, ты прочитал верно/);
});

test('all four typed answers unlock the next stage, but a failed durable completion does not navigate',async t=>{
  const f=await studyUI(t,'pronunciation-decoder.js'),d=data(),stage=catalog.decoder.stages[0];
  for(const task of stage.tasks){const key=decoderKey(stage,task);d.state.drafts[key]={text:task.answer};d.state.drafts[key+':result']={text:JSON.stringify({answer:task.answer,correct:true,revealed:false})};}
  d.state.drafts['ipa-decoder:position']={text:JSON.stringify({stage:stage.id,task:0})};
  f.api=async()=>{throw Error('Сервер недоступен');};
  f.module.mountIPADecoder(f.root,d);assert.equal(f.root.querySelector('#ipa-finish').disabled,false);
  await f.root.querySelector('#ipa-finish').click();assert.match(f.alerts.at(-1),/недоступен/);assert.match(f.root.innerHTML,/СТУПЕНЬ 1 \/ 14/);
  f.api=async()=>({});await f.root.querySelector('#ipa-finish').click();assert.match(f.root.innerHTML,/СТУПЕНЬ 2 \/ 14/);
  assert.ok(f.requests.some(r=>r.path==='/read'&&r.body.id==='ipa-decoder:first-sounds:v1'));
});

test('leaving during a delayed check cannot overwrite the next exercise',async t=>{
  const f=await studyUI(t,'pronunciation-decoder.js'),d=data(),saving=deferred(),started=deferred();let once=true;
  f.queueDraft=async(_key,_text,immediate)=>{if(immediate&&once){once=false;started.resolve();return saving.promise;}};
  f.module.mountIPADecoder(f.root,d);const target=f.root.querySelector('#ipa-answer');target.value='me';target.oninput();
  const pending=f.root.querySelector('#ipa-check').click();await started.promise;f.root.querySelector('#ipa-next').click();saving.resolve();await pending;
  assert.equal(f.root.querySelector('#ipa-answer').value,'');assert.equal(f.root.querySelector('#ipa-result').innerHTML,'');
});

test('IPA completion waits for durable answer/result confirmation before writing a completion marker',async t=>{
  const f=await studyUI(t,'pronunciation-decoder.js'),d=data(),stage=catalog.decoder.stages[0];
  for(const task of stage.tasks){const key=decoderKey(stage,task);d.state.drafts[key]={text:task.answer};d.state.drafts[key+':result']={text:JSON.stringify({answer:task.answer,correct:true,revealed:false})};}
  d.state.drafts['ipa-decoder:position']={text:JSON.stringify({stage:stage.id,task:0})};
  f.saveDraftConfirmed=async()=>{throw Error('Не подтверждён черновик');};
  f.module.mountIPADecoder(f.root,d);await f.root.querySelector('#ipa-finish').click();
  assert.ok(!f.requests.some(r=>r.path==='/read'));assert.match(f.alerts.at(-1),/черновик/);
  assert.equal(f.root.querySelector('#ipa-answer').readOnly,false);
  assert.equal(f.root.querySelector('#ipa-next').disabled,false);
});
