import {$,$$,esc,icon,progressLesson} from './core.js';
import {mountDailyPlanner} from './planner.js';
export const designs=[
 {id:'bento',name:'01 / Cobalt Bento',short:'Bento',note:'Крупные модули, кобальт и тактильная обложка. Ближе всего к твоему «Драйву».',color:'#4667ff',dark:'#101216'},
 {id:'editorial',name:'02 / The English Journal',short:'Editorial',note:'Журнальная сетка, выразительные заголовки и много воздуха для длинного чтения.',color:'#bc6146',dark:'#1c1917'},
 {id:'cinema',name:'03 / After Hours',short:'Cinema',note:'Широкий киноэкран, тёплый янтарь, практика через истории и диалоги.',color:'#d4a85f',dark:'#151311'},
 {id:'studio',name:'04 / Language Studio',short:'Studio',note:'Навигация сверху, компактная рабочая станция и лавандовые акценты.',color:'#9387db',dark:'#171621'},
 {id:'forest',name:'05 / Quiet Progress',short:'Forest',note:'Спокойный зелёный, одна большая цель и мягкий ритм учебного дня.',color:'#77a990',dark:'#121c18'},
 {id:'mono',name:'06 / Swiss Index',short:'Mono',note:'Строгая типографика, открытая модульная сетка и красный маркер действия.',color:'#e86651',dark:'#151515'}
];
export function appearance(){
 let prefs={design:'bento',theme:'dark'};
 try{prefs={...prefs,...JSON.parse(localStorage.getItem('ew-appearance')||'{}')};}catch{}
 if(!designs.some(d=>d.id===prefs.design))prefs.design='bento';
 if(!['light','dark'].includes(prefs.theme))prefs.theme='dark';
 document.documentElement.dataset.design=prefs.design;document.documentElement.dataset.theme=prefs.theme;return prefs;
}
export function setAppearance(patch){
 const pref={...appearance(),...patch};
 try{localStorage.setItem('ew-appearance',JSON.stringify(pref));}catch{}
 document.documentElement.dataset.design=pref.design;document.documentElement.dataset.theme=pref.theme;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',pref.theme==='dark'?designs.find(d=>d.id===pref.design).dark:'#f4f5f8');
 window.dispatchEvent(new Event('ew-appearance'));
}
appearance();
export function bindAppearance(){
 const b=$('#theme-toggle');
 if(b)b.onclick=()=>setAppearance({theme:appearance().theme==='dark'?'light':'dark'});
}
window.addEventListener('ew-appearance',()=>{const b=$('#theme-toggle'),dark=appearance().theme==='dark';if(b){b.textContent=dark?'☼':'◐';b.setAttribute('aria-label',dark?'Включить светлую тему':'Включить тёмную тему');}if($('#gallery-mode'))mountDesigns($('#main'));});
export function selectCurrent(data){
 const latest=data.state.attempts.at(-1),prior=latest&&data.lessons.find(l=>l.id===latest.lessonId&&!progressLesson(l,data.state).done);
 return prior||data.lessons.find(l=>l.level.includes('B1')&&!progressLesson(l,data.state).done)||data.lessons[0];
}
export async function mountDashboard(root,data,refresh){
 return mountDailyPlanner(root,data,refresh);
}
function miniature(d){
 const light=appearance().theme==='light',paper={bento:'#eef1f8',editorial:'#f4eee3',cinema:'#f2e9db',studio:'#f0ecfa',forest:'#eaf1e6',mono:'#f2f2ec'};
 return `<div class="design-mini mini-${d.id} ${light?'preview-light':''}" style="--preview-bg:${light?paper[d.id]:d.dark};--preview-accent:${d.color}"><div class="mini-sidebar"><b>ew.</b><i></i><i></i><i></i><i></i></div><div class="mini-canvas"><span>ENGLISH WORKSHOP</span><h3>${d.id==='editorial'?'The art of<br> <em>finding words.</em>':d.id==='cinema'?'Stories worth<br>talking about.':d.id==='mono'?'MAKE<br>YOUR POINT.':'Your next<br>chapter.'}</h3><div class="mini-grid"><div class="mini-hero"><span>Продолжить</span><b>Present perfect.<br>Смысл важнее формулы.</b></div><div class="mini-stat"><b>A1<br>↓<br>C2</b></div><div class="mini-film">BETTER CALL SAUL</div><div class="mini-list"><i></i><i></i><i></i></div></div></div></div>`;
}
export function mountDesigns(root){
 const pref=appearance();
 root.innerHTML=`<div class="page-head"><div><div class="eyebrow">DESIGN COLLECTION / 2026</div><h1>Шесть характеров.<br>Одна мастерская.</h1><p>Выбери пространство, в котором хочется остаться. Каждый вариант — светлый и тёмный.</p></div><button class="btn" id="gallery-mode">${pref.theme==='dark'?'Посмотреть в светлом':'Посмотреть в тёмном'}</button></div><div class="design-gallery">${designs.map(d=>`<article class="design-option ${d.id===pref.design?'selected':''}">${miniature(d)}<div class="design-description"><div class="spread"><h2>${d.name}</h2><span class="design-dot" style="background:${d.color}"></span></div><p>${d.note}</p><button class="btn ${d.id===pref.design?'primary':''}" data-design-pick="${d.id}">${d.id===pref.design?'Открыть текущий':'Примерить дизайн'} ${icon('arrow')}</button></div></article>`).join('')}</div><div class="notice design-references">Опорные идеи: типографика и карточки из твоего «Драйва», выразительная модульная сетка и спокойные поверхности. <a href="https://linear.app/now/behind-the-latest-design-refresh" target="_blank" rel="noreferrer">Linear: обновление 2026</a> · <a href="https://vercel.com/geist/typography" target="_blank" rel="noreferrer">Geist: типографика</a>. Обложка создана через Image Generator специально для мастерской.</div>`;
 $$('[data-design-pick]',root).forEach(b=>b.onclick=()=>{setAppearance({design:b.dataset.designPick});location.hash='/today';});
 $('#gallery-mode').onclick=()=>setAppearance({theme:appearance().theme==='dark'?'light':'dark'});
}
