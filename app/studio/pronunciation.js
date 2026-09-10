import {$,$$,esc,icon,api,busy,toast,uid,getDraft,localDraft,queueDraft,feedbackHTML,bindMistakes} from './core.js';
import {speak,recordOnly,stopAudio} from './audio.js';

const readKey=id=>'pronunciation:'+id;
const checklistKey=id=>readKey(id)+':checklist';
// A still-running older backend can serve the previous catalog until restart.
export const pronunciationAccent=catalog=>/широк\S* британск/i.test(catalog?.description||'')?'en-GB':'en-US';
export const pronunciationModelLabel=catalog=>pronunciationAccent(catalog)==='en-US'?'Основная IPA — американская; UK-сравнения подписаны отдельно.':'IPA этого загруженного каталога — британская.';
const latest=(state,id)=>state.attempts.filter(a=>a.lessonId==='pronunciation'&&a.exerciseId===id).at(-1);
export function savedChecklist(state,id,length){
  try{const value=JSON.parse(getDraft(checklistKey(id),state)||'[]');return new Set(Array.isArray(value)?value.filter(n=>Number.isInteger(n)&&n>=0&&n<length):[]);}catch{return new Set();}
}
export function pronunciationComplete(state,id){return !!state.read[readKey(id)];}
export function mountPronunciation(root,data,id,refresh){
  const catalog=data.pronunciation,lessons=catalog?.lessons||[];
  if(!lessons.length){root.innerHTML='<div class="empty"><h2>Курс произношения пока не загружен</h2><p>Перезапусти приложение через Start-English.cmd, чтобы загрузить новые занятия.</p></div>';return;}
  const lesson=id?lessons.find(l=>l.id===id):null;
  if(id&&!lesson){root.innerHTML='<div class="empty"><h2>Занятие не найдено</h2><a class="btn" href="#/pronunciation">Курс произношения</a></div>';return;}
  if(!lesson){mountOverview(root,data,catalog);return;}
  mountLesson(root,data,catalog,lesson,refresh);
}
function mountOverview(root,data,catalog){
  const lessons=catalog.lessons,completed=lessons.filter(l=>pronunciationComplete(data.state,l.id)).length,next=lessons.find(l=>!pronunciationComplete(data.state,l.id))||lessons[0];
  root.innerHTML=`<div class="page-head"><div><span class="eyebrow">ЗВУК → СЛОВО → ЖИВАЯ РЕЧЬ</span><h1>Читать. Слышать. Произносить.</h1><p>${esc(catalog.description)}</p></div></div>
  <section class="surface sound-intro"><div><span class="eyebrow">ОТ БУКВ К ЗВУЧАНИЮ</span><h2>Понимай, как звучит слово.</h2><p>Разбери движение языка и губ, послушай слова, прочитай фразу и сравни свою запись. Затем объясни своими словами, что изменилось.</p><a class="btn primary" href="#/pronunciation/${esc(next.id)}">${completed?'Продолжить':'Начать с основ'} ${icon('arrow')}</a></div><div class="sound-progress"><strong>${completed}<span> / ${lessons.length}</span></strong><p>практик отмечено тобой</p><div class="progress-track"><span style="width:${completed/lessons.length*100}%"></span></div><small>Отметка показывает практику, а не оценку акцента.</small></div></section>
  <div class="sound-method">${[['01','Разобраться','Звук, положение языка и частая ошибка.'],['02','Услышать','Отдельные слова и различия в парах.'],['03','Прочитать','Короткая фраза, запись и повторная попытка.'],['04','Закрепить','Самопроверка и сохранённый вывод.']].map(([n,t,p])=>`<article><span>${n}</span><h3>${t}</h3><p>${p}</p></article>`).join('')}</div>
  <div class="section-heading"><h2>Последовательный курс</h2><span class="small-note">${lessons.reduce((n,l)=>n+l.minutes,0)} минут базовой практики</span></div><div class="sound-curriculum">${lessons.map((l,i)=>`<a class="surface sound-lesson-link" href="#/pronunciation/${esc(l.id)}"><span class="sound-order">${String(i+1).padStart(2,'0')}</span><div><span class="eyebrow">${esc(l.level)} · ${l.minutes} мин</span><h3>${esc(l.title)}</h3><p>${esc(l.goal)}</p></div><span class="sound-lesson-status">${pronunciationComplete(data.state,l.id)?icon('check'):icon('arrow')}<small>${pronunciationComplete(data.state,l.id)?'Практика отмечена':latest(data.state,l.id)?'Есть разбор':''}</small></span></a>`).join('')}</div>
  <details class="surface sound-sources"><summary>Транскрипция, образцы и самостоятельная проверка</summary><p>${esc(pronunciationModelLabel(catalog))} Примеры озвучивает локальная модель Kokoro; выбранный голос показан внутри занятия. Для проверки конкретного звука доступны словарные образцы. Помощник разбирает написанное объяснение, а качество звуков и интонации ты проверяешь по записи.</p>${sourceLinks(catalog.sources)}</details>`;
}
function sourceLinks(sources){return `<div class="sound-source-links">${(sources||[]).filter(s=>/^https:\/\//.test(s.url)).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`).join('')}</div>`;}
function mountLesson(root,data,catalog,l,refresh){
  const index=catalog.lessons.indexOf(l),previous=catalog.lessons[index-1],next=catalog.lessons[index+1],key=readKey(l.id),attempt=latest(data.state,l.id),hasDraft=localDraft(key)!==null||Object.prototype.hasOwnProperty.call(data.state.drafts,key),saved=hasDraft?getDraft(key,data.state):attempt?.answer||'';
  const checked=savedChecklist(data.state,l.id,l.practice.criteria.length),texts=[];
  const soundButton=(text,label,cls='')=>{const i=texts.push(text)-1;return `<button class="btn small ${cls}" data-listen="${i}" aria-label="${esc(label)}">${icon('sound')} ${esc(text)}</button>`;};
  const pairOption=(label,audio)=>`<div><span class="ipa sound-pair-label">${esc(label)}</span>${audio?`<button class="btn small ghost" data-listen="${texts.push(audio)-1}" aria-label="${esc('Послушать: '+audio)}">${icon('sound')} Послушать</button>`:''}</div>`;
  root.innerHTML=`<div class="page-head"><div><a class="small-note" href="#/pronunciation">${icon('back')} Чтение и произношение</a><div class="eyebrow sound-chapter">ЗАНЯТИЕ ${String(index+1).padStart(2,'0')} / ${catalog.lessons.length} · ${esc(l.level)} · ${l.minutes} МИН</div><h1>${esc(l.title)}</h1><p>${esc(l.goal)}</p></div></div>
  <section class="surface sound-player-settings"><div><label for="sound-accent">Голос примеров</label><select id="sound-accent"><option value="en-US" ${pronunciationAccent(catalog)==='en-US'?'selected':''}>Американский английский</option><option value="en-GB" ${pronunciationAccent(catalog)==='en-GB'?'selected':''}>Британский английский</option></select></div><div><label for="sound-rate">Скорость</label><select id="sound-rate"><option value="0.75">Медленно</option><option value="0.9" selected>Спокойно</option><option value="1">Обычно</option></select></div><button class="btn small ghost" id="sound-stop">Остановить звук</button><p id="sound-voice-info" class="small-note" role="status"></p><audio id="sound-model" class="audio-preview" controls hidden></audio></section>
  <div class="sound-workspace"><div class="sound-theory"><section class="surface"><span class="eyebrow">КАК ЭТО УСТРОЕНО</span>${l.explanation.map(s=>`<h2>${esc(s.title)}</h2><p>${esc(s.body)}</p>`).join('')}</section>
  ${l.sounds.length?`<section class="surface"><span class="eyebrow">ЗВУКИ И ТРАНСКРИПЦИЯ</span><div class="sound-symbols">${l.sounds.map(s=>`<article class="sound-symbol"><div class="spread"><strong class="ipa">${esc(s.ipa)}</strong><h3>${esc(s.label)}</h3></div><p>${esc(s.articulation)}</p><div class="sound-words">${s.examples.map(e=>`<div>${e.audio===null?`<strong>${esc(e.word)}</strong>`:soundButton(e.audio||e.word,'Послушать '+(e.audio||e.word))}<span class="ipa">${esc(e.ipa)}</span><a class="small-note" href="https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(e.word.toLowerCase())}" target="_blank" rel="noopener noreferrer" aria-label="${esc('Словарное произношение: '+e.word)}">Словарь ↗</a></div>`).join('')}</div></article>`).join('')}</div></section>`:''}
  ${l.contrastPairs.length?`<section class="surface"><span class="eyebrow">СРАВНИ ЗВУЧАНИЕ</span><h2>Сначала услышать разницу.</h2><p class="small-note">Слова можно послушать. Схемы ударения и интонации показывают, что попробовать самому: нейросетевая озвучка не воспроизводит все обозначенные различия.</p>${l.contrastPairs.map(p=>`<div class="sound-pair"><div class="sound-pair-options">${pairOption(p.left,p.leftAudio)}${pairOption(p.right,p.rightAudio)}</div><p>${esc(p.note)}</p></div>`).join('')}</section>`:''}
  <details class="surface sound-sources"><summary>Источники и словарные образцы</summary>${sourceLinks(catalog.sources)}</details></div>
  <div class="sound-practice"><section class="surface"><span class="eyebrow">ПРОЧИТАЙ ВСЛУХ</span><h2>Послушай. Повтори. Сравни.</h2>${l.examples.map(e=>`<article class="sound-example"><p class="english">${esc(e.text)}</p><button class="btn small ghost" data-listen="${texts.push(e.text)-1}">${icon('sound')} Послушать фразу</button><p class="small-note">${esc(e.note)}</p></article>`).join('')}
  <div class="sound-recorder"><button class="btn" id="sound-record">${icon('mic')} Записать своё чтение</button><audio id="sound-recording" class="audio-preview" controls hidden></audio><a class="text-link" id="sound-download" hidden>Скачать запись ${icon('download')}</a><p class="small-note">Запись доступна до ухода со страницы. Скачай её, если хочешь сохранить звук; заметки и разбор сохраняются автоматически.</p></div></section>
  <section class="surface"><span class="eyebrow">ПРИМЕНИ И ОБЪЯСНИ</span><p class="sound-task">${esc(l.practice.prompt)}</p><label class="field-label" for="sound-answer">Твой ответ и наблюдения</label><textarea class="answer-area" id="sound-answer" rows="7" placeholder="Выполни задание и напиши, что услышал или изменил в своём чтении…">${esc(saved)}</textarea><div class="actions"><button class="btn primary" id="sound-check">Разобрать мой ответ ${icon('arrow')}</button></div><div id="sound-feedback">${attempt&&saved.trim()===attempt.answer?feedbackHTML(attempt):''}</div><p class="small-note sound-check-note">Разбор относится к тексту ответа. Распознавание слов не показывает точность звуков: сравнивай произношение самостоятельно с записью и образцом.</p><details class="sound-reference"><summary>Свериться с примером после своей попытки</summary><p>${esc(l.practice.reference)}</p></details>
  <div class="sound-checklist"><h3>Что получилось на практике</h3>${l.practice.criteria.map((c,i)=>`<label><input type="checkbox" data-criterion="${i}" ${checked.has(i)?'checked':''}><span>${esc(c)}</span></label>`).join('')}</div><button class="btn" id="sound-complete">${icon('check')} Отметить практику</button><p class="small-note" id="sound-completion" role="status">${pronunciationComplete(data.state,l.id)?'Практика отмечена. Можно вернуться и повторить.':'Отметь критерии и оставь свой ответ, чтобы зафиксировать занятие.'}</p></section></div></div>
  <div class="sound-navigation">${previous?`<a class="btn" href="#/pronunciation/${esc(previous.id)}">${icon('back')} Предыдущее</a>`:'<span></span>'}<a class="btn" href="${next?'#/pronunciation/'+esc(next.id):'#/pronunciation'}">${next?'Следующее занятие':'Весь курс'} ${icon('arrow')}</a></div>`;
  const target=$('#sound-answer',root),accent=$('#sound-accent',root),rate=$('#sound-rate',root),complete=$('#sound-complete',root);let requestID=uid(),playRequest=0;
  const voiceInfo=()=>{const info=$('#sound-voice-info',root);if(!accent.isConnected||!info?.isConnected)return;info.textContent=(accent.value==='en-GB'?'Kokoro · Emma · британский английский.':'Kokoro · американский голос из настроек.')+' '+pronunciationModelLabel(catalog);};
  voiceInfo();accent.onchange=()=>{playRequest++;stopAudio();voiceInfo();};
  $$('[data-listen]',root).forEach(b=>b.onclick=async()=>{
    const text=texts[+b.dataset.listen],request=++playRequest;
    await speak(text,+rate.value,accent.value,{player:$('#sound-model',root),status:$('#sound-voice-info',root),button:b,isCurrent:()=>root.isConnected&&b.isConnected&&request===playRequest});
  });$('#sound-stop',root).onclick=()=>{playRequest++;stopAudio();};
  $('#sound-record',root).onclick=ev=>recordOnly(ev.currentTarget,$('#sound-recording',root),(url,mime)=>{const link=$('#sound-download',root);link.href=url;link.download=l.id+(mime.includes('mp4')?'.m4a':mime.includes('ogg')?'.ogg':'.webm');link.hidden=false;});
  function updateCompletion(){complete.disabled=checked.size!==l.practice.criteria.length||target.value.trim().length<2;}
  target.oninput=()=>{queueDraft(key,target.value);requestID=uid();$('#sound-feedback',root).innerHTML='';updateCompletion();};
  $$('[data-criterion]',root).forEach(input=>input.onchange=()=>{const i=+input.dataset.criterion;if(input.checked)checked.add(i);else checked.delete(i);queueDraft(checklistKey(l.id),JSON.stringify([...checked]));updateCompletion();});
  $('#sound-check',root).onclick=ev=>busy(ev.currentTarget,async()=>{
    if(target.value.trim().length<2)throw Error('Сначала выполни задание и напиши свой ответ.');
    const submitted=target.value,submittedID=requestID;await queueDraft(key,submitted,true);const a=await api('/check',{id:submittedID,lessonId:'pronunciation',exerciseId:l.id,answer:submitted,mode:'writing'});await refresh();
    if(target.isConnected&&target.value===submitted){$('#sound-feedback',root).innerHTML=feedbackHTML(a);bindMistakes($('#sound-feedback',root));}else toast('Разбор сохранён в журнале.');
  },'Разбираем объяснение…');
  complete.onclick=async ev=>{await busy(ev.currentTarget,async()=>{
    if(checked.size!==l.practice.criteria.length||target.value.trim().length<2)throw Error('Сначала отметь критерии и оставь свой ответ.');
    const submitted=target.value,criteria=JSON.stringify([...checked]),inputs=$$('[data-criterion]',root),readOnly=target.readOnly;
    // Keep the snapshot stable until the explicit durable-write confirmation.
    // Otherwise an older confirmation can overwrite a newly queued edit.
    target.readOnly=true;inputs.forEach(input=>input.disabled=true);
    try{
      await queueDraft(key,submitted,true);await queueDraft(checklistKey(l.id),criteria,true);
      await api('/draft',{key,text:submitted});await api('/draft',{key:checklistKey(l.id),text:criteria});await api('/read',{id:key});data=await refresh();
      if(target.isConnected)$('#sound-completion',root).textContent='Практика отмечена и сохранена. Можно перейти к следующему занятию.';toast('Занятие сохранено.');
    }finally{target.readOnly=readOnly;inputs.forEach(input=>input.disabled=false);}
  });if(target.isConnected)updateCompletion();};
  target.onkeydown=ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();$('#sound-check',root).click();}};updateCompletion();bindMistakes(root);
}
