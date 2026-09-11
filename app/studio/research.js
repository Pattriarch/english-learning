import {$,$$,esc,icon,api,busy,toast,uid,words,getDraft,localDraft,queueDraft,feedbackHTML,bindMistakes,progressLesson} from './core.js';
import {voice,stopAudio} from './audio.js';

const skills={grammar:'Грамматика',vocabulary:'Лексика',reading:'Чтение',listening:'Аудирование',writing:'Письмо',speaking:'Устная речь',interaction:'Взаимодействие',pronunciation:'Произношение',phonology:'Произношение',pragmatics:'Прагматика',mediation:'Передача смысла',discourse:'Связность речи',assessment:'Самопроверка'};
export function externalLink(url){try{const u=new URL(url);return u.protocol==='https:'||u.protocol==='http:'?u.href:'';}catch{return '';}}
const skillName=id=>skills[id]||id;
const latestAttempt=(state,id)=>state.attempts.filter(a=>a.lessonId==='research'&&a.exerciseId===id).at(-1);
const sourceLink=(s,label)=>{const url=externalLink(s?.url);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label||s.title)} ↗</a>`:'';};

export function mountCoverage(root,data){
 const catalog=data.research||{},topics=catalog.topics||[],sources=catalog.sources||[],sourceMap=new Map(sources.map(s=>[s.id,s]));
 const counts=new Map();for(const t of topics)counts.set(t.skill,(counts.get(t.skill)||0)+1);
 root.innerHTML=`<div class="page-head"><div><span class="eyebrow">BEYOND THE GRAMMAR BOOK</span><h1>Что ещё важно уметь.</h1><p>Карта навыков по CEFR, программам экзаменов и оглавлениям других учебников. У каждой темы — цель, практика и критерии результата.</p></div><a class="btn" href="#/roadmap">${icon('back')} Основной маршрут</a></div>
 <div class="research-intro"><article class="surface"><strong>${topics.length}</strong><span>тем для проверки навыков</span></article><article class="surface"><strong>${sources.length}</strong><span>внешних источников</span></article><article class="surface"><strong>${topics.filter(t=>latestAttempt(data.state,t.id)).length}</strong><span>практикумов с твоим ответом</span></article></div>
 <div class="notice">Грамматическая тема и коммуникативный навык — разные части обучения. Эта карта дополняет учебники: как попросить уточнение, понять быструю речь, написать отчёт или передать аргументы. Распределение тем по уровням — учебный ориентир; прохождение заданий само по себе не подтверждает уровень CEFR.</div>
 <section class="surface research-filters"><div class="search">${icon('search')}<input id="coverage-search" type="search" aria-label="Найти навык" placeholder="Например: интонация, отчёт, уточнение…"></div><select id="coverage-level" aria-label="Уровень навыка"><option value="">Все уровни</option>${['A1','A2','B1','B2','C1','C2'].map(l=>`<option>${l}</option>`).join('')}</select><select id="coverage-skill" aria-label="Направление навыка"><option value="">Все направления</option>${[...counts].map(([id,n])=>`<option value="${esc(id)}">${esc(skillName(id))} · ${n}</option>`).join('')}</select></section>
 <div class="section-heading"><h2>От знания к действию</h2><span class="small-note" id="coverage-count"></span></div><div id="coverage-list" class="research-grid"></div>
 <div class="spread pagination"><button id="coverage-prev" class="btn small">← Назад</button><span id="coverage-page" class="small-note"></span><button id="coverage-next" class="btn small">Далее →</button></div>
 <details class="surface research-sources"><summary>На чём основана карта · ${sources.length} источников</summary><p class="small-note">Открытые материалы, официальные оглавления и образцы коммерческих учебников. Задания мастерской написаны самостоятельно. Проверено: ${esc(catalog.checkedAt||'2026-09-09')}.</p><div class="research-source-grid">${sources.map(s=>`<article><h3>${sourceLink(s)}</h3><span class="eyebrow">${esc(s.kind||'Источник')}</span><p>${esc(s.scope||'')}</p></article>`).join('')}</div></details>`;
 let page=0;
 function draw(){
  const query=$('#coverage-search',root).value.trim().toLowerCase(),level=$('#coverage-level',root).value,skill=$('#coverage-skill',root).value;
  const filtered=topics.filter(t=>(!level||t.level===level)&&(!skill||t.skill===skill)&&(!query||`${t.title} ${t.why} ${t.practicePrompt} ${skillName(t.skill)}`.toLowerCase().includes(query)));
  const pages=Math.max(1,Math.ceil(filtered.length/18));page=Math.min(page,pages-1);
  $('#coverage-count',root).textContent=`${filtered.length} из ${topics.length} тем`;
  $('#coverage-list',root).innerHTML=filtered.slice(page*18,page*18+18).map(t=>{
   const a=latestAttempt(data.state,t.id),related=data.lessons.filter(l=>(t.lessonIds||[]).includes(l.id));
   return `<article class="surface research-topic"><div class="spread"><span class="eyebrow">${esc(t.level)} / ${esc(skillName(t.skill))}</span>${a?'<span class="pill green">Ответ сохранён</span>':''}</div><h3><a href="#/focus/${esc(t.id)}">${esc(t.title)}</a></h3><p>${esc(t.why)}</p><div class="research-meta">${related.length?`Связанных уроков: ${related.length}`:'Практикум со своим ответом'} · ${(t.successCriteria||[]).length} критерия</div><div class="research-mini-sources">${(t.sourceIds||[]).map(id=>sourceMap.get(id)).filter(Boolean).slice(0,2).map(s=>sourceLink(s)).join(' · ')}</div><a class="btn small" href="#/focus/${esc(t.id)}">Открыть практикум ${icon('arrow')}</a></article>`;
  }).join('')||'<div class="empty"><h3>Темы не найдены</h3><p>Попробуй другой запрос или сбрось фильтры.</p></div>';
  $('#coverage-page',root).textContent=`${page+1} / ${pages}`;$('#coverage-prev',root).disabled=page===0;$('#coverage-next',root).disabled=page===pages-1;
 }
 for(const id of ['coverage-search','coverage-level','coverage-skill'])$('#'+id,root).addEventListener(id==='coverage-search'?'input':'change',()=>{page=0;draw();});
 $('#coverage-prev',root).onclick=()=>{page--;draw();};$('#coverage-next',root).onclick=()=>{page++;draw();$('#coverage-list',root).scrollIntoView({block:'start',behavior:'smooth'});};draw();
}

export function mountFocus(root,data,id,refresh){
 const t=data.research?.topics?.find(t=>t.id===id);if(!t){root.innerHTML='<div class="empty"><h2>Навык не найден</h2><a class="btn" href="#/coverage">Карта навыков</a></div>';return;}
 const related=data.lessons.filter(l=>(t.lessonIds||[]).includes(l.id)),sources=(data.research.sources||[]).filter(s=>(t.sourceIds||[]).includes(s.id)),key='research:'+id;
 const attempt=latestAttempt(data.state,id),hasDraft=localDraft(key)!==null||Object.prototype.hasOwnProperty.call(data.state.drafts,key),saved=hasDraft?getDraft(key,data.state):attempt?.answer||'';
 root.innerHTML=`<div class="page-head"><div><a href="#/coverage" class="small-note">${icon('back')} Карта навыков</a><h1>${esc(t.title)}</h1><p>${esc(t.level)} · ${esc(skillName(t.skill))}</p></div></div><div class="research-workspace"><aside class="surface"><span class="eyebrow">ЗАЧЕМ ЭТО УМЕТЬ</span><p>${esc(t.why)}</p><h3>Проверяемый результат</h3><ol class="research-criteria">${t.successCriteria.map(c=>`<li>${esc(c)}</li>`).join('')}</ol><h3>Сначала разобраться</h3>${related.length?related.map(l=>`<a class="research-related" href="#/lesson/${esc(l.id)}">${icon(progressLesson(l,data.state).done?'check':'book')}<span>${esc(l.title)}<small>${esc(l.level)} · ${l.minutes} минут</small></span>${icon('arrow')}</a>`).join(''):'<p class="small-note">Начни с практикума и критериев. По результату выбери нужную тему в основном маршруте.</p>'}<details class="research-source-note"><summary>Основание и источники</summary>${sources.map(s=>`<p>${sourceLink(s)}<br><small>${esc(s.scope||'')}</small></p>`).join('')}<p class="small-note">Формулировка задания — авторская. Источники помогают выбрать навык и требования к нему.</p></details></aside><section class="surface exercise-card"><span class="eyebrow">ПРАКТИКУМ / САМОСТОЯТЕЛЬНЫЙ ОТВЕТ</span><p class="research-prompt">${esc(t.practicePrompt)}</p><label for="answer" class="field-label">Твой ответ по условиям задания</label><textarea class="answer-area" id="answer" rows="9" spellcheck="false" placeholder="Напиши сам или запиши голосом…">${esc(saved)}</textarea><div class="answer-meta"><span id="word-count"></span><span>Черновик сохраняется</span></div><div class="exercise-actions"><button class="btn" id="voice">${icon('mic')} Надиктовать ответ</button><button class="btn primary" id="check">Разобрать ответ ${icon('arrow')}</button></div><audio id="audio-preview" class="audio-preview" controls hidden></audio><div id="feedback">${attempt&&saved===attempt.answer?feedbackHTML(attempt):''}</div><p class="small-note research-limits">Помощник проверяет текст и выполнение задания. Для произношения прослушай свою запись: расшифровка не показывает качество звуков и интонации. Этот ответ сохраняется как практика навыка.</p></section></div>`;
 const target=$('#answer',root);let requestID=uid(),mode=saved===attempt?.answer&&attempt.mode==='speaking'?'speaking':'writing';
 const onText=inputMode=>{mode=inputMode;queueDraft(key,target.value);requestID=uid();$('#word-count',root).textContent=words(target.value)+' слов';$('#feedback',root).innerHTML='';};
 $('#word-count',root).textContent=words(target.value)+' слов';target.oninput=()=>onText('writing');
 $('#voice',root).onclick=ev=>voice(ev.currentTarget,target,data.settings,()=>onText('speaking'));
 $('#check',root).onclick=ev=>busy(ev.currentTarget,async()=>{
  if(target.value.trim().length<2)throw Error('Сначала напиши или произнеси ответ.');
  const submitted=target.value,payload={id:requestID,lessonId:'research',exerciseId:id,answer:submitted,mode};stopAudio();await queueDraft(key,submitted,true);const a=await api('/check',payload);await refresh();
  if($('#answer')===target&&target.value===submitted){$('#feedback',root).innerHTML=feedbackHTML(a);bindMistakes($('#feedback',root));}else toast('Разбор предыдущего ответа сохранён в журнале.');
 },'Разбираем по критериям…');
 target.onkeydown=ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();$('#check',root).click();}};bindMistakes(root);
}
