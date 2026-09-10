import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedSubtitleEntries,readPreparedSubtitle} from '../prepared-subtitles.js';
import {studyUI,deferred} from './study-ui-fixture.mjs';

const raw=Array.from({length:101},(_,i)=>`${i+1}\n00:00:01,000 --> 00:00:02,000\nPractice line ${i+1}.`).join('\n\n');
const sha=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).toString('hex');
const entry={episodeId:'bcs-s01e01',filename:'bcs-s01e01.en.srt',title:'Uno',originalFilename:'Uno.en.srt',sha256:sha,cueCount:101};
const manifest=episodes=>({version:1,seriesId:'better-call-saul',season:1,language:'en',episodes});
const okManifest=()=>({ok:true,json:async()=>manifest([entry])});
const okFile=(text=raw)=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(text).buffer});
const data={state:{drafts:{}},settings:{}};

test('prepared catalog rejects unsafe paths, wrong seasons, duplicate and incomplete entries',()=>{
 assert.deepEqual(preparedSubtitleEntries(manifest([entry,entry])),[entry]);
 for(const change of [{filename:'../private.srt'},{episodeId:'bcs-s02e01'},{sha256:'missing'},{cueCount:0}])assert.deepEqual(preparedSubtitleEntries(manifest([{...entry,...change}])),[]);
 assert.deepEqual(preparedSubtitleEntries({...manifest([entry]),language:'ru'}),[]);
});

test('prepared subtitles are checked against their exact UTF-8 file hash',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 const requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,options});return url.endsWith('manifest.json')?okManifest():okFile();};
 const controller=new AbortController(),result=await readPreparedSubtitle(entry.episodeId,{signal:controller.signal});
 assert.equal(result.raw,raw);assert.equal(result.digest,sha);
 assert.deepEqual(requests.map(r=>r.url),['/cinema-subtitles/manifest.json','/cinema-subtitles/bcs-s01e01.en.srt']);
 assert.ok(requests.every(r=>r.options.signal===controller.signal&&r.options.cache==='no-store'));
 globalThis.fetch=async url=>url.endsWith('manifest.json')?okManifest():okFile(raw+'changed');
 await assert.rejects(readPreparedSubtitle(entry.episodeId),/изменился/);
 globalThis.fetch=async()=>({ok:false});
 await assert.rejects(readPreparedSubtitle(entry.episodeId),/локального файла нет/);
 await assert.rejects(readPreparedSubtitle('../private'),/Неизвестный/);
});

async function media(t){
 let load,f;t.after(()=>f?.module.unmountMedia());f=await studyUI(t,'media.js',{'subtitle-sources':{mountSubtitleSources:(_r,_d,_id,_s,onPrepared)=>load=onPrepared}});
 f.fetch=async url=>url.endsWith('manifest.json')?okManifest():okFile();
 location.hash='#/media';
 f.module.mountMedia(f.root,data);f.loadPrepared=id=>load(id);
 return f;
}

test('same episode can be reopened and retains its own saved timing offset',async t=>{
 const f=await media(t);f.local.set('subsync:'+sha,'2.5');
 await f.loadPrepared(entry.episodeId);
 assert.equal(f.root.querySelectorAll('[data-cue]').length,101);
 assert.equal(f.root.querySelector('#subtitle-offset').value,'2.5');
 assert.equal(location.hash,'#/media/bcs-s01e01');
 const input=f.root.querySelector('#subtitle-file');input.files=[{name:'My version.srt',size:100,text:async()=>raw.replaceAll('Practice','My')}];
 await input.onchange({target:input});assert.equal(f.root.querySelector('#subtitle-name').textContent,'My version.srt');
 assert.equal(location.hash,'#/media');
 await f.loadPrepared(entry.episodeId);
 assert.equal(f.root.querySelector('#subtitle-name').textContent,'Uno.en.srt');
 assert.equal(f.root.querySelector('#subtitle-offset').value,'2.5');
});

test('a slow prepared file cannot replace a newer manual import',async t=>{
 const f=await media(t),slow=deferred();f.fetch=async url=>url.endsWith('manifest.json')?slow.promise:okFile();
 const pending=f.loadPrepared(entry.episodeId),input=f.root.querySelector('#subtitle-file');
 input.files=[{name:'My newer subtitles.srt',size:100,text:async()=>raw.replaceAll('Practice','Newer')}];
 await input.onchange({target:input});slow.resolve(okManifest());await pending;
 assert.equal(f.root.querySelector('#subtitle-name').textContent,'My newer subtitles.srt');
 assert.match(f.session.get('ew-media'),/Newer line/);
});

test('a completed fetch after navigation cannot write subtitle state',async t=>{
 const f=await media(t),slow=deferred();f.fetch=async()=>slow.promise;
 const pending=f.loadPrepared(entry.episodeId);f.module.unmountMedia();f.root.innerHTML='<p>Another page</p>';
 slow.resolve({ok:false});await pending;
 assert.equal(f.session.size,0);assert.equal(f.alerts.length,0);
});
