import {esc} from './core.js';

const contractions={"i'm":['i','am'],"you're":['you','are'],"he's":['he','is'],"she's":['she','is'],"it's":['it','is'],"we're":['we','are'],"they're":['they','are'],"don't":['do','not'],"doesn't":['does','not'],"didn't":['did','not'],"can't":['can','not'],"cannot":['can','not'],"won't":['will','not'],"isn't":['is','not'],"aren't":['are','not'],"wasn't":['was','not'],"weren't":['were','not'],"i've":['i','have'],"you've":['you','have'],"we've":['we','have'],"they've":['they','have'],"i'll":['i','will'],"you'll":['you','will'],"we'll":['we','will'],"they'll":['they','will']};
const normalize=s=>String(s||'').toLowerCase().replace(/[’‘]/g,"'");
function units(text,metadata=[]){
 const source=metadata.length?metadata:[{word:text}];
 return source.flatMap(item=>(normalize(item.word).match(/[a-z]+(?:'[a-z]+)?|\d+(?:[.:]\d+)*/g)||[]).flatMap(word=>(contractions[word]||[word]).map(part=>({word:part,probability:typeof item.probability==='number'&&Number.isFinite(item.probability)?item.probability:null,start:item.start,end:item.end}))));
}

// Word edit distance preserves omissions/insertions; contractions and their
// full forms compare equally. Scores are about the transcript, never the accent.
export function compareSpeech(expected,result){
 const a=units(expected),b=units(result.text,result.words||[]);
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
 const problems=words.filter(w=>w.status!=='matched'),hints=[];
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
const labels={matched:'Совпало',missing:'Не услышал',extra:'Лишнее слово',replaced:'Другое слово',uncertain:'Проверь произношение'};
export function speechFeedbackHTML(result,expected=''){
 if(!result?.text)return '';
 const comparison=expected?compareSpeech(expected,result):null;
 const words=comparison||units(result.text,result.words||[]).map(w=>({...w,status:w.probability!==null&&w.probability<.65?'uncertain':'matched'}));
 const counts=status=>words.filter(w=>w.status===status).length;
 const difference=counts('missing')+counts('extra')+counts('replaced');
 const summary=comparison?(difference?`Пропущено: ${counts('missing')}. Лишних: ${counts('extra')}. Заменено: ${counts('replaced')}.`:'Все слова фразы распознаны.'):'Вот что услышал Whisper.';
 const hints=speechHints(words);
 return `<section class="speech-feedback" aria-label="Разбор записи" role="status"><p>${esc(summary)}${counts('uncertain')?' Есть неуверенно распознанные слова — послушай запись и повтори их.':''}</p><div class="speech-words" lang="en">${words.map(w=>`<span class="speech-word is-${w.status}"><span>${esc(w.status==='missing'?w.expected:w.word)}</span><small lang="ru">${esc(!comparison&&w.status==='matched'?'Распознано':labels[w.status])}${w.status==='replaced'?`: ожидалось ${esc(w.expected)}`:''}${w.status!=='uncertain'&&typeof w.probability==='number'&&w.probability<.65?' · проверь произношение':''}</small></span>`).join(' ')}</div>${hints.map(h=>`<p class="small-note">${esc(h)}</p>`).join('')}<p class="small-note">${result.confidenceAvailable?'Подсветка основана на расшифровке и уверенности распознавания.':'Этот сервер не передал вероятности слов. Доступно сравнение расшифровки.'} Совпадение слов не проверяет каждый звук и интонацию.</p></section>`;
}

export function showSpeechFeedback(preview,result,expected=''){
 if(!preview?.isConnected)return;
 let panel=preview.nextElementSibling;
 if(!panel?.classList.contains('speech-feedback-host')){panel=document.createElement('div');panel.className='speech-feedback-host';preview.after(panel);}
 panel.innerHTML=speechFeedbackHTML(result,expected);
}
