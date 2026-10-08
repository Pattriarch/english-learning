import {$,esc,icon,getDraft,queueDraft,cardModal} from './core.js';
import {speak,stopAudio} from './audio.js';
import {lessonClip,dayWatchKey} from './day-session-model.js';
import {dayHeader,dayNextHTML} from './day-session.js';

// «Смотрим»: one screen, one thing at a time — watch, understand, notice the form, shadow, keep a phrase.
export function mountDayWatch(root,ctx){
 const clip=lessonClip(ctx.data,ctx.lesson),key=dayWatchKey(ctx.day);
 if(!clip){root.innerHTML=`<div class="lesson-flow day-flow">${dayHeader(ctx,'watch')}<section class="day-screen"><h1>Ролика для урока пока нет</h1>${dayNextHTML(ctx,'watch',{mark:true})}</section></div>`;return;}
 let saved={};try{saved=JSON.parse(getDraft(key,ctx.data.state)||'{}')||{};}catch{}
 const stages=['blind',...(clip.question?['question']:[]),'look','shadow','save'];
 let stage=saved.lessonId===ctx.lesson.id&&stages.includes(saved.stage)?saved.stage:'blind',revealed=false,repeats=0,played=false;
 const store=extra=>{saved={...saved,...extra,lessonId:ctx.lesson.id,stage,at:new Date().toISOString()};ctx.data.state.drafts={...ctx.data.state.drafts,[key]:{text:JSON.stringify(saved),at:saved.at}};return queueDraft(key,JSON.stringify(saved),true);};
 const src=subs=>clip.embed?clip.embed+(clip.embed.includes('?')?'&':'?')+(subs?'cc_load_policy=1&cc_lang_pref=en':'cc_load_policy=0')+'&rel=0':'';
 const player=clip.embed?`<div class="day-player"><iframe id="day-frame" src="${esc(src(false))}" title="${esc(clip.title)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe></div>`:clip.url?`<p><a class="btn" href="${esc(clip.url)}" target="_blank" rel="noopener noreferrer">${icon('play')} Открыть ролик</a></p>`:'';
 root.innerHTML=`<div class="lesson-flow day-flow">${dayHeader(ctx,'watch',clip.source||'')}<section class="day-screen day-watch"><h1>${esc(clip.title)}</h1>${player}<div id="day-stage" aria-live="polite"></div></section></div>`;
 const go=(label,primary=true)=>`<div class="day-next"><button type="button" class="btn ${primary?'primary':''}" id="stage-go">${label} ${icon('arrow')}</button></div>`;
 function next(){stopAudio();stage=stages[stages.indexOf(stage)+1]||'save';revealed=false;if(stage==='look')subtitles();store({});draw();}
 const subtitles=()=>{const frame=$('#day-frame',root);if(frame&&clip.embed)frame.src=src(true);};
 function draw(){
  const panel=$('#day-stage',root);if(!panel)return;let html='';
  if(stage==='blind')html=clip.kind==='audio'?`<h2>Послушай без текста</h2><p class="small-note">Только общий смысл, детали — потом.</p>${go(played?'Послушал':'Послушать')}`:clip.kind==='cinema'?`<h2>Посмотри сцену у себя</h2><p class="day-cue">${esc(clip.text)}</p><p class="small-note">Сначала без субтитров.</p>${go('Посмотрел')}`:`<h2>Посмотри без субтитров</h2><p class="small-note">Только общий смысл, детали — потом.</p>${go('Посмотрел')}`;
  else if(stage==='question')html=`<h2>О чём это?</h2><p class="day-cue">${esc(clip.question.prompt)}</p>${revealed?`<p class="day-reveal">${esc(clip.question.answer)}</p>${go('Дальше')}`:`<p class="small-note">Ответь про себя, потом проверь.</p>${go('Показать ответ')}`}`;
  else if(stage==='look')html=`<h2>${clip.kind==='audio'?'Теперь с текстом':'Ещё раз — с субтитрами'}</h2>${clip.lookFor?`<p class="day-cue">Найди: ${esc(clip.lookFor)}</p>`:''}${clip.kind==='audio'?`<p class="day-transcript" lang="en">${esc(clip.text)}</p><button type="button" class="btn ghost small" id="stage-listen">${icon('sound')} Послушать ещё раз</button>`:clip.lines.length?`<details class="day-lines"><summary>Текст ролика</summary>${clip.lines.map(line=>`<p lang="en">${esc(line)}</p>`).join('')}</details>`:''}${go('Нашёл')}`;
  else if(stage==='shadow')html=`<h2>Повтори за ними</h2><p class="day-reveal" lang="en">${esc(clip.shadowLine)}</p><p class="small-note">Три раза вслух, в том же темпе и с той же интонацией.</p><button type="button" class="btn ghost small" id="stage-listen">${icon('sound')} Послушать</button>${go(repeats<3?`Повторил вслух · ${repeats+1} из 3`:'Дальше')}`;
  else html=saved.done?`<h2>Фраза сохранена</h2><p class="day-reveal" lang="en">${esc(saved.phrase||clip.shadowLine)}</p>${dayNextHTML(ctx,'watch')}`:`<h2>Забери фразу себе</h2><p class="day-reveal" lang="en">${esc(clip.shadowLine)}</p><p class="small-note">Она попадёт в итог дня и в карточки — завтра её вспомним.</p>${go('Сохранить фразу')}`;
  panel.innerHTML=html;
  const listen=$('#stage-listen',root);if(listen)listen.onclick=()=>speak(stage==='look'&&clip.kind==='audio'?clip.text:clip.shadowLine,.9,'en-US',{button:listen,isCurrent:()=>listen.isConnected});
  const button=$('#stage-go',root);if(!button)return;
  button.onclick=async()=>{
   if(stage==='blind'&&clip.kind==='audio'&&!played){played=true;speak(clip.text,.9,'en-US',{button,isCurrent:()=>button.isConnected});draw();return;}
   if(stage==='question'&&!revealed){revealed=true;draw();return;}
   if(stage==='shadow'&&repeats<3){repeats++;draw();return;}
   if(stage==='save'){await store({done:true,phrase:clip.shadowLine});draw();cardModal({front:'',back:clip.shadowLine,note:clip.lookFor||'',source:'Ролик: '+clip.title});return;}
   next();
  };
 }
 if(!['blind','question'].includes(stage))subtitles();
 draw();
}
