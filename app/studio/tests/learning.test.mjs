import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitles,subtitleOffset,cueAtTime} from '../media.js';
import {progressLesson,esc,mediaURL,clipUTF8} from '../core.js';
test('SRT parses BOM, multiline cues, ordering and rejects invalid duration',()=>{
 const cues=parseSubtitles('\uFEFF2\r\n00:01:02,500 --> 00:01:04,200\r\nSecond <i>line</i>\r\ncontinued\r\n\r\n1\r\n00:00:01,000 --> 00:00:02,000\r\nFirst\r\n\r\n3\r\n00:00:04,000 --> 00:00:03,000\r\nInvalid');
 assert.equal(cues.length,2);assert.deepEqual(cues[1],{start:62.5,end:64.2,text:'Second line continued'});assert.equal(cues[0].text,'First');
});
test('VTT supports identifiers, settings and ignores NOTE blocks',()=>{
 const cues=parseSubtitles('WEBVTT\n\nNOTE a note\n00:00:00.000 --> 00:00:03.000\nDo not include\n\ncue-1\n00:02.100 --> 00:04.500 align:start position:10%\nHello &amp; goodbye.');
 assert.deepEqual(cues,[{start:2.1,end:4.5,text:'Hello & goodbye.'}]);
});
test('subtitle synchronisation shifts playback boundaries without mutating source cues',()=>{
 const cues=[{start:2,end:4,text:'One'},{start:6,end:8,text:'Two'}],original=structuredClone(cues);
 assert.equal(cueAtTime(cues,3,2),-1);assert.equal(cueAtTime(cues,4,2),0);assert.equal(cueAtTime(cues,6,2),-1);
 assert.equal(cueAtTime(cues,1,-2),0);assert.equal(cueAtTime(cues,5,-2),1);assert.equal(cueAtTime(cues,6,-2),-1);
 assert.deepEqual(cues,original);assert.equal(subtitleOffset('1.25'),1.25);assert.equal(subtitleOffset(NaN),0);assert.equal(subtitleOffset(99999),3600);assert.equal(subtitleOffset(-99999),-3600);
});
test('repeating one answer never completes a lesson; latest errors matter',()=>{
 const lesson={id:'test',exercises:[{id:'e1'},{id:'e2'}]},a={lessonId:'test',exerciseId:'e1',feedback:{verdict:'correct'}};
 const state={read:{},attempts:[a,a,a]};assert.equal(progressLesson(lesson,state).done,false);assert.equal(progressLesson(lesson,state).tried,1);
 state.attempts.push({...a,exerciseId:'e2'});assert.equal(progressLesson(lesson,state).done,true);
 state.attempts.push({...a,exerciseId:'e2',feedback:{verdict:'incorrect'}});assert.equal(progressLesson(lesson,state).done,false);
});
test('user and model content is escaped and media paths stay local',()=>{
 assert.equal(esc('<img src="x" onerror="bad">'),'&lt;img src=&quot;x&quot; onerror=&quot;bad&quot;&gt;');
 assert.equal(mediaURL('../../settings.json'),'');assert.equal(mediaURL('a'.repeat(64)+'.png'),'/media/'+'a'.repeat(64)+'.png');
});
test('Russian and emoji context fits the API byte limit without broken characters',()=>{
 const text='Объясни 🙂 '.repeat(3000),clipped=clipUTF8(text,16000);
 assert.ok(new TextEncoder().encode(clipped).length<=16000);
 assert.ok(text.startsWith(clipped));assert.ok(!clipped.includes('\uFFFD'));
 assert.equal(clipUTF8('a🙂b',4),'a');
});
