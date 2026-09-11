import {$,$$,esc,icon,api,uid,getDraft,mediaURL,clipUTF8} from './core.js';
import {speak,stopAudio} from './audio.js';
import {highlightLexicon,lexicalStudyContexts,lexicalPreparedContext,parseLexicalState,lexiconStateKey} from './lexicon-model.js';
import {fastVocabOptions,fastVocabURL,fastDueCards,fastExistingCard,fastCardEntryID,fastSavedTarget,fastLexicalCard,fastSwipeRating,fastKeyAction} from './fast-vocab-model.js';

export async function mountFastVocab(root,data,refresh,options={}){
 const opts=fastVocabOptions(options),route=location.hash,mountID=uid();root.dataset.fastVocabMount=mountID;
 const current=()=>root.isConnected&&root.dataset.fastVocabMount===mountID&&location.hash===route;
 let queue=[],finished=0,again=0,revealed=false,saving=false,loading=false,reviewID='',pendingRating=null,offset=0,total=Infinity,batchSize=0,loadError='';
 const saved=new Map((data.state.cards||[]).map(c=>[c.id,c]));
 root.innerHTML=`<section class="fast-vocab" aria-label="Быстрое изучение слов"><header class="fast-vocab-header"><div><a class="small-note" href="#/lexicon">${icon('back')} Живой словарь</a><h1>Слова в потоке</h1><p class="muted">Вспомни про себя, открой ответ и переходи дальше.</p></div><a class="btn small" href="#/review">Все мои карточки</a></header><div class="fast-vocab-toolbar"><nav aria-label="Набор карточек"><a class="btn small ${opts.deck==='dictionary'?'primary':'ghost'}" href="${esc(fastVocabURL({...opts,deck:'dictionary'}))}" ${opts.deck==='dictionary'?'aria-current="page"':''}>Новые</a><a class="btn small ${opts.deck==='saved'?'primary':'ghost'}" href="${esc(fastVocabURL({...opts,deck:'saved'}))}" ${opts.deck==='saved'?'aria-current="page"':''}>Повторить · ${fastDueCards(data.state.cards).length}</a></nav><label><span class="fast-direction-label">Направление</span><select id="fast-direction"><option value="recognize" ${opts.direction==='recognize'?'selected':''}>EN → RU</option><option value="produce" ${opts.direction==='produce'?'selected':''}>RU → EN</option></select></label></div><p class="small-note fast-vocab-selection">${opts.deck==='saved'?'Твои карточки · подошёл срок':opts.q||opts.list||opts.kind||opts.topic?'Новые слова · выбранные фильтры':'Новые слова · до 20 за подход'}</p><div id="fast-progress" class="fast-vocab-progress" role="status"></div><div id="fast-work"></div><p id="fast-status" class="fast-vocab-status" role="status" aria-live="polite"></p><details class="fast-vocab-help small-note"><summary>Как устроены подборка и повторение</summary><p>EN → RU — вспомни русский смысл английского предложения. RU → EN — сформулируй фразу по-английски по русскому смыслу.</p><p>${opts.deck==='saved'?'Карточки из твоего словаря, срок повторения которых уже наступил.':'До 20 новых контекстов за подход. Один пример на подборку; остальные доступны в полном разборе. Готовые примеры идут в порядке словаря.'}</p><p>Отметки сохраняются в твоих карточках. «Ещё раз» возвращает карточку через 10 минут, «Помню» и «Легко» увеличивают интервал. Это самооценка памяти; свою речь можно отдельно потренировать в полном разборе.</p></details></section>`;
 const stage=$('#fast-work',root),status=$('#fast-status',root);
 $('#fast-direction',root).onchange=ev=>{if(saving||pendingRating!==null)return;opts.direction=ev.target.value;stopAudio();if(queue.length){revealed=false;draw();}};
 function setStatus(message,error=false){if(current()){status.textContent=message;status.classList.toggle('is-error',error);}}
 function progress(){if(current())$('#fast-progress',root).innerHTML=`<span><strong>${finished}</strong> повторено${again?' · '+again+' ещё раз':''}</span><span>${queue.length?queue.length+' осталось':loading?'Подбираем слова…':batchSize?'Подход завершён':''}</span>`;}
 function draw(scrollToCard=false){
  if(!current())return;stopAudio();progress();const item=queue[0];
  if(!item){stage.innerHTML=`<div class="fast-vocab-empty card"><h2>${loading?'Подбираем контексты…':loadError?'Не удалось загрузить слова':finished?'Готово. Можно сделать паузу.':opts.deck==='saved'?'Сейчас всё повторено':'Новых слов по этим фильтрам больше нет'}</h2><p>${loading?'Открываем готовые примеры.':loadError?esc(loadError):finished?`${finished} карточек сохранено.${again?' '+again+' вернутся через 10 минут.':''}`:opts.deck==='saved'?'Карточки появятся здесь, когда наступит срок. Можно взять новые слова.':'Изученные карточки остаются в повторении. Попробуй другую подборку.'}</p>${!loading?`<div class="actions">${opts.deck==='dictionary'&&(offset<total||loadError)?'<button class="btn primary" id="fast-more">'+(loadError?'Повторить загрузку':'Ещё 20 контекстов')+'</button>':''}<a class="btn" href="${esc(fastVocabURL({...opts,deck:opts.deck==='saved'?'dictionary':'saved'}))}">${opts.deck==='saved'?'Взять новые слова':'К повторению'}</a><a class="btn ghost" href="#/today">На сегодня</a></div>`:''}</div>`;
   if($('#fast-more',root))$('#fast-more',root).onclick=()=>loadNew();if(scrollToCard)stage.scrollIntoView({block:'start',behavior:'auto'});return;
  }
  reviewID=uid();revealed=false;saving=false;pendingRating=null;
  const card=item.card,english=highlightLexicon(card.back,item.targetSpans),front=opts.direction==='produce'?esc(card.front):english;
  stage.innerHTML=`<article class="fast-vocab-card card" id="fast-card" tabindex="0" aria-label="Карточка для воспоминания"><div class="fast-vocab-card-top"><span class="eyebrow">${item.isNew?'Новый контекст':'Повторение'} · ${opts.direction==='produce'?'Вспомни по-английски':'Вспомни смысл'}</span><span class="small-note">${Math.min(finished+1,batchSize)} / ${batchSize}</span></div><p class="fast-vocab-prompt" lang="${opts.direction==='produce'?'ru':'en'}">${front}</p><p class="small-note" id="fast-recall-hint">Можно ответить про себя или вслух — печатать не обязательно.</p><button class="btn primary fast-vocab-reveal" id="fast-reveal" aria-controls="fast-answer" aria-expanded="false">Показать ответ <kbd>Пробел</kbd></button><div id="fast-answer" hidden></div></article><p class="fast-vocab-keys small-note">После ответа: ← / 1 — ещё раз · → / 2 — помню · 3 — легко. На телефоне можно смахнуть карточку.</p>`;
  const face=$('#fast-card',root);let pointer=null;
  function reveal(){
   if(!current()||revealed||saving||queue[0]!==item)return;
   revealed=true;face.classList.add('is-revealed');$('#fast-reveal',root).hidden=true;$('#fast-reveal',root).setAttribute('aria-expanded','true');$('#fast-recall-hint',root).hidden=true;
   const answer=$('#fast-answer',root);answer.hidden=false;
   answer.innerHTML=`<div class="fast-vocab-answer"><p class="fast-vocab-translation" lang="${opts.direction==='produce'?'en':'ru'}">${opts.direction==='produce'?english:esc(card.front)}</p>${item.meaning?`<p class="fast-vocab-meaning">${esc(item.meaning)}</p>`:''}<details class="fast-vocab-original"><summary>Исходная фраза</summary><p lang="${opts.direction==='produce'?'ru':'en'}">${front}</p></details><div class="fast-vocab-answer-tools"><button class="btn small ghost" id="fast-listen">${icon('sound')} Послушать</button>${item.entryId?`<a class="btn small ghost" href="#/lexicon/${esc(item.entryId)}">Полный разбор ${icon('arrow')}</a>`:''}</div>${item.imageURL?`<img class="fast-vocab-image" src="${esc(item.imageURL)}" alt="${esc(item.imageAlt||'Ситуация для ассоциации')}" loading="lazy">`:''}${card.note?`<details class="fast-vocab-notes"><summary>Пояснение и источник</summary><p>${esc(card.note)}</p></details>`:''}<div class="fast-vocab-ratings"><button class="btn" data-fast-rating="0"><strong>Ещё раз</strong><span>10 минут</span></button><button class="btn primary" data-fast-rating="2"><strong>Помню</strong><span>Позже</span></button><button class="btn" data-fast-rating="3"><strong>Легко</strong><span>Дольше</span></button></div></div>`;
   $('#fast-listen',root).onclick=()=>speak(card.back,.95,'en-US');
   $$('[data-fast-rating]',root).forEach(button=>button.onclick=()=>rate(Number(button.dataset.fastRating),item));
   face.focus({preventScroll:true});
  }
  $('#fast-reveal',root).onclick=reveal;
  face.onkeydown=ev=>{
   if(ev.repeat||ev.ctrlKey||ev.metaKey||ev.altKey||ev.target!==face)return;
   const action=fastKeyAction(ev.key,revealed);if(action===null)return;ev.preventDefault();if(action==='reveal')reveal();else rate(action,item);
  };
  face.onpointerdown=ev=>{if(ev.pointerType==='mouse'||!ev.isPrimary||ev.target.closest?.('button,a,summary,details,input,select'))return;pointer={id:ev.pointerId,x:ev.clientX,y:ev.clientY};};
  face.onpointercancel=()=>{pointer=null;};
  face.onpointerup=ev=>{if(!pointer||pointer.id!==ev.pointerId)return;const rating=fastSwipeRating(ev.clientX-pointer.x,ev.clientY-pointer.y,revealed);pointer=null;if(rating!==null)rate(rating,item);};
  face.focus({preventScroll:true});
  if(scrollToCard)face.scrollIntoView({block:'start',behavior:'auto'});
 }
 async function rate(rating,item){
  if(!current()||!revealed||saving||queue[0]!==item||![0,2,3].includes(rating)||pendingRating!==null&&pendingRating!==rating)return;
  pendingRating=rating;
  saving=true;$('#fast-direction',root).disabled=true;$$('[data-fast-rating]',root).forEach(b=>b.disabled=true);setStatus('Сохраняем…');stopAudio();
  const requestID=reviewID,direction=opts.direction;
  try{
   if(!saved.has(item.card.id)){
    if(item.imageURL&&!item.card.image){
     const response=await fetch(item.imageURL);if(!response.ok)throw Error('Не удалось открыть иллюстрацию карточки.');
     const blob=await response.blob();if(!current())return;
     const form=new FormData();form.append('file',blob,'context.png');
     const media=await api('/media',form);if(!mediaURL(media.image))throw Error('Не удалось сохранить иллюстрацию карточки.');
     item.card.image=media.image;if(!current())return;
    }
    const card=await api('/cards',{...item.card,note:clipUTF8(item.card.note,9500)});saved.set(card.id,card);item.card=card;item.isNew=false;
    // A departed view must not start a second mutation after creating the card.
    if(!current())return;
   }
   await api('/review',{id:requestID,cardId:item.card.id,rating,answer:`[Самооценка по памяти: ${direction==='produce'?'RU → EN':'EN → RU'}; без письменного ответа]`});
   if(!current())return;
   queue.shift();finished++;if(rating===0)again++;saving=false;$('#fast-direction',root).disabled=false;setStatus('Сохранено');draw(true);
  }catch(error){if(current()&&queue[0]===item){saving=false;$$('[data-fast-rating]',root).forEach(b=>b.disabled=Number(b.dataset.fastRating)!==rating);setStatus(error.message+' Попробуй ту же оценку ещё раз.',true);}}
 }
 async function loadNew(){
  if(!current()||loading)return;const startingOffset=offset;loading=true;loadError='';queue=[];draw();
  try{
   const updated=await refresh();if(!current())return;if(updated)data=updated;
   for(const c of data.state.cards||[])saved.set(c.id,c);
   const candidates=[];
   while(candidates.length<20&&offset<total){
    const params=new URLSearchParams({q:opts.q,list:opts.list,kind:opts.kind,topic:opts.topic,prepared:'1',offset:String(offset),limit:'40'});
    const page=await api('/lexicon?'+params);if(!current())return;
    total=Number(page.total)||0;if(!page.items?.length){offset=total;break;}
    for(const summary of page.items){
     offset++;
     const members=summary.members?.length?summary.members:[summary];
     const member=members.find(m=>m.preview?.ru&&m.preview?.en&&parseLexicalState(getDraft(lexiconStateKey(m.id),data.state)).status!=='known'&&!fastExistingCard([...saved.values()],m.preview.ru,m.preview.en));
     if(member)candidates.push(member);if(candidates.length===20)break;
    }
   }
   // Bound concurrent reads; the selected contexts are prepared before study begins.
   let next=0;const rows=new Array(candidates.length);
   await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
    while(next<candidates.length&&current()){
     const i=next++,summary=candidates[i],out=await api('/lexicon/'+encodeURIComponent(summary.id));if(!current())return;
     const entry=out.entry,context=lexicalStudyContexts(entry).find(c=>c.id===summary.preview.id&&lexicalPreparedContext(entry,c));
     if(!context)continue;const existing=fastExistingCard([...saved.values()],context.ru,context.en);if(existing)continue;
     rows[i]=await fastLexicalCard(entry,context);
    }
   }));
   if(!current())return;const seenContexts=new Set();queue=rows.filter(item=>{if(!item)return false;const key=JSON.stringify([item.card.front,item.card.back]);if(seenContexts.has(key))return false;seenContexts.add(key);return true;});batchSize=finished+queue.length;loading=false;draw();
  }catch(error){if(current()){offset=startingOffset;loading=false;loadError=error.message;draw();}}
 }
 if(opts.deck==='saved'){
  queue=fastDueCards([...saved.values()]).map(card=>({card,entryId:fastCardEntryID(card),targetSpans:fastSavedTarget(card),imageURL:mediaURL(card.image),isNew:false}));batchSize=queue.length;draw();
 }else await loadNew();
}
