import {api,esc,icon} from './core.js';
import {coverageSummary,coverageSupplementGroups,sourceURL} from './curriculum-coverage-model.js';

let metadataRequest;
const mounts=new WeakMap();
export function loadCurriculumCoverage({fresh=false}={}){
 if(!metadataRequest||fresh){
  const request=api('/curriculum/coverage');metadataRequest=request;
  request.catch(()=>{if(metadataRequest===request)metadataRequest=null;});
 }
 return metadataRequest;
}
const skills={reading:'Чтение',listening:'Слух',writing:'Письмо',speaking:'Речь',interaction:'Диалог',mediation:'Медиация',pronunciation:'Произношение',register:'Регистр',vocabulary:'Лексика','critical-thinking':'Аргументация',fluency:'Беглость',cohesion:'Связность',orthography:'Орфография'};
const lessonHref=id=>'#/lesson/'+encodeURIComponent(id);
const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}).replace(/\.$/,''):'';

function sourceLinks(ids,metadata){
 const wanted=new Set(ids||[]);
 return (metadata.sources||[]).filter(s=>wanted.has(s.id)&&sourceURL(s.url)).map(s=>`<a href="${esc(sourceURL(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ${icon('arrow')}</a>`).join('');
}
function supplementHTML(metadata){
 const groups=coverageSupplementGroups(metadata);
 return `<details class="cc-reference"><summary>Справочники из твоих книг <span>${groups.length} семейств</span></summary><p>Неправильные глаголы, фонетические таблицы и диагностика доступны как исходные разделы. Они помогают учиться, но не прибавляют пройденных уроков.</p><div class="cc-reference-grid">${groups.map(g=>`<details><summary>${esc(g.title)} <span>${g.entries.length}</span></summary><p>${esc(g.gap)}</p><div class="cc-source-links">${g.entries.filter(e=>e.href).map(e=>`<a href="${esc(e.href)}" target="_blank" rel="noopener">${esc(e.title)} <span>PDF ${e.page}–${e.endPage}</span></a>`).join('')||'<span>Исходные страницы сейчас недоступны.</span>'}</div></details>`).join('')}</div></details>`;
}
function moduleHTML(module,metadata){
 const current=module.relatedLessons.slice(0,3);
 const finding=module.relatedLessons.reduce((text,l)=>text.replaceAll(l.id,'«'+l.title+'»'),module.gap?.finding||'Для этой темы запланированы дополнительные материалы и самостоятельные ответы.');
 return `<details class="cc-module"><summary><span class="cc-module-title">${esc(module.title)}<small>${(module.skills||[]).map(s=>esc(skills[s]||s)).join(' · ')}</small></span><span class="cc-status ${module.available?'is-available':''}">${module.available?'Доступен':'В плане'}</span></summary><div class="cc-module-body"><p>${esc(module.outcomes?.join(' ')||'')}</p>${module.available?`<a class="cc-start" href="${lessonHref(module.id)}">Открыть занятие ${icon('arrow')}</a>`:`<p class="cc-pending">Подробный модуль ещё готовится.${current.length?' Начать можно с этих занятий:':''}</p>${current.length?`<div class="cc-related">${current.map(l=>`<a href="${lessonHref(l.id)}">${esc(l.title)}</a>`).join('')}</div>`:''}`}<details class="cc-audit"><summary>Что проверяли в программе</summary><p>${esc(finding)}</p><p class="cc-audit-date">Снимок до расширения курса${dateLabel(metadata.auditDate)?' · '+esc(dateLabel(metadata.auditDate)):''}. Доступность нового занятия показана выше.</p><div class="cc-source-links">${sourceLinks(module.sourceIds,metadata)}</div></details></div></details>`;
}

export function mountCurriculumCoverage(root,data,{level=null,compact=false,onLessonsChanged=()=>{}}={}){
 const route=location.hash,token={};mounts.set(root,token);
 const active=()=>root.isConnected&&location.hash===route&&mounts.get(root)===token;
 let metadata,refreshing=false,failure='';
 root.classList.add('curriculum-coverage');
 root.innerHTML='<p class="cc-loading" role="status">Загружаем сверку программы…</p>';
 function render(){
  if(!active())return;
  const summary=coverageSummary(metadata,data.lessons,level);
  root.innerHTML=`<div class="cc-head"><div><span class="cc-eyebrow">ДАЛЬШЕ ГРАММАТИКИ${level?' · '+esc(level):''}</span><h2>Больше практики с реальными задачами</h2><p>Чтение и слушание, свои тексты, диалоги и объяснения для других.</p></div><div class="cc-count"><strong>${summary.available}<span> / ${summary.total}</span></strong><span>доступно сейчас${level?' · '+esc(level):''}</span></div></div><div class="cc-state-line"><span>${summary.planned?`${summary.planned} ещё в плане`:'Все модули этого расширения доступны'} · ${summary.allTotal} в расширении A1–C2</span><button type="button" class="cc-refresh" ${refreshing?'disabled':''}><span aria-hidden="true">↻</span> ${refreshing?'Проверяем…':'Обновить доступность'}</button></div>${compact?'<a class="cc-start" href="#/roadmap">Посмотреть темы по уровням '+icon('arrow')+'</a>':`<details class="cc-topic-list"><summary>Что уже готово и что остаётся <span>${summary.available} доступно · ${summary.planned} в плане</span></summary><div>${summary.modules.map(m=>moduleHTML(m,metadata)).join('')}</div></details>`}${supplementHTML(metadata)}<p class="cc-footnote">Это доступность материалов. Твой навык растёт через самостоятельные ответы и проверку на новых ситуациях; количество уроков не присваивает уровень CEFR.</p>`;
  root.querySelector('.cc-refresh').onclick=async()=>{
   if(refreshing)return;refreshing=true;failure='';render();
   try{const [fresh,freshMetadata]=await Promise.all([api('/bootstrap'),loadCurriculumCoverage({fresh:true})]);if(!active())return;metadata=freshMetadata;if(Array.isArray(fresh.lessons))data.lessons=fresh.lessons;onLessonsChanged();}
   catch(error){failure=error.message;}
   finally{refreshing=false;if(active()){render();if(failure){const note=root.querySelector('.cc-footnote');note.textContent=failure;note.setAttribute('role','status');}}}
  };
 }
 loadCurriculumCoverage().then(result=>{if(!active())return;metadata=result;render();}).catch(()=>{
  if(!active())return;root.innerHTML='<p class="cc-loading">Сверка программы сейчас недоступна. Готовые занятия ниже можно проходить.</p><button type="button" class="cc-refresh">Повторить загрузку</button>';
  root.querySelector('button').onclick=()=>mountCurriculumCoverage(root,data,{level,compact,onLessonsChanged});
 });
}
