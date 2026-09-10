import test from 'node:test';
import assert from 'node:assert/strict';
import {recordOnly,stopAudio,beginAudio,voice,speak} from '../audio.js';

function browserFixture(t,getUserMedia){
  const descriptors=new Map();
  const install=(key,value)=>{descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  const stats={constructed:0,started:0,stopped:0,speechCancelled:0};
  const elements={'#toast':{},'#audio-preview':{isConnected:true,hidden:true},'#book-check':{disabled:false}};
  const players=[{paused:false,pause(){this.paused=true;}},{paused:false,pause(){this.paused=true;}}];
  class Recorder{
    constructor(){stats.constructed++;stats.recorder=this;this.state='inactive';this.mimeType='audio/webm';}
    start(){stats.started++;this.state='recording';}
    stop(){stats.stopped++;this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.finished=this.onstop?.();}
  }
  class Recognition{constructor(){stats.recognition=this;}start(){}stop(){}result(text){this.onresult?.({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});}}
  install('window',{MediaRecorder:Recorder,SpeechRecognition:Recognition,speechSynthesis:{cancel(){stats.speechCancelled++;}}});
  install('MediaRecorder',Recorder);
  install('navigator',{mediaDevices:{getUserMedia}});
  install('document',{querySelector:selector=>elements[selector]||null,querySelectorAll:selector=>selector.split(',').some(part=>part.trim()==='audio')?players:[]});
  install('AudioContext',class{async decodeAudioData(){return{duration:0.01};}async close(){}});
  install('OfflineAudioContext',class{createBufferSource(){return{connect(){},start(){}};}async startRendering(){return{getChannelData:()=>new Float32Array(160)};}});
  const timers=[],realTimeout=globalThis.setTimeout;install('setTimeout',(fn,delay)=>{const timer=realTimeout(fn,delay);timers.push(timer);return timer;});
  t.after(()=>{
    stopAudio();
    timers.forEach(clearTimeout);
    for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  });
  return{stats,players,elements,install};
}

function recordingElements(){
  const classes=new Set();
  return{
    button:{isConnected:true,disabled:false,innerHTML:'Record',classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}},
    preview:{isConnected:true,hidden:true},
    classes,
  };
}

function speechFixture(t,request){
 const f=browserFixture(t,()=>Promise.reject(Error('Microphone must stay off'))),nodes=[];
 f.install('fetch',async(url,options)=>{assert.equal(url,'/api/speech');return{ok:true,json:async()=>request(JSON.parse(options.body))};});
 document.createElement=tag=>{const node={tag,setAttribute(){},append(){},remove(){this.removed=true;},pause(){this.paused=true;},async play(){this.played=true;}};nodes.push(node);return node;};
 document.body={appendChild(node){node.attached=true;}};
 return{...f,nodes};
}

test('no browser voice uses a cached US WAV with playback controls, never the microphone',async t=>{
 const f=speechFixture(t,body=>{assert.deepEqual(body,{text:'I will keep you posted.',lang:'en-US'});return{audio:'a'.repeat(64)+'.wav',voice:'Zira',culture:'en-US'};});
 await speak('I will keep you posted.');
 const player=f.nodes.find(n=>n.tag==='audio');assert.equal(player.played,true);assert.equal(player.controls,true);assert.equal(player.src,'/media/'+'a'.repeat(64)+'.wav');
 stopAudio();assert.equal(player.paused,true);assert.equal(f.nodes.find(n=>n.tag==='aside').removed,true);
 assert.equal(f.stats.constructed,0);
});

test('late local speech does not play after Stop or route navigation',async t=>{
 let finish;const wait=new Promise(resolve=>{finish=resolve;});const f=speechFixture(t,()=>wait);
 const pending=speak('An old page.');stopAudio();finish({audio:'a'.repeat(64)+'.wav',voice:'Zira',culture:'en-US'});await pending;
 assert.equal(f.nodes.length,0);
});

test('American playback uses the local US voice when the browser only offers British English',async t=>{
 const f=speechFixture(t,()=>({audio:'b'.repeat(64)+'.wav',voice:'Zira',culture:'en-US'}));
 window.speechSynthesis.getVoices=()=>[{name:'British voice',lang:'en-GB',localService:true}];
 window.speechSynthesis.speak=()=>assert.fail('A British voice must not replace the requested American model');
 f.install('SpeechSynthesisUtterance',class{});
 await speak('The apartment is on the first floor.');
 assert.equal(f.nodes.find(n=>n.tag==='audio').played,true);
});

test('invalid local audio paths are rejected before a player is created',async t=>{
 const f=speechFixture(t,()=>({audio:'../../private.wav',voice:'Zira',culture:'en-US'}));await speak('Test sentence.');assert.equal(f.nodes.length,0);
});

test('Stopping audio while microphone permission is pending prevents a late recording even before the old page disconnects',async t=>{
  let grant,trackStops=0,readyCalls=0;
  const permission=new Promise(resolve=>{grant=resolve;});
  const{stats}=browserFixture(t,()=>permission);
  const{button,preview,classes}=recordingElements();
  const pending=recordOnly(button,preview,()=>{readyCalls++;});
  assert.equal(button.disabled,true);
  stopAudio();
  // Route navigation can still be awaiting bootstrap: the old button remains connected.
  assert.equal(button.isConnected,true);
  grant({getTracks:()=>[{stop(){trackStops++;}}]});
  await pending;
  assert.equal(trackStops,1,'The stream granted after cancellation must be released');
  assert.equal(stats.constructed,0,'A cancelled permission request must not construct a recorder');
  assert.equal(stats.started,0);
  assert.equal(readyCalls,0);
  assert.equal(preview.hidden,true);
  assert.equal(button.disabled,false);
  assert.equal(button.innerHTML,'Record');
  assert.equal(classes.has('recording'),false);
});

test('Stop audio pauses every local recording preview and cancels speech playback',t=>{
  const{stats,players}=browserFixture(t,()=>Promise.reject(new Error('Microphone should not be requested')));
  stopAudio();
  assert.ok(players.every(player=>player.paused));
  assert.equal(stats.speechCancelled,1);
  assert.equal(stats.started,0);
});

test('An uncancelled recording still starts and releases its microphone when stopped',async t=>{
  let trackStops=0;
  const{stats}=browserFixture(t,async()=>({getTracks:()=>[{stop(){trackStops++;}}]}));
  const{button,preview,classes}=recordingElements();
  await recordOnly(button,preview);
  assert.equal(stats.started,1);
  assert.equal(classes.has('recording'),true);
  stopAudio();
  assert.equal(stats.stopped,1);
  assert.equal(trackStops,1);
  assert.equal(classes.has('recording'),false);
  assert.equal(button.innerHTML,'Record');
});

test('A delayed audio file load loses permission to play after navigation or Stop',t=>{
  browserFixture(t,()=>Promise.reject(Error('unused')));
  const first=beginAudio();assert.equal(first(),true);
  stopAudio();assert.equal(first(),false);
  const second=beginAudio();assert.equal(second(),true);
  const third=beginAudio();assert.equal(second(),false);assert.equal(third(),true);
});

test('Cancelled dictation permission releases the late stream without starting recognition',async t=>{
  let grant,stops=0;
  const{stats}=browserFixture(t,()=>new Promise(resolve=>grant=resolve));
  const{button}=recordingElements(),target={isConnected:true,value:'My answer'};
  const pending=voice(button,target,{},()=>assert.fail('cancelled dictation edited the answer'));
  assert.equal(button.disabled,true);stopAudio();assert.equal(button.disabled,false);
  grant({getTracks:()=>[{stop(){stops++;}}]});await pending;
  assert.equal(stops,1);assert.equal(stats.started,0);assert.equal(stats.recognition,undefined);
});

test('A late recognition event cannot overwrite manual edits or a cancelled recording',async t=>{
  const{stats}=browserFixture(t,async()=>({getTracks:()=>[{stop(){}}]}));
  const{button}=recordingElements(),target={isConnected:true,value:'Initial'};let inputs=0;
  await voice(button,target,{},()=>inputs++);
  stats.recognition.result('spoken words');assert.equal(target.value,'Initial spoken words');assert.equal(inputs,1);
  target.value='My carefully edited answer';stats.recognition.result('late words');
  assert.equal(target.value,'My carefully edited answer');assert.equal(inputs,1);
  stopAudio();stats.recognition.result('after navigation');
  assert.equal(target.value,'My carefully edited answer');assert.equal(inputs,1);
});

test('Whisper preserves edits made while transcription is pending',async t=>{
  const{stats,elements,install}=browserFixture(t,async()=>({getTracks:()=>[{stop(){}}]}));
  let reply,started;const requested=new Promise(resolve=>started=resolve);
  install('fetch',async(url,options)=>{assert.equal(url,'/api/transcribe');assert.ok(options.body instanceof FormData);started();return new Promise(resolve=>reply=resolve);});
  const{button}=recordingElements(),target={isConnected:true,value:'Original draft'};let inputs=0;
  await voice(button,target,{whisperUrl:'http://local'},()=>inputs++);
  await voice(button,target,{whisperUrl:'http://local'},()=>inputs++);await requested;
  assert.equal(button.disabled,true);assert.equal(elements['#book-check'].disabled,true);
  target.value='New typed answer';reply({ok:true,json:async()=>({text:'recognized speech'})});await stats.recorder.finished;
  assert.equal(target.value,'New typed answer');assert.equal(inputs,0);
  assert.equal(elements['#audio-preview'].hidden,false);assert.equal(button.disabled,false);assert.equal(elements['#book-check'].disabled,false);
});

test('Cancelling Whisper releases controls immediately and its late result cannot interrupt a newer recording',async t=>{
  const{stats,elements,install}=browserFixture(t,async()=>({getTracks:()=>[{stop(){}}]}));
  let reply,started;const requested=new Promise(resolve=>started=resolve);
  install('fetch',async()=>{started();return new Promise(resolve=>reply=resolve);});
  const{button}=recordingElements(),target={isConnected:true,value:'Original draft'};let inputs=0;
  await voice(button,target,{whisperUrl:'http://local'},()=>inputs++);
  await voice(button,target,{whisperUrl:'http://local'},()=>inputs++);await requested;
  const previous=stats.recorder;stopAudio();assert.equal(button.disabled,false);assert.equal(elements['#book-check'].disabled,false);
  await voice(button,target,{},()=>inputs++);assert.equal(button.innerHTML,'■ Остановить запись');
  reply({ok:true,json:async()=>({text:'old recognized speech'})});await previous.finished;
  assert.equal(target.value,'Original draft');assert.equal(inputs,0);
  assert.equal(button.innerHTML,'■ Остановить запись');assert.equal(elements['#book-check'].disabled,true);
});

test('A recorder error releases the microphone and restores dictation controls',async t=>{
  let stops=0;const{stats,elements}=browserFixture(t,async()=>({getTracks:()=>[{stop(){stops++;}}]}));
  const{button}=recordingElements(),target={isConnected:true,value:'Original draft'};
  await voice(button,target,{},()=>assert.fail('failed recording changed text'));
  stats.recorder.onerror();assert.equal(stops,1);assert.equal(button.innerHTML,'Record');assert.equal(button.disabled,false);assert.equal(elements['#book-check'].disabled,false);
});

test('persistent recording receives its Blob after the preview unmounts',async t=>{
 const{stats}=browserFixture(t,async()=>({getTracks:()=>[{stop(){}}]}));const{button,preview}=recordingElements();let captured;
 await recordOnly(button,preview,(url,mime,blob)=>{captured={url,mime,blob};},{retainOnLeave:true});
 button.isConnected=false;preview.isConnected=false;stopAudio();await stats.recorder.finished;
 assert.equal(captured.url,'');assert.equal(captured.mime,'audio/webm');assert.equal(await captured.blob.text(),'audio');assert.equal(preview.hidden,true);
});

test('preview-only recording still drops a detached preview and errors never publish failed audio',async t=>{
 const{stats}=browserFixture(t,async()=>({getTracks:()=>[{stop(){}}]}));const{button,preview}=recordingElements();let calls=0;
 await recordOnly(button,preview,()=>calls++);preview.isConnected=false;stopAudio();assert.equal(calls,0);
 preview.isConnected=true;await recordOnly(button,preview,()=>calls++,{retainOnLeave:true});
 stats.recorder.onerror();stats.recorder.stop();assert.equal(calls,0);
 await recordOnly(button,preview,()=>calls++,{retainOnLeave:true});stopAudio();assert.equal(calls,1,'A fresh recorder works after the failed recorder');
});
