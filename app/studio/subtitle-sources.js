import {$,esc,icon,getDraft,queueDraft} from './core.js';
import {externalLink} from './research.js';
import {loadPreparedSubtitleCatalog} from './prepared-subtitles.js';

const mounts=new WeakMap();

export function mountSubtitleSources(root,data,episodeID='',showSelector=false,onPrepared=null){
 const token={};mounts.set(root,token);let localEntries=[];
 const catalog=data.subtitleSources,episodes=data.cinema?.series?.[0]?.episodes||[];
 if(!catalog?.sources?.length){root.innerHTML='';return;}
 let selected=episodes.find(e=>e.id===(episodeID||getDraft('cinema:selected',data.state)))||episodes[0];
 if(!selected){root.innerHTML='';return;}
 const sourceMap=new Map(catalog.sources.map(s=>[s.id,s]));
 const checkedAt=String(catalog.checkedAt||'').slice(0,10);
 function draw(){
  const record=catalog.episodes?.find(e=>e.episodeId===selected.id),links=(record?.links||[]).filter(l=>externalLink(l.url));
  const prepared=localEntries.find(e=>e.episodeId===selected.id);
  root.innerHTML=`<section class="surface subtitle-discovery"><span class="eyebrow">ENGLISH SUBTITLES / S01E${String(selected.number).padStart(2,'0')}</span><h3>Субтитры к «${esc(selected.title)}»</h3>${showSelector?`<label class="small-note" for="subtitle-episode">Эпизод Better Call Saul</label><select class="subtitle-episode-select" id="subtitle-episode">${episodes.map(e=>`<option value="${esc(e.id)}" ${e.id===selected.id?'selected':''}>S01E${String(e.number).padStart(2,'0')} · ${esc(e.title)}</option>`).join('')}</select>`:''}<p>Выбери English и версию видео, скачай SRT/VTT на странице источника. ZIP сначала распакуй. Затем открой файл в медиатеке и сверь начало первой реплики.</p><div class="subtitle-links">${links.map(l=>`<a class="btn small" href="${esc(externalLink(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label||sourceMap.get(l.sourceId)?.name||'Открыть источник')} ↗</a>`).join('')||'<span class="small-note">Для этого эпизода отдельная страница пока не подтверждена.</span>'}${!showSelector?'<a class="btn small primary" href="#/media">'+icon('upload')+' Подключить файл</a>':''}</div><details class="subtitle-source-list"><summary>Доступность и версии · проверено ${esc(checkedAt)}</summary>${links.map(l=>{const s=sourceMap.get(l.sourceId);return `<article><h4>${esc(s?.name||l.sourceId)}</h4><span class="pill">${l.verified?'Страница проверена':'Поиск в каталоге'}</span><p>${esc(l.note||'')}</p>${s?`<p>${esc(s.access||'')} ${esc(s.notes||'')}</p>`:''}</article>`;}).join('')}<p>Наличие страницы не означает, что файл уже загружен в мастерскую. Каталог может потребовать cookies или вход. Английские полные субтитры и forced-only для испанских реплик — разные дорожки.</p></details></section>`;
  const bundle=sourceMap.get('tvsubtitles');
  if(prepared){
   $('.subtitle-discovery > p',root).textContent='Английские субтитры уже подготовлены. Открой их вместе со своим видео; ниже есть источники других версий.';
   $('.subtitle-links',root).insertAdjacentHTML('beforebegin',`<div class="prepared-subtitle"><span class="pill green">English · ${prepared.cueCount} реплик готовы</span><p>${esc(prepared.originalFilename)}. Сверь таймкоды со своей версией видео.</p>${onPrepared?`<button class="btn small primary" data-open-prepared>${icon('play')} Открыть готовые субтитры</button>`:`<a class="btn small primary" href="#/media/${esc(selected.id)}">${icon('play')} Открыть готовые субтитры</a>`}</div>`);
   if(onPrepared)$('[data-open-prepared]',root).onclick=()=>onPrepared(selected.id);
  }
  if(externalLink(bundle?.url))$('.subtitle-links',root).insertAdjacentHTML('afterbegin',`<a class="btn small" href="${esc(externalLink(bundle.url))}" target="_blank" rel="noopener noreferrer">English · весь сезон в ZIP ↗</a>`);
  if(showSelector)$('#subtitle-episode',root).onchange=ev=>{selected=episodes.find(e=>e.id===ev.target.value)||selected;queueDraft('cinema:selected',selected.id);draw();};
 }
 draw();
 loadPreparedSubtitleCatalog().then(entries=>{if(!root.isConnected||mounts.get(root)!==token)return;localEntries=entries;draw();}).catch(()=>{});
}
