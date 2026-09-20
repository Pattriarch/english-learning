import {$,$$,esc,icon,busy,api,getDraft,queueDraft,saveDraftConfirmed} from './core.js';
import {speak,recordOnly,stopAudio} from './audio.js';

export const decoderKey=(stage,task,suffix='')=>`ipa-decoder:${stage.id}:v${stage.revision||1}:${task.id}${suffix}`;
export const normalizeDecoding=value=>String(value||'').trim().toLowerCase().replace(/[’‘]/g,"'").replace(/[.!?]+$/,'').replace(/\s+/g,' ');
export const correctDecoding=(task,answer)=>normalizeDecoding(task.answer)===normalizeDecoding(answer);
export function decoderResult(stage,task,state,read=getDraft){
  try{
    const result=JSON.parse(read(decoderKey(stage,task,':result'),state)||'null');
    const answer=read(decoderKey(stage,task),state);
    return result&&result.answer===answer&&typeof result.revealed==='boolean'&&typeof result.correct==='boolean'&&result.correct===correctDecoding(task,answer)?result:null;
  }catch{return null;}
}
export function decoderProgress(catalog,state,read=getDraft){
  const stages=catalog?.decoder?.stages||[];
  return stages.map(stage=>({id:stage.id,done:stage.tasks.filter(task=>decoderResult(stage,task,state,read)?.correct).length,total:stage.tasks.length}));
}
export function decoderIntroHTML(catalog,state){
  if(!catalog.decoder?.stages?.length)return '';
  const rows=decoderProgress(catalog,state),done=rows.reduce((n,r)=>n+r.done,0),total=rows.reduce((n,r)=>n+r.total,0);
  return `<section class="surface ipa-intro"><div><span class="eyebrow">С САМОГО НАЧАЛА · ${rows.length} СТУПЕНЕЙ</span><h2>${esc(catalog.decoder.title)}</h2><p>${esc(catalog.decoder.description)}</p><a class="btn primary" href="#/pronunciation/ipa-decoder">${done?'Продолжить чтение IPA':'Научиться читать значки'} ${icon('arrow')}</a></div><div class="ipa-intro-example" aria-label="see — два звука: с и гласный в see"><span lang="en">see</span><strong class="ipa">/s i/</strong><small>три буквы → два звука</small><p>${done} / ${total} слов и фраз разобрано</p></div></section>`;
}

export function mountIPADecoder(root,data){
  const catalog=data.pronunciation,stages=catalog?.decoder?.stages||[];
  if(!stages.length){root.innerHTML='<div class="empty"><h2>Тренажёр пока не загружен</h2><p>Перезапусти приложение, чтобы загрузить курс чтения транскрипции.</p></div>';return;}
  const state=data.state,progress=()=>decoderProgress(catalog,state);
  let stageIndex=Math.max(0,progress().findIndex(r=>r.done<r.total)),taskIndex=0,playRequest=0;
  try{const position=JSON.parse(getDraft('ipa-decoder:position',state)||'null'),index=stages.findIndex(s=>s.id===position?.stage);if(index>=0){stageIndex=index;taskIndex=Number.isInteger(position.task)?Math.min(Math.max(0,position.task),stages[index].tasks.length-1):0;}}catch{}
  function navigate(nextStage,nextTask=0){stopAudio();playRequest++;stageIndex=nextStage;taskIndex=nextTask;queueDraft('ipa-decoder:position',JSON.stringify({stage:stages[stageIndex].id,task:taskIndex}));draw();}
  function draw(){
    const stage=stages[stageIndex],task=stage.tasks[taskIndex],key=decoderKey(stage,task),saved=getDraft(key,state),result=decoderResult(stage,task,state),rows=progress(),completed=rows[stageIndex].done===stage.tasks.length;
    const prerequisite=stageIndex>0&&rows[stageIndex-1].done<rows[stageIndex-1].total;
    root.innerHTML=`<div class="page-head"><div><a class="small-note" href="#/pronunciation">${icon('back')} Чтение и произношение</a><div class="eyebrow sound-chapter">ЧТЕНИЕ IPA · СТУПЕНЬ ${stageIndex+1} / ${stages.length}</div><h1>${esc(stage.title)}</h1><p>Сначала разберись и послушай. Затем напечатай знакомое слово по его звучанию.</p></div></div>
    <nav class="ipa-stage-nav" aria-label="Ступени чтения IPA">${stages.map((s,i)=>`<button class="btn small ${i===stageIndex?'primary':''}" data-ipa-stage="${i}" ${i===stageIndex?'aria-current="step"':''} aria-label="${i+1}. ${esc(s.title)}${rows[i].done===rows[i].total?' — разобрано':''}">${i+1}${rows[i].done===rows[i].total?' ✓':''}</button>`).join('')}</nav>
    ${prerequisite?`<p class="ipa-prerequisite">Здесь используются значки из предыдущей ступени. <button class="btn small" id="ipa-prerequisite">Вернуться к ней</button></p>`:''}
    <section class="surface ipa-teaching"><span class="eyebrow">НОВЫЕ ЗНАЧКИ</span><div class="ipa-symbol-strip">${stage.symbols.filter(s=>s.trim()).map(s=>`<span class="ipa">${esc(s)}</span>`).join('')}</div>${stage.explanation.map(p=>`<p>${esc(p)}</p>`).join('')}
    ${stage.symbols.includes('ˈ')?'<div class="ipa-stress-example"><span class="ipa" aria-label="about: слабое ə, ударение перед baʊt">/ə<span class="ipa-stress-mark">ˈ</span><strong>baʊt</strong>/</span><div>Знак стоит перед сильным слогом → <strong>BAUT</strong><br><small>Это подсказка ударения; произношение слушай у слова about ниже.</small></div></div>':''}
    <div class="spread ipa-models-heading"><h2>Четыре слова для этой ступени</h2><button class="btn small" id="ipa-model-toggle" aria-expanded="true" aria-controls="ipa-models">Скрыть подсказки</button></div><p class="small-note">Послушай каждое слово. Написание дано: транскрипция не позволяет восстановить все английские буквы однозначно.</p><div class="ipa-models" id="ipa-models">${stage.words.map(w=>`<article><strong lang="en">${esc(w.word)}</strong><span class="ipa">${esc(w.ipa)}</span><span>${esc(w.meaning)}</span><button class="btn small ghost" data-ipa-audio="${esc(w.word)}">${icon('sound')} Послушать</button></article>`).join('')}</div></section>
    <section class="surface ipa-practice"><span class="eyebrow">ТВОЯ ОЧЕРЕДЬ · ${taskIndex+1} / ${stage.tasks.length}</span><h2>Какое это слово или фраза?</h2><p class="ipa ipa-question">${esc(task.ipa)}</p><p>${esc(task.meaning)}</p><label class="field-label" for="ipa-answer">Напиши английскими буквами</label><input id="ipa-answer" type="text" lang="en" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(saved)}" placeholder="Например: see"><div class="actions"><button class="btn primary" id="ipa-check">Проверить ${icon('check')}</button><button class="btn" id="ipa-reveal">Показать и разобрать</button></div><div id="ipa-result" role="status">${result?resultHTML(task,result):''}</div>
    <div class="ipa-repeat"><h3>Теперь произнеси сам</h3><p class="small-note">Повтори образец и сравни свою запись. Здесь нет автоматической оценки акцента. Запись доступна до ухода со страницы.</p><button class="btn" id="ipa-record">${icon('mic')} Записать слово</button><audio class="audio-preview" id="ipa-recording" controls hidden></audio><audio class="audio-preview" id="ipa-model-player" controls hidden></audio><p class="small-note" id="ipa-voice-status" role="status"></p></div>
    <div class="ipa-task-nav"><button class="btn" id="ipa-prev" ${taskIndex===0?'disabled':''}>${icon('back')} Назад</button><span id="ipa-count">${rows[stageIndex].done} / ${stage.tasks.length} разобрано</span><button class="btn" id="ipa-next" ${taskIndex===stage.tasks.length-1?'disabled':''}>Следующее слово ${icon('arrow')}</button></div></section>
    <section class="surface ipa-bridge"><h2>Где это пригодится</h2><p>${esc(stage.bridge)}</p><p class="small-note">Здесь проверяется узнавание знакомых слов по IPA. Результаты и ответы сохраняются в твоих черновиках; это не оценка уровня английского или произношения.</p><button class="btn primary" id="ipa-finish" ${completed?'':'disabled'}>${stageIndex<stages.length-1?'Сохранить ступень и продолжить':'Сохранить и перейти к произношению'} ${icon('arrow')}</button><p class="small-note">Для следующей ступени напиши все четыре ответа верно. К образцам можно возвращаться.</p></section>`;
    const target=$('#ipa-answer',root),feedback=$('#ipa-result',root);
    const current=()=>target.isConnected&&$('#ipa-answer',root)===target;
    let revealed=result?.revealed||false;
    const updateCount=()=>{const row=progress()[stageIndex];$('#ipa-count',root).textContent=`${row.done} / ${row.total} разобрано`;$('#ipa-finish',root).disabled=row.done!==row.total;};
    target.oninput=()=>{queueDraft(key,target.value);feedback.innerHTML='';updateCount();};
    const saveResult=async reveal=>{
      const answer=target.value;
      if(!reveal&&!answer.trim())throw Error('Сначала напиши слово — или открой разбор.');
      revealed=revealed||reveal||!correctDecoding(task,answer);
      const next={answer,correct:correctDecoding(task,answer),revealed,at:new Date().toISOString()};
      await queueDraft(key,answer,true);await queueDraft(key+':result',JSON.stringify(next),true);
      if(current()&&target.value===answer){feedback.innerHTML=resultHTML(task,next);bindPlayback(feedback);updateCount();}
    };
    $('#ipa-check',root).onclick=ev=>busy(ev.currentTarget,()=>saveResult(false),'Сверяем…');
    $('#ipa-reveal',root).onclick=ev=>busy(ev.currentTarget,()=>saveResult(true),'Открываем…');
    target.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();$('#ipa-check',root).click();}};
    $('#ipa-model-toggle',root).onclick=ev=>{const models=$('#ipa-models',root);models.hidden=!models.hidden;ev.currentTarget.textContent=models.hidden?'Показать подсказки':'Скрыть подсказки';ev.currentTarget.setAttribute('aria-expanded',String(!models.hidden));};
    function bindPlayback(container){$$('[data-ipa-audio]',container).forEach(button=>button.onclick=async()=>{const request=++playRequest;await speak(button.dataset.ipaAudio,.85,'en-US',{button,player:$('#ipa-model-player',root),status:$('#ipa-voice-status',root),isCurrent:()=>current()&&button.isConnected&&request===playRequest});});}
    bindPlayback(root);
    $('#ipa-record',root).onclick=ev=>recordOnly(ev.currentTarget,$('#ipa-recording',root));
    $('#ipa-prev',root).onclick=()=>navigate(stageIndex,taskIndex-1);
    $('#ipa-next',root).onclick=()=>navigate(stageIndex,taskIndex+1);
    $$('[data-ipa-stage]',root).forEach(button=>button.onclick=()=>navigate(+button.dataset.ipaStage));
    const back=$('#ipa-prerequisite',root);if(back)back.onclick=()=>navigate(stageIndex-1);
    $('#ipa-finish',root).onclick=ev=>busy(ev.currentTarget,async()=>{
      const row=progress()[stageIndex];if(row.done!==row.total)throw Error('Сначала разбери все четыре слова.');
      const snapshot=stage.tasks.flatMap(item=>{const key=decoderKey(stage,item);return [key,key+':result'].map(key=>({key,text:getDraft(key,state)}));});
      const controls=$$('button',root).map(button=>[button,button.disabled]),readOnly=target.readOnly;
      controls.forEach(([button])=>button.disabled=true);target.readOnly=true;
      try{
        // Autosave can remain pending offline. Completion requires every
        // answer/result to be acknowledged, not just a separate read marker.
        for(const item of snapshot)await saveDraftConfirmed(item.key,item.text);
        await api('/read',{id:`ipa-decoder:${stage.id}:v${stage.revision||1}`});
        if(!current())return;
        if(stageIndex<stages.length-1)navigate(stageIndex+1);else{stopAudio();location.hash='#/pronunciation';}
      }finally{target.readOnly=readOnly;controls.forEach(([button,disabled])=>button.disabled=disabled);}
    },'Сохраняем…');
  }
  draw();
}
function resultHTML(task,result){
  return `<div class="ipa-answer-result ${result.correct?'correct':''}"><h3>${result.correct?'Да, ты прочитал верно.':result.revealed?'Разберём вместе.':'Пока не совпало. Посмотри, что изменилось.'}</h3><p class="ipa-revealed-word"><strong lang="en">${esc(task.answer)}</strong> <span class="ipa">${esc(task.ipa)}</span></p><p>${esc(task.explanation)}</p><button class="btn small" data-ipa-audio="${esc(task.answer)}">${icon('sound')} Послушать ответ</button>${!result.correct?'<p class="small-note">Прочитай значки ещё раз и напиши слово самостоятельно.</p>':''}</div>`;
}
