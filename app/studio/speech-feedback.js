import {esc} from './core.js';

const contractions={"i'm":['i','am'],"you're":['you','are'],"he's":['he','is'],"she's":['she','is'],"it's":['it','is'],"we're":['we','are'],"they're":['they','are'],"don't":['do','not'],"doesn't":['does','not'],"didn't":['did','not'],"can't":['can','not'],"cannot":['can','not'],"won't":['will','not'],"isn't":['is','not'],"aren't":['are','not'],"wasn't":['was','not'],"weren't":['were','not'],"i've":['i','have'],"you've":['you','have'],"we've":['we','have'],"they've":['they','have'],"i'll":['i','will'],"you'll":['you','will'],"we'll":['we','will'],"they'll":['they','will']};
const normalize=s=>String(s||'').toLowerCase().replace(/[’‘]/g,"'");
function units(text,metadata=[]){
 const source=metadata.length?metadata:[{word:text}];
 return source.flatMap(item=>(normalize(item.word).match(/[a-z]+(?:'[a-z]+)?|\d+(?:[.:]\d+)*/g)||[]).flatMap(word=>(contractions[word]||[word]).map(part=>({word:part,probability:typeof item.probability==='number'&&Number.isFinite(item.probability)?item.probability:null,start:item.start,end:item.end}))));
}

// Whisper is prompted to keep hesitation sounds (see transcription.go). They are
// counted as fluency, never compared as words or sent on as part of the answer.
const isFiller=w=>/^(?:u+m+|u+h+m*|e+r+m*|a+h+|e+h+|h+m+|m{2,}|mhm)$/.test(w);
export function stripFillers(text){
 return String(text||'').replace(/(?<![\w'-])(?:u+m+|u+h+m*|e+r+m*|a+h+|e+h+|h+m+|m{2,}|mhm)(?![\w'-])[,.…]*\s*/gi,'').replace(/\s+([,.!?])/g,'$1').replace(/^[\s,.…]+/,'').replace(/^[a-z]/,c=>c.toUpperCase()).trim();
}
const notRepeat=new Set(['that','had','very','really','so','no','bye','ha','yeah','well']);
export function fluency(result){
 const all=units(result.text,result.words||[]),spoken=all.filter(w=>!isFiller(w.word)),fillers={};
 for(const w of all)if(isFiller(w.word)){const short=w.word.replace(/(.)\1+/g,'$1'),k={hm:'hmm',m:'mm',mh:'mhm'}[short]||short;fillers[k]=(fillers[k]||0)+1;}
 const repeats=[];for(let i=1;i<spoken.length;i++)if(spoken[i].word===spoken[i-1].word&&!notRepeat.has(spoken[i].word)&&spoken[i].start!==spoken[i-1].start)repeats.push(spoken[i].word);
 const timed=all.filter(w=>typeof w.start==='number'&&typeof w.end==='number'),pauses=[];
 for(let i=1;i<timed.length;i++){const gap=timed[i].start-timed[i-1].end;if(gap>=1){const next=timed.slice(i).find(w=>!isFiller(w.word));pauses.push({seconds:gap,before:next?.word||''});}}
 const said=spoken.filter(w=>typeof w.start==='number'&&typeof w.end==='number'),duration=said.length>1?said.at(-1).end-said[0].start:0;
 return {words:spoken.length,fillers,fillerCount:Object.values(fillers).reduce((a,b)=>a+b,0),repeats,pauses,timed:timed.length>0,wpm:duration>=4?Math.round(spoken.length/duration*60):null};
}
const fillerTips=['Когда нужно подумать, вместо «эээ» скажи Well… или Let me think… Пауза та же, но звучит по-английски.','Если не вспоминается слово, опиши его: it’s the thing you use to… или it’s kind of like…','Держи наготове начало фразы: I think… / The thing is… / To be honest… Пока говоришь его, успеваешь подумать.'];
export function fluencyTips(f){
 const tips=[];
 if(f.fillerCount)tips.push(fillerTips[(f.fillerCount+f.words)%fillerTips.length]);
 if(f.pauses.length){const p=f.pauses.reduce((a,b)=>b.seconds>a.seconds?b:a);tips.push(`Самая долгая пауза — ${p.seconds.toFixed(1).replace('.',',')} с${p.before?` перед ${p.before}`:''}. Не ищи идеальное слово: скажи проще и продолжай.`);}
 if(f.repeats.length)tips.push(`Ты начинал заново (${f.repeats[0]} ${f.repeats[0]}). Начал фразу — договори её до конца, даже с ошибкой. Исправиться можно потом: I mean…`);
 if(f.wpm!==null&&f.wpm<70&&f.words>=8)tips.push(`Темп ${f.wpm} слов в минуту — медленно. Говори кусками по 3–5 слов и не останавливайся внутри куска.`);
 return tips.slice(0,2);
}
function fluencyLine(f){
 const fillers=Object.entries(f.fillers).sort((a,b)=>b[1]-a[1]).map(([w,n])=>`${w} ×${n}`).join(', ');
 const parts=[`запинок ${f.fillerCount}${fillers?` (${fillers})`:''}`];
 if(f.timed)parts.push(`пауз дольше секунды ${f.pauses.length}`);
 if(f.repeats.length)parts.push(`повторов ${f.repeats.length}`);
 if(f.wpm!==null)parts.push(`${f.wpm} слов/мин`);
 return parts.join(' · ');
}
// One stored entry per conversation turn, so re-recording a reply replaces it.
function tally(key,f){
 if(!key?.session)return null;
 const store='ew-fluency:'+key.session;let all={};
 try{all=JSON.parse(localStorage.getItem(store)||'{}')||{};}catch{}
 all[key.turn]={words:f.words,fillers:f.fillerCount,pauses:f.pauses.length};
 try{localStorage.setItem(store,JSON.stringify(all));}catch{}
 const turns=Object.values(all);return {turns:turns.length,words:turns.reduce((a,t)=>a+t.words,0),fillers:turns.reduce((a,t)=>a+t.fillers,0),pauses:turns.reduce((a,t)=>a+t.pauses,0)};
}

// Word edit distance preserves omissions/insertions; contractions and their
// full forms compare equally. Scores are about the transcript, never the accent.
export function compareSpeech(expected,result){
 const a=units(expected),b=units(result.text,result.words||[]).filter(w=>!isFiller(w.word));
 if(a.length>600||b.length>600)return null;
 const d=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
 for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1].word===b[j-1].word?0:1));
 const words=[];let i=a.length,j=b.length;
 while(i||j){
  if(i&&j&&d[i][j]===d[i-1][j-1]+(a[i-1].word===b[j-1].word?0:1)){
   const match=a[i-1].word===b[j-1].word,uncertain=b[j-1].probability!==null&&b[j-1].probability<.65;
   words.push({...b[j-1],expected:a[i-1].word,status:match?(uncertain?'uncertain':'matched'):'replaced'});i--;j--;
  }else if(i&&d[i][j]===d[i-1][j]+1){words.push({word:a[i-1].word,expected:a[i-1].word,status:'missing'});i--;}
  else{words.push({...b[j-1],status:'extra'});j--;}
 }
 return words.reverse();
}

const minimalPairs=[['ship','sheep','ship /ɪ/: короткий расслабленный звук. sheep /iː/: язык выше, звук длиннее. Послушай оба слова и повтори.'],['bed','bad','bed /ɛ/: рот раскрыт меньше. bad /æ/: опусти челюсть ниже. Разница не только в длине.'],['bag','back','В bag в конце /ɡ/, в back — /k/. Не превращай конечный звонкий согласный в глухой.'],['wine','vine','wine начинается с /w/: округли губы, зубами их не касайся. vine — с /v/: верхние зубы касаются нижней губы.'],['wet','vet','В wet округли губы для /w/. В vet коснись нижней губы верхними зубами для /v/.'],['thin','sin','В thin кончик языка слегка между зубами: выдыхай через него. Не заменяй /θ/ обычным /s/.'],['three','tree','В three начни с /θ/: язык слегка между зубами. Не заменяй этот звук на /t/.']];
export function speechHints(words){
 const problems=words.filter(w=>w.status!=='matched'&&w.status!=='filler'),hints=[];
 for(const w of problems){
  const pair=minimalPairs.find(p=>p.slice(0,2).includes(w.expected)&&p.slice(0,2).includes(w.word)&&w.expected!==w.word);
  if(pair)hints.push(pair[2]);
 }
 const affected=problems.map(w=>w.expected||w.word);
 if(affected.some(w=>/th/.test(w)))hints.push('Для th слегка высунь кончик языка между зубами. В thin воздух идёт без голоса; в this добавляется голос.');
 if(affected.some(w=>/^w/.test(w)))hints.push('Для /w/ округли губы и сразу переходи к гласному. Верхние зубы не должны касаться нижней губы.');
 if(affected.some(w=>/(?:b|d|g|v|z)$/.test(w)))hints.push('Сохрани звонкость в конце слова. Сравни bag и back: последняя согласная меняет слово.');
 if(problems.some(w=>w.expected&&w.word&&w.expected!==w.word&&w.expected===w.word+'s'))hints.push('Не теряй -s: оно может означать «несколько» или форму he/she. После глухого звука — /s/, после звонкого — /z/, после s/z/sh/ch — /ɪz/.');
 if(problems.some(w=>w.expected?.endsWith('ed')&&w.status!=='matched'))hints.push('У -ed три звучания: worked — /t/, played — /d/, wanted — /ɪd/. Дополнительный слог нужен только после /t/ и /d/.');
 return [...new Set(hints)].slice(0,2);
}
// Pronunciation by sounds (app/scripts/pronounce_server.py): the phonemes
// that were heard, aligned with the American eSpeak reference.
const soundNames={'θ':'th в think','ð':'th в this','w':'w','ɹ':'r','æ':'a в cat','ɪ':'i в ship','iː':'ee в sheep','ŋ':'ng в sing','h':'h','ʌ':'u в cup','ɑː':'o в hot','oʊ':'o в go','eɪ':'a в day','ʊ':'oo в book','uː':'oo в food','ɛ':'e в bed','v':'v','z':'z','ʒ':'s в vision','dʒ':'j в job','tʃ':'ch','ʃ':'sh'};
const voiced={z:'s',d:'t',v:'f','ɡ':'k',b:'p','ʒ':'ʃ','dʒ':'tʃ','ð':'θ'};
const soundTips=[
 [['θ'],'th в think: кончик языка между зубами и выдох без голоса. Не «с», не «т» и не «ф».'],
 [['ð'],'th в this: кончик языка между зубами и голос. Не «д» и не «з».'],
 [['w'],'w: губы трубочкой, как короткое «у», и сразу гласный. Зубы губы не касаются.'],
 [['v'],'v: верхние зубы касаются нижней губы. Губы не округляй.'],
 [['ɹ'],'American r: кончик языка чуть загнут назад и ничего не касается, не дрожит. В конце слова r тоже звучит: car, her, better.'],
 [['ɪ'],'Короткий звук, как в ship: губы расслаблены, «и» не тяни.'],
 [['iː'],'Долгий звук, как в sheep: улыбнись и потяни «ии».'],
 [['æ'],'æ в cat: опусти челюсть ниже, звук между «а» и «э». bad и bed — разные слова.'],
 [['ʌ','ə'],'u в cup: короткое расслабленное «а», рот почти не открывается.'],
 [['ɑː'],'o в hot и a в father: глубокое открытое «а», а не «о».'],
 [['ŋ'],'ng в sing: задняя часть языка прижата к нёбу, звук идёт в нос. «Г» в конце не добавляй.'],
 [['h'],'h — просто выдох, как на холодное стекло. Без хрипа, как в русском «х».'],
 [['oʊ'],'o в go — скольжение «оу»: в конце губы округляются.'],
 [['eɪ'],'a в day — скольжение «эй», а не просто «э».'],
 [['aɪ','aʊ','ɔɪ'],'Двойной звук доводи до конца: my — «май», now — «нау», boy — «бой».'],
 [['ʊ','uː'],'book — короткое расслабленное «у», food — долгое «уу» с округлёнными губами.'],
];
const ipa=p=>'/'+p+'/';
function soundIssues(score){
 const out=[];
 for(const w of score?.words||[])for(const [i,p] of (w.phones||[]).entries()){
  if(p.status==='ok')continue;
  const final=i===w.phones.length-1,devoiced=final&&voiced[p.p]===p.heard,soft=p.heard===p.p+'ʲ';
  const tip=soft?'Не смягчай согласный: в English нет мягких звуков, как в «ти» или «ви». Tea и very звучат твёрдо.':devoiced?'Звонкий звук в конце слова не оглушай: bad и bat — разные слова, dogs звучит с /z/.':p.status==='missing'?(p.p==='ɹ'?soundTips.find(t=>t[0].includes('ɹ'))[1]:`Звук ${ipa(p.p)} пропал. Скажи слово медленнее и проговори его целиком.`):(soundTips.find(t=>t[0].includes(p.p))?.[1]||`Вместо ${ipa(p.p)} прозвучал ${ipa(p.heard)}. Послушай образец и повтори медленно.`);
  const rank=soft||devoiced?4.5:soundTips.findIndex(t=>t[0].includes(p.p));
  out.push({word:w.word,phones:w.phones,index:i,phone:p,tip,key:soft?'soft':devoiced?'devoice':p.p,rank:(p.status==='close'?100:0)+(rank<0?50:rank)});
 }
 return out;
}
const soundWord=issue=>issue.phones.map((p,i)=>i===issue.index?`<mark>${esc(p.p)}</mark>`:esc(p.p)).join('');
const tallied=new WeakSet();
function soundTally(score){
 let saved={};try{saved=JSON.parse(localStorage.getItem('ew-sounds')||'{}')||{};}catch{}
 if(!tallied.has(score)&&!score.mismatch){
  tallied.add(score);
  for(const w of score.words||[])for(const p of w.phones||[]){const s=saved[p.p]||(saved[p.p]={n:0,ok:0});s.n++;if(p.status==='ok')s.ok++;}
  try{localStorage.setItem('ew-sounds',JSON.stringify(saved));}catch{}
 }
 return Object.entries(saved).filter(([p,s])=>soundNames[p]&&s.n>=8&&s.ok/s.n<.75).sort((a,b)=>a[1].ok/a[1].n-b[1].ok/b[1].n).slice(0,3);
}
function soundsHTML(score){
 if(!score?.words)return '';
 if(score.mismatch)return '<div class="speech-sounds"><p><strong>Произношение:</strong> звуки не сопоставились с фразой. Возможно, сказана другая фраза или запись слишком тихая.</p></div>';
 const seen=new Set(),shown=soundIssues(score).sort((a,b)=>a.rank-b.rank).filter(x=>!seen.has(x.word+x.phone.p)&&seen.add(x.word+x.phone.p)).slice(0,4);
 const tips=[...new Map(shown.map(x=>[x.key,x.tip])).values()].slice(0,2),weak=soundTally(score);
 return `<div class="speech-sounds"><p><strong>Произношение: ${Math.round(score.score*100)}%</strong> · ${score.correct} из ${score.total} звуков как в американском эталоне</p>${shown.length?`<ul class="sound-issues">${shown.map(x=>`<li><span lang="en">${esc(x.word)}</span> <span class="sound-ipa">/${soundWord(x)}/</span> ${x.phone.status==='missing'?'— звук пропал':`— прозвучало ${esc(ipa(x.phone.heard))}`}</li>`).join('')}</ul>`:'<p class="small-note">Все звуки на месте.</p>'}${tips.map(t=>`<p class="small-note">${esc(t)}</p>`).join('')}${weak.length?`<p class="small-note">Чаще всего сбиваются: ${weak.map(([p,s])=>`${esc(soundNames[p])} ${esc(ipa(p))} — верно ${s.ok} из ${s.n}`).join(', ')}.</p>`:''}</div>`;
}
const labels={matched:'Совпало',missing:'Не услышал',extra:'Лишнее слово',replaced:'Другое слово',uncertain:'Проверь произношение',filler:'Запинка'};
export function speechFeedbackHTML(result,expected='',fluencyKey=null){
 if(!result?.text)return '';
 const comparison=expected?compareSpeech(expected,result):null;
 const words=comparison||units(result.text,result.words||[]).map(w=>({...w,status:isFiller(w.word)?'filler':w.probability!==null&&w.probability<.65?'uncertain':'matched'}));
 const flow=fluency(result),total=tally(fluencyKey,flow),flowTips=fluencyTips(flow);
 const flowHTML=`<div class="speech-fluency"><p><strong>Беглость:</strong> ${esc(fluencyLine(flow))}</p>${flowTips.length?flowTips.map(t=>`<p class="small-note">${esc(t)}</p>`).join(''):'<p class="small-note">Без запинок и долгих пауз.</p>'}${total&&total.turns>1?`<p class="small-note">За разговор: ${total.fillers} запинок и ${total.pauses} долгих пауз на ${total.words} слов в ${total.turns} репликах.</p>`:''}</div>`;
 const counts=status=>words.filter(w=>w.status===status).length;
 const difference=counts('missing')+counts('extra')+counts('replaced');
 const summary=comparison?(difference?`Пропущено: ${counts('missing')}. Лишних: ${counts('extra')}. Заменено: ${counts('replaced')}.`:'Все слова фразы распознаны.'):'Вот что услышал Whisper.';
 const hints=speechHints(words);
 return `<section class="speech-feedback" aria-label="Разбор записи" role="status"><p>${esc(summary)}${counts('uncertain')?' Есть неуверенно распознанные слова — послушай запись и повтори их.':''}</p><div class="speech-words" lang="en">${words.map(w=>`<span class="speech-word is-${w.status}"><span>${esc(w.status==='missing'?w.expected:w.word)}</span><small lang="ru">${esc(!comparison&&w.status==='matched'?'Распознано':labels[w.status])}${w.status==='replaced'?`: ожидалось ${esc(w.expected)}`:''}${w.status!=='uncertain'&&w.status!=='filler'&&typeof w.probability==='number'&&w.probability<.65?' · проверь произношение':''}</small></span>`).join(' ')}</div>${soundsHTML(result.pronunciation)}${flowHTML}${result.pronunciation?'':hints.map(h=>`<p class="small-note">${esc(h)}</p>`).join('')}<p class="small-note">${result.pronunciation?'Звуки сверены с американским эталоном по самой записи, а не по расшифровке. Интонация пока не оценивается.':(result.confidenceAvailable?'Подсветка основана на расшифровке и уверенности распознавания.':'Этот сервер не передал вероятности слов. Доступно сравнение расшифровки.')+' Совпадение слов не проверяет каждый звук и интонацию.'}</p></section>`;
}

export function showSpeechFeedback(preview,result,expected='',fluencyKey=null){
 if(!preview?.isConnected)return;
 let panel=preview.nextElementSibling;
 if(!panel?.classList.contains('speech-feedback-host')){panel=document.createElement('div');panel.className='speech-feedback-host';preview.after(panel);}
 panel.innerHTML=speechFeedbackHTML(result,expected,fluencyKey);
}
