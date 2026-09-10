import {$,$$,esc,icon,getDraft,queueDraft,toast,openModal} from './core.js';
import {beginAudio,speechVoice,speak,stopAudio} from './audio.js';

function voiceLabel(name,culture){
 const variety={'en-US':'американский английский','en-GB':'британский английский'}[culture]||culture;
 return ['Учебное озвучивание',name||'локальный голос',variety,'синтез речи'].filter(Boolean).join(' · ');
}

export function exerciseMaterials(lesson,exercise){
 const materials=Array.isArray(lesson.materials)?lesson.materials:[];
 return materials.filter(m=>Array.isArray(exercise.materialIds)&&exercise.materialIds.includes(m.id));
}
export function materialFigureHTML(figure,kind){
 if(!figure||!['reading','reference'].includes(kind)||!['svg','png'].includes(figure.format??'svg')||typeof figure.id!=='string'||!/^[-A-Za-z0-9_]{1,80}$/.test(figure.id)||typeof figure.alt!=='string'||!figure.alt.trim()||typeof figure.caption!=='string'||!figure.caption.trim())return '';
 const src='/assets/learning-figures/'+figure.id+'.'+(figure.format??'svg');
 return `<figure class="material-figure"><a class="text-link" data-material-figure="${figure.id}" href="${src}" target="_blank" rel="noopener noreferrer">Открыть ${figure.format==='png'?'изображение':'график'} крупнее ${icon('arrow')}</a><div class="material-figure-scroll"><img src="${src}" alt="${esc(figure.alt)}" loading="lazy"></div><figcaption>${esc(figure.caption)}</figcaption></figure>`;
}
export function materialTextHTML(text){
 return text.split(/\n\s*\n/).filter(Boolean).map(paragraph=>{
  const lines=paragraph.split('\n'),header=lines.findIndex(line=>line.startsWith('Complete table. Column order: '));
  if(header===0){
   const columns=lines[0].slice('Complete table. Column order: '.length).replace(/\.$/,'').split(';').map(c=>c.trim());
   const rows=lines.slice(1).filter(Boolean).map(line=>line.replace(/\.$/,'').split(';').map(c=>c.trim()));
   if(columns.length>1&&columns.length<=12&&rows.length&&rows.every(row=>row.length===columns.length)){
    return `<div class="material-table-scroll" tabindex="0" role="region" aria-label="Complete data table"><table class="material-table"><caption>Complete data table</caption><thead><tr>${columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${esc(row[0])}</th>${row.slice(1).map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
   }
  }
  return `<p>${esc(paragraph)}</p>`;
 }).join('');
}
export function materialHTML(material,index,state,lessonId){
 const playable=material.kind!=='reference',listening=material.kind==='listening'||material.kind==='dialogue',picture=material.figure?.format==='png'&&Boolean(materialFigureHTML(material.figure,material.kind)),textHidden=listening||picture,key=`material:notes:${lessonId}:${material.id}`;
 return `<article class="lesson-material" data-material="${esc(material.id)}"><header><div><span class="eyebrow">${picture?'ИЗОБРАЖЕНИЕ ДЛЯ ОПИСАНИЯ':listening?'СЛУШАНИЕ И РАЗГОВОР':'МАТЕРИАЛ ДЛЯ ЧТЕНИЯ'}</span><h2><span class="material-id">${esc(material.id.toUpperCase())}</span>${esc(material.title)}</h2></div><span class="small-note">${material.text.trim().split(/\s+/).length} слов</span></header><p class="material-source">${esc(material.source||'Авторский учебный материал')}</p>${materialFigureHTML(material.figure,material.kind)}<div class="material-controls">${playable?`<button class="btn small" data-material-play="${index}">${icon('sound')} Прослушать</button><button class="btn small ghost" data-material-stop>${icon('pause')} Остановить</button><label>Темп<select data-material-rate="${index}" aria-label="Темп озвучивания материала ${index+1}"><option value=".8">0.8×</option><option value="1" selected>1×</option><option value="1.1">1.1×</option></select></label>`:''}<button class="btn small" data-material-toggle="${index}" aria-expanded="${!textHidden}">${picture?'Открыть текстовое описание':listening?'Открыть расшифровку':'Скрыть текст'}</button></div>${playable?`<audio data-material-audio="${index}" controls hidden></audio><p class="material-audio-note" data-material-status="${index}">Учебное озвучивание синтезом речи. Живые голоса можно отрабатывать в медиатеке и киноклубе.</p>`:''}<div class="material-text" data-material-text="${index}" ${textHidden?'hidden':''}>${materialTextHTML(material.text)}</div>${listening?`<details class="material-notes"><summary>Мои заметки до открытия расшифровки</summary><label class="field-label" for="material-notes-${index}">Что удалось понять и где остались сомнения</label><textarea id="material-notes-${index}" data-material-notes="${index}" rows="4" placeholder="Главная мысль, услышанные детали, неуверенные места…">${esc(getDraft(key,state))}</textarea><p class="small-note">Черновик сохраняется отдельно от ответа на задание.</p></details>`:''}</article>`;
}
export function mountLessonMaterials(root,lesson,exercise,state){
 const materials=exerciseMaterials(lesson,exercise);if(!materials.length){root.hidden=true;return;}
 root.hidden=false;root.innerHTML=materials.map((m,i)=>materialHTML(m,i,state,lesson.id)).join('');
 $$('[data-material-figure]',root).forEach(link=>link.onclick=event=>{
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const figure=materials.find(m=>m.figure?.id===link.dataset.materialFigure)?.figure;if(!figure)return;
  event.preventDefault();
  openModal(figure.format==='png'?'Изображение крупнее':'График крупнее',`<div class="material-figure-large"><img src="/assets/learning-figures/${figure.id}.${figure.format??'svg'}" alt="${esc(figure.alt)}"></div><p class="small-note">${esc(figure.caption)}</p>`);
 });
 $$('[data-material-toggle]',root).forEach(button=>button.onclick=()=>{const text=$(`[data-material-text="${button.dataset.materialToggle}"]`,root),m=materials[+button.dataset.materialToggle];text.hidden=!text.hidden;button.textContent=text.hidden?(m.figure?.format==='png'?'Открыть текстовое описание':['reading','reference'].includes(m.kind)?'Открыть текст':'Открыть расшифровку'):'Скрыть текст';button.setAttribute('aria-expanded',String(!text.hidden));});
 $$('[data-material-notes]',root).forEach(input=>input.oninput=()=>queueDraft(`material:notes:${lesson.id}:${materials[+input.dataset.materialNotes].id}`,input.value));
 $$('[data-material-stop]',root).forEach(button=>button.onclick=stopAudio);
 $$('[data-material-play]',root).forEach(button=>button.onclick=async()=>{
  const index=+button.dataset.materialPlay,m=materials[index],player=$(`[data-material-audio="${index}"]`,root),rate=+$(`[data-material-rate="${index}"]`,root).value;
  const current=beginAudio();button.disabled=true;
  try{
   const response=await fetch('/lesson-audio/'+encodeURIComponent(lesson.id)+'.json').catch(()=>null);
   if(!current()||!root.isConnected||!button.isConnected)return;
   if(!response?.ok){
    const voice=speechVoice();
    if(voice){$(`[data-material-status="${index}"]`,root).textContent=voiceLabel(voice.name,voice.lang);speak(m.text,rate);return;}
    throw Error('Аудио этого материала ещё не подготовлено. Можно открыть текст или использовать браузер с английским голосом.');
   }
   const manifest=await response.json(),clip=manifest.materials?.[m.id];
   const textHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(m.text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
   if(!clip||typeof clip.file!=='string'||!/^[a-f0-9]{64}\.wav$/.test(clip.file)||clip.textSHA256!==textHash)throw Error('Готовая запись этой версии материала не найдена.');
   if(!current()||!root.isConnected||!button.isConnected)return;
   player.src='/lesson-audio/'+clip.file;player.playbackRate=rate;player.hidden=false;
   $(`[data-material-status="${index}"]`,root).textContent=voiceLabel(manifest.voice,manifest.culture);
   await player.play();if(!current())player.pause();
  }catch(error){if(current()&&root.isConnected)toast(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
 });
}
