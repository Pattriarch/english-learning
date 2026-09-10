import {$,$$,esc,icon,api,toast,busy,uid,mediaURL,openModal,getDraft,queueDraft} from './core.js';
import {speak} from './audio.js';
import {mountSubtitleSources} from './subtitle-sources.js';
import {readPreparedSubtitle} from './prepared-subtitles.js';
let cleanup=()=>{};
export function unmountMedia(){cleanup();cleanup=()=>{};}
function seconds(t){const p=t.replace(',','.').split(':').map(Number);return p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+p[1];}
export function parseSubtitles(raw){
 const blocks=raw.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/),cues=[];
 for(const block of blocks){const lines=block.trim().split('\n'),at=lines.findIndex(l=>/\d:\d{2}.*-->/.test(l));if(at<0||/^(NOTE|STYLE|REGION)\b/.test(lines[0]))continue;
  const m=lines[at].match(/((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})/);if(!m)continue;
  const start=seconds(m[1]),end=seconds(m[2]),text=lines.slice(at+1).join(' ').replace(/<[^>]*>/g,'').replace(/\{\\[^}]*\}/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
  if(Number.isFinite(start)&&end>start&&text)cues.push({start,end,text});
 }return cues.sort((a,b)=>a.start-b.start);
}
const timestamp=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;
export function subtitleOffset(value){const n=Number(value);return Number.isFinite(n)?Math.max(-3600,Math.min(3600,n)):0;}
export function cueAtTime(cues,time,offset=0){return cues.findIndex(c=>time>=c.start+offset&&time<c.end+offset);}
export function restoreMediaAttachment(raw,phrase){
 try{const saved=JSON.parse(raw);if(!saved||saved.phrase!==phrase)return {image:'',source:''};return {image:mediaURL(saved.image)?saved.image:'',source:typeof saved.source==='string'?saved.source:''};}catch{return {image:'',source:''};}
}
export async function cropImage(blob,isCurrent,signal){
 const url=URL.createObjectURL(blob),img=new Image();img.src=url;try{await img.decode();}finally{URL.revokeObjectURL(url);}
 if(signal.aborted||!isCurrent())return null;
 const d=openModal('Выдели область субтитров',`<p class="small-note">Потяни рамку по тексту. В карточке сохранится весь кадр, а распознается выделенная область.</p><canvas id="crop" class="crop-canvas"></canvas><div class="actions" style="margin-top:18px"><button class="btn primary" id="crop-apply">Распознать выделение</button><button class="btn" id="crop-all">Весь кадр</button><button class="btn ghost" id="crop-cancel">Отмена</button></div>`);
 const canvas=$('#crop'),scale=Math.min(1,1600/img.width);canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');let box={x:0,y:canvas.height*.7,w:canvas.width,h:canvas.height*.3},origin;
 function paint(){ctx.drawImage(img,0,0,canvas.width,canvas.height);ctx.fillStyle='#0b143359';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();ctx.drawImage(img,0,0,canvas.width,canvas.height);ctx.restore();ctx.strokeStyle='#adc0ff';ctx.lineWidth=3;ctx.strokeRect(box.x,box.y,box.w,box.h);}
 const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.min(canvas.width,Math.max(0,(e.clientX-r.left)*canvas.width/r.width)),y:Math.min(canvas.height,Math.max(0,(e.clientY-r.top)*canvas.height/r.height))};};
 canvas.onpointerdown=e=>{origin=point(e);canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!origin)return;const p=point(e);box={x:Math.min(p.x,origin.x),y:Math.min(p.y,origin.y),w:Math.abs(p.x-origin.x),h:Math.abs(p.y-origin.y)};paint();};canvas.onpointerup=()=>origin=null;paint();
 return await new Promise(resolve=>{
  let done=false;const onClose=()=>finish(null),onAbort=()=>finish(null),finish=v=>{if(done)return;done=true;signal.removeEventListener('abort',onAbort);d.removeEventListener('close',onClose);if(canvas.isConnected&&$('#crop',d)===canvas)d.close();resolve(v);};
  $('#crop-cancel').onclick=()=>finish(null);d.addEventListener('close',onClose,{once:true});signal.addEventListener('abort',onAbort,{once:true});
  $('#crop-all').onclick=()=>finish(blob);
  $('#crop-apply').onclick=()=>{if(box.w<10||box.h<10){toast('Выдели область побольше.');return;}const out=document.createElement('canvas');out.width=Math.round(box.w);out.height=Math.round(box.h);out.getContext('2d').drawImage(img,box.x/scale,box.y/scale,box.w/scale,box.h/scale,0,0,out.width,out.height);out.toBlob(finish,'image/png');};
 });
}
export function mountMedia(root,data,episodeID=''){
 const lifecycle=new AbortController();
 let cues=[],selected=-1,activeIndex=-1,objectURL='',screenStream=null,sourceName='',loop=false,autoPause=false,image='',currentSource='',cardID=uid(),offset=0,profileKey='',revision=0,disposed=false,capturePending=false,imagePending=false;
 let subtitleRequest=0,subtitlesLoading=false;
 try{const saved=episodeID?null:JSON.parse(sessionStorage.getItem('ew-media')||'null');if(saved){cues=saved.cues||[];sourceName=saved.sourceName||'';profileKey=saved.profileKey||'';offset=subtitleOffset(saved.offset);if(profileKey){const stored=getDraft(profileKey,data.state);if(stored!=='')offset=subtitleOffset(stored);}}}catch{}
 root.innerHTML=`<div class="page-head"><div><h1>Смотри. Замечай. Используй.</h1><p>Фразы из реального контекста остаются с тобой.</p></div><div class="actions"><button class="btn small" id="mini-window">${icon('screen')} Окно захвата</button><a class="btn" href="#/review">${icon('cards')} Мой словарь</a></div></div>
 <div class="media-layout"><div>
 <div class="video-shell"><div class="video-empty" id="video-empty">${icon('play')}<h3>Что посмотрим сегодня?</h3><p>Открой видео с компьютера или захвати вкладку с фильмом. Добавь SRT/VTT, чтобы выбирать и повторять реплики.</p><button class="btn light" id="choose-video">${icon('plus')} Открыть видео</button></div><video id="video" controls playsinline hidden></video></div>
 <input type="file" id="video-file" accept="video/*,audio/*" hidden><input type="file" id="subtitle-file" accept=".srt,.vtt,text/vtt" hidden><input type="file" id="image-file" accept="image/png,image/jpeg" hidden>
 <div class="video-toolbar"><button class="btn small" id="load-video">${icon('play')} Видео</button><button class="btn small" id="load-subs">${icon('upload')} Субтитры</button><button class="btn small" id="share-screen">${icon('screen')} Захват вкладки</button><button class="btn small" id="capture">${icon('image')} Сохранить кадр</button></div>
 <div id="media-subtitle-sources"></div>
 <details class="surface" style="padding:18px;margin:15px 0"><summary>Синхронизация субтитров</summary><div class="subtitle-sync"><label for="subtitle-offset">Сдвиг, секунды</label><input id="subtitle-offset" type="number" step="0.1" min="-3600" max="3600" value="${offset}"><button class="btn small" id="subs-earlier">−0,5 с</button><button class="btn small" id="subs-later">+0,5 с</button><button class="btn small ghost" id="subs-reset">Сбросить</button></div><button class="btn small" id="subs-align">Совместить выбранную реплику с текущим кадром</button><p class="small-note">Плюс — реплика появляется позже, минус — раньше. Для совмещения выбери реплику, затем поставь видео на паузу в момент её начала. Настройка сохраняется для этого файла субтитров. Если рассинхрон растёт к концу серии, нужна дорожка для другой версии видео.</p></details>
 <section class="card subtitle-card"><div class="subtitle-source"><span id="subtitle-name">${esc(sourceName||'Реплики из субтитров')}</span><button class="btn small ghost" id="hide-subs">Скрыть текст</button></div><div class="subtitles" id="subtitles"></div></section>
 <div class="actions" style="margin:15px 0"><button class="btn small" id="loop">${icon('loop')} Повтор реплики: выкл.</button><button class="btn small" id="auto-pause">${icon('pause')} Пауза после фразы: выкл.</button><button class="btn small" id="replay">${icon('play')} Ещё раз</button></div>
 <p class="small-note">Видео остаётся на компьютере. SRT/VTT синхронизируются по времени плеера. Без видео повтор реплики использует синтез речи, а не голос актёра. При захвате внешней вкладки управление воспроизведением остаётся в той вкладке.</p>
 <details class="card" style="margin-top:22px"><summary style="cursor:pointer;font-size:.9rem">Упражнение после просмотра</summary><p class="small-note" style="margin-top:15px">Посмотри 1–2 минуты без текста. Скажи главную мысль, запиши три детали и перескажи своими словами. Затем проверь себя по субтитрам.</p><button class="btn small" id="retell">${icon('pen')} Пересказать фрагмент</button></details>
 </div><div class="stack"><section class="card"><div class="spread" style="margin-bottom:20px"><h2 style="font-size:1.16rem;margin:0">Пойманная фраза</h2><span class="pill orange">RU → EN</span></div><div id="image-preview"></div>
 <div class="field"><label for="phrase">Английская реплика</label><textarea id="phrase" rows="3" placeholder="Выбери реплику слева, вставь фразу или скриншот через Ctrl + V.">${esc(getDraft('media:phrase',data.state))}</textarea></div>
 <div class="actions" style="margin-bottom:20px"><button class="btn small" id="translate">${icon('spark')} Перевести и объяснить</button><button class="btn small ghost" id="say-phrase" aria-label="Прослушать фразу">${icon('sound')}</button></div>
 <div class="field"><label for="translation">Русский смысл — лицевая сторона</label><textarea id="translation" rows="3" placeholder="Как бы ты передал эту мысль по-русски?">${esc(getDraft('media:translation',data.state))}</textarea></div>
 <div class="field"><label for="phrase-note">Объяснение, пример или ассоциация</label><textarea id="phrase-note" rows="3" placeholder="Что здесь полезного? В какой ситуации скажешь так сам?">${esc(getDraft('media:note',data.state))}</textarea></div>
 <button class="btn primary full" id="save-card">${icon('plus')} Сохранить карточку</button></section>
 <section class="card"><h3>Скриншот → карточка</h3><div class="upload-area">${icon('image')}<p style="margin:10px 0 0">Сделай скриншот субтитров<br><strong>Win + Shift + S → Ctrl + V сюда</strong></p><button class="btn small" id="load-image">Или выбрать PNG / JPG</button></div><p class="small-note" style="margin:14px 0 0">Выдели текст на кадре. OCR распознаёт английский локально; перевод можно получить у помощника или написать самостоятельно.</p></section></div></div>`;
 const video=$('#video'),phrase=$('#phrase'),translation=$('#translation'),note=$('#phrase-note');
 const isCurrent=version=>!disposed&&root.isConnected&&$('#phrase',root)===phrase&&revision===version;
 const attachment=restoreMediaAttachment(getDraft('media:attachment',data.state),phrase.value);image=attachment.image;currentSource=attachment.source;
 function persistAttachment(){queueDraft('media:attachment',JSON.stringify({phrase:phrase.value,image,source:currentSource}));}
 mountSubtitleSources($('#media-subtitle-sources'),data,episodeID,true,loadPrepared);
 async function loadPrepared(id){
  const request=++subtitleRequest;subtitlesLoading=true;renderSubs();
  try{const {entry,raw}=await readPreparedSubtitle(id,{signal:lifecycle.signal});if(await applySubtitles(raw,entry.originalFilename,request,entry.cueCount)&&location.hash.startsWith('#/media'))window.history.replaceState(null,'','#/media/'+id);}
  catch(e){if(!disposed&&request===subtitleRequest)toast(e.message,true);}
  finally{if(!disposed&&root.isConnected&&request===subtitleRequest){subtitlesLoading=false;renderSubs();}}
 }
 async function applySubtitles(raw,name,request,expectedCount){
  const parsed=parseSubtitles(raw);if(!parsed.length)throw Error('В файле не найдены SRT/VTT реплики. Проверь формат и кодировку UTF-8.');
  if(expectedCount!==undefined&&parsed.length!==expectedCount)throw Error('Не удалось прочитать весь подготовленный файл субтитров.');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  if(disposed||!root.isConnected||request!==subtitleRequest)return false;
  profileKey='subsync:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');offset=subtitleOffset(getDraft(profileKey,data.state));
  cues=parsed;selected=-1;activeIndex=-1;sourceName=name;$('#subtitle-offset').value=String(offset);persistSubs();renderSubs();toast('Загружено реплик: '+cues.length);return true;
 }
 function persistSubs(){try{sessionStorage.setItem('ew-media',JSON.stringify({cues,sourceName,offset,profileKey}));}catch{toast('Субтитры открыты, но не поместились в память вкладки. После её закрытия файл нужно будет выбрать снова.',true);}}
 function setOffset(value,writeField=true){offset=subtitleOffset(value);if(writeField)$('#subtitle-offset').value=String(Math.round(offset*1000)/1000);activeIndex=-1;if(profileKey)queueDraft(profileKey,String(offset));persistSubs();renderSubs();if(selected>=0){currentSource=sourceName+' · '+timestamp(Math.max(0,cues[selected].start+offset));persistAttachment();}}
 $('#subtitle-offset').oninput=ev=>{if(ev.target.value!==''&&Number.isFinite(Number(ev.target.value)))setOffset(ev.target.value,false);};
 $('#subtitle-offset').onchange=ev=>setOffset(ev.target.value);$('#subs-earlier').onclick=()=>setOffset(offset-.5);$('#subs-later').onclick=()=>setOffset(offset+.5);$('#subs-reset').onclick=()=>setOffset(0);
 $('#subs-align').onclick=()=>{if(selected<0||!video.src||screenStream||video.readyState<1){toast('Сначала открой локальное видео и выбери реплику.',true);return;}setOffset(video.currentTime-cues[selected].start);toast('Начало реплики совмещено с кадром.');};
 $('#mini-window').onclick=()=>{if(!window.open(location.origin+'/#/capture','EnglishCapture','width=480,height=780'))toast('Разреши всплывающее окно, чтобы открыть компактный захват.',true);};
 phrase.oninput=()=>{revision++;cardID=uid();queueDraft('media:phrase',phrase.value);persistAttachment();};translation.oninput=()=>{revision++;cardID=uid();queueDraft('media:translation',translation.value);};note.oninput=()=>{revision++;cardID=uid();queueDraft('media:note',note.value);};
 function renderSubs(){
  $('#subtitle-name').textContent=sourceName||'Реплики из субтитров';
  if(subtitlesLoading){$('#subtitles').innerHTML='<p class="empty" role="status">Загружаю английские субтитры…</p>';return;}
  $('#subtitles').innerHTML=cues.length?cues.map((c,i)=>`<button class="subtitle-row ${i===selected?'active':''}" data-cue="${i}"><time>${timestamp(Math.max(0,c.start+offset))}</time><span>${esc(c.text)}</span></button>`).join(''):`<div class="empty" style="border:0;border-radius:0;padding:32px"><h3>Добавь файл субтитров</h3><p>SRT или VTT из твоего видео. Реплики появятся здесь с таймкодами.</p><button class="btn small" id="demo-subs">Попробовать на учебном фрагменте</button></div>`;
  $$('[data-cue]').forEach(b=>b.onclick=()=>select(+b.dataset.cue,true));
  if($('#demo-subs'))$('#demo-subs').onclick=()=>{subtitleRequest++;cues=parseSubtitles('1\n00:00:00,000 --> 00:00:04,000\nI used to think I needed more free time.\n\n2\n00:00:04,200 --> 00:00:09,000\nBut I have been trying something different this week.\n\n3\n00:00:09,200 --> 00:00:14,000\nIt turns out that small changes can make a big difference.');sourceName='Учебный текст · без видео';offset=0;profileKey='';activeIndex=-1;selected=-1;$('#subtitle-offset').value='0';persistSubs();renderSubs();select(0,false);};
 }
 function select(i,seek=false){
  if(!cues[i])return;selected=i;image='';showImage();currentSource=sourceName+' · '+timestamp(Math.max(0,cues[i].start+offset));phrase.value=cues[i].text;phrase.oninput();translation.value='';note.value='';translation.oninput();note.oninput();
  $$('[data-cue]').forEach(b=>b.classList.toggle('active',+b.dataset.cue===i));
  if(seek&&video.src&&!screenStream){activeIndex=-1;video.currentTime=Math.max(0,cues[i].start+offset);video.play().catch(()=>{});}
 }
 function stopScreen(){screenStream?.getTracks().forEach(t=>t.stop());screenStream=null;video.srcObject=null;const b=$('#share-screen');if(b)b.innerHTML=icon('screen')+' Захват вкладки';}
 $('#choose-video').onclick=$('#load-video').onclick=()=>$('#video-file').click();
 $('#video-file').onchange=ev=>{const f=ev.target.files[0];if(!f)return;stopScreen();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=URL.createObjectURL(f);video.src=objectURL;video.hidden=false;$('#video-empty').hidden=true;video.muted=false;video.controls=true;sourceName=f.name;$('#subtitle-name').textContent=sourceName;video.onerror=()=>toast('Браузер не поддерживает кодек этого видео. Попробуй MP4 (H.264) или WebM.',true);};
 $('#load-subs').onclick=()=>$('#subtitle-file').click();
 $('#subtitle-file').onchange=async ev=>{const input=ev.target,f=input.files[0];if(!f)return;const request=++subtitleRequest;subtitlesLoading=true;renderSubs();try{if(f.size>5*1024*1024)throw Error('Субтитры должны быть меньше 5 МБ.');const raw=await f.text();if(await applySubtitles(raw,f.name,request)&&location.hash.startsWith('#/media'))window.history.replaceState(null,'','#/media');}catch(e){if(!disposed&&request===subtitleRequest)toast(e.message,true);}finally{if(!disposed&&input.isConnected&&request===subtitleRequest){input.value='';subtitlesLoading=false;renderSubs();}}};
 video.onseeking=()=>{activeIndex=-1;};
 video.ontimeupdate=()=>{
  if(screenStream){activeIndex=-1;return;}
  if(video.seeking){activeIndex=-1;return;}
  const t=video.currentTime,i=cueAtTime(cues,t,offset);
  if(loop&&selected>=0&&t>=cues[selected].end+offset&&cues[selected].end+offset>0){video.currentTime=Math.max(0,cues[selected].start+offset);return;}
  if(autoPause&&activeIndex>=0&&t>=cues[activeIndex].end+offset){video.pause();activeIndex=-1;return;}
  if(i!==activeIndex){activeIndex=i;$$('[data-cue]').forEach(b=>b.classList.toggle('active',+b.dataset.cue===i));if(i>=0){const row=$(`[data-cue="${i}"]`);if(row){const container=$('#subtitles');container.scrollTop=row.offsetTop-container.offsetTop-container.clientHeight/2;}}}
 };
 $('#loop').onclick=()=>{loop=!loop;$('#loop').innerHTML=icon('loop')+' Повтор реплики: '+(loop?'вкл.':'выкл.');if(loop&&selected<0)toast('Выбери реплику из списка.');};
 $('#auto-pause').onclick=()=>{autoPause=!autoPause;$('#auto-pause').innerHTML=icon('pause')+' Пауза после фразы: '+(autoPause?'вкл.':'выкл.');};
 $('#replay').onclick=()=>{if(selected<0){toast('Сначала выбери реплику.');return;}if(video.src&&!screenStream){video.currentTime=Math.max(0,cues[selected].start+offset);video.play().catch(()=>{});}else speak(cues[selected].text);};
 $('#hide-subs').onclick=()=>{const hidden=$('#subtitles').hidden;$('#subtitles').hidden=!hidden;$('#hide-subs').textContent=hidden?'Скрыть текст':'Показать текст';};
 $('#share-screen').onclick=async()=>{
  if(capturePending)return;
  if(screenStream){stopScreen();video.hidden=true;$('#video-empty').hidden=false;return;}
  capturePending=true;try{if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Захват экрана недоступен в этом браузере. Используй скриншот через Ctrl + V.');const acquired=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});if(disposed||!root.isConnected){acquired.getTracks().forEach(t=>t.stop());return;}screenStream=acquired;video.removeAttribute('src');video.srcObject=screenStream;video.muted=true;video.controls=false;video.hidden=false;$('#video-empty').hidden=true;await video.play();if(disposed)return;sourceName='Кадр из захваченной вкладки';$('#share-screen').innerHTML=icon('close')+' Остановить захват';screenStream.getVideoTracks()[0].onended=()=>{if(disposed)return;stopScreen();video.hidden=true;$('#video-empty').hidden=false;};}catch(e){stopScreen();if(!disposed)toast(e.name==='NotAllowedError'?'Захват отменён. Можно вставить скриншот вручную.':e.message,true);}finally{capturePending=false;}
 };
 async function upload(blob){const f=new FormData();f.append('file',blob,'frame.png');return (await api('/media',f)).image;}
 function showImage(){const src=mediaURL(image);$('#image-preview').innerHTML=src?`<img class="capture-preview" src="${src}" alt="Сохранённый кадр"><div class="actions" style="margin-bottom:17px"><button class="btn small" id="ocr-again">Распознать текст</button><button class="btn small ghost" id="remove-image">Убрать кадр</button></div>`:'';if($('#remove-image'))$('#remove-image').onclick=()=>{image='';revision++;cardID=uid();persistAttachment();showImage();};if($('#ocr-again'))$('#ocr-again').onclick=ev=>busy(ev.currentTarget,async()=>{const version=revision,out=await api('/ocr',{image});if(!isCurrent(version))return;phrase.value=out.text;phrase.oninput();},'Распознаём…');}
 async function screenshot(blob,ocr=true,attachmentSource='Скриншот'){
  if(imagePending){toast('Сначала заверши обработку текущего кадра.');return;}
  imagePending=true;
  try{
  if(blob.size>12*1024*1024)throw Error('Изображение должно быть меньше 12 МБ.');
  const version=revision,cropped=ocr?await cropImage(blob,()=>isCurrent(version),lifecycle.signal):blob;if(!cropped||!isCurrent(version))return;const uploaded=await upload(blob);if(!isCurrent(version))return;image=uploaded;revision++;cardID=uid();currentSource=attachmentSource;
  if(ocr){phrase.value='';translation.value='';note.value='';phrase.oninput();translation.oninput();note.oninput();}else persistAttachment();showImage();
  if(ocr){const save=$('#save-card'),ocrVersion=revision;save.disabled=true;toast('Распознаём выделенный текст…');try{const cropID=cropped===blob?image:await upload(cropped);if(!isCurrent(ocrVersion))return;const out=await api('/ocr',{image:cropID});if(!isCurrent(ocrVersion))return;phrase.value=out.text;phrase.oninput();translation.value='';note.value='';translation.oninput();note.oninput();toast('Текст распознан. Проверь реплику перед переводом.');}catch(e){if(!disposed)toast(e.message,true);}finally{save.disabled=false;}}
  }finally{imagePending=false;}
 }
 $('#capture').onclick=ev=>busy(ev.currentTarget,async()=>{if(!video.videoWidth)throw Error('Сначала открой видео или начни захват вкладки.');const version=revision,frameTime=video.currentTime,frameCue=activeIndex,frameSource=sourceName,canvas=document.createElement('canvas'),scale=Math.min(1,1600/video.videoWidth);canvas.width=video.videoWidth*scale;canvas.height=video.videoHeight*scale;canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Не удалось сохранить этот кадр.');if(!isCurrent(version))return;if(frameCue>=0&&frameCue!==selected)select(frameCue,false);await screenshot(blob,!cues.length,frameSource+' · '+timestamp(frameTime));if(!disposed&&cues.length&&image)toast('Кадр добавлен к выбранной фразе.');},'Сохраняем кадр…');
 $('#load-image').onclick=()=>$('#image-file').click();
 $('#image-file').onchange=async ev=>{if(ev.target.files[0])try{await screenshot(ev.target.files[0]);}catch(e){toast(e.message,true);}ev.target.value='';};
 const paste=async ev=>{const item=[...ev.clipboardData.items].find(i=>i.type.startsWith('image/'));if(!item)return;ev.preventDefault();try{await screenshot(item.getAsFile());}catch(e){toast(e.message,true);}};document.addEventListener('paste',paste);
 $('#translate').onclick=ev=>busy(ev.currentTarget,async()=>{const text=phrase.value.trim(),version=revision;if(text.length<2)throw Error('Сначала выбери или впиши фразу.');const nearby=selected>=0?cues.slice(Math.max(0,selected-2),selected+3).map(c=>c.text).join(' '):'';const out=await api('/translate',{text,context:nearby});if(!isCurrent(version)){if(!disposed)toast('Черновик изменился во время перевода. Твой новый текст сохранён.');return;}translation.value=out.front;note.value=out.note;translation.oninput();note.oninput();},'Разбираем фразу…');
 $('#say-phrase').onclick=()=>speak(phrase.value);
 $('#save-card').onclick=ev=>busy(ev.currentTarget,async()=>{if(!translation.value.trim()||!phrase.value.trim())throw Error('Нужны английская фраза и русский смысл.');const version=revision;await api('/cards',{id:cardID,front:translation.value,back:phrase.value,note:note.value,image,source:currentSource||sourceName});if(isCurrent(version)){phrase.value='';translation.value='';note.value='';image='';currentSource='';showImage();phrase.oninput();translation.oninput();note.oninput();}if(!disposed)toast('Карточка сохранена. В «Повторении» сначала появится русский смысл.');window.dispatchEvent(new Event('ew-refresh'));},'Сохраняем…');
 $('#retell').onclick=async()=>{
  if(!cues.length){toast('Добавь субтитры, чтобы помощник мог сверить пересказ с источником.');return;}
  const start=selected>=0?selected:Math.max(0,activeIndex),excerpt=cues.slice(start,start+20).map(c=>c.text).join(' ');
  const task={id:uid(),title:'Пересказ твоего фрагмента',prompt:'Перескажи этот фрагмент на английском: сформулируй главную мысль, назови три важные детали и добавь свою реакцию. Сначала попробуй без текста. Затем проверь факты по субтитрам.',passage:excerpt};
  const sourceSaved=queueDraft('source-context',excerpt,true),taskSaved=queueDraft('practice-task:listening',JSON.stringify(task),true);
  await Promise.all([sourceSaved,taskSaved]);if(disposed||!root.isConnected)return;location.hash='/practice/listening';
 };
 cleanup=()=>{disposed=true;subtitleRequest++;lifecycle.abort();document.removeEventListener('paste',paste);video.pause();stopScreen();if(objectURL)URL.revokeObjectURL(objectURL);};showImage();renderSubs();
 if(episodeID)loadPrepared(episodeID);
}
