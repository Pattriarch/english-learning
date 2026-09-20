import {esc,icon} from './core.js';
import {speak} from './audio.js';

const scenes={
 articles:{file:'articles-scene.png',alt:'В кафе сначала показывают яблоко, затем указывают на уже знакомое яблоко.',title:'Сначала знакомим, потом узнаём',en:'It is an apple. The apple is red.',ru:'Это яблоко. Это яблоко красное.',why:'an apple — вводим один предмет. the apple — собеседник уже понимает, какое именно яблоко имеется в виду.'},
 time:{file:'time-scene.png',alt:'Слева человек ещё красит стул, справа стул уже покрашен.',title:'Процесс и готовый результат',en:'He is painting the chair. He has painted the chair.',ru:'Он красит стул. Он покрасил стул.',why:'Слева работа идёт сейчас: is painting. Справа работа завершена, и мы видим результат: has painted. Это разные взгляды на действие; готовый результат — один из случаев Present Perfect.'},
 perspective:{file:'perspective-scene.png',alt:'Свет под дверью и две возможные причины: человек дома или свет оставили включённым.',title:'Что вижу — и что только предполагаю',en:'The light is on. She might be home.',ru:'Свет горит. Возможно, она дома.',why:'Горящий свет — наблюдение. Вывод о человеке — предположение: might оставляет место другой причине. Если бы мы сказали She is home, это звучало бы как уверенное утверждение.'}
};
const mapped={
 'path-articles-basic':'articles','articles':'articles','path-articles-advanced':'articles',
 'path-present-perfect':'time','present-perfect':'time','path-present-perfect-continuous':'time',
 'path-deduction':'perspective','modals-deduction':'perspective'
};
export function lessonVisual(lesson){
 if(lesson.id==='path-present-perfect-continuous')return {...scenes.time,en:'He has been painting the chair. He has painted the chair.',ru:'Он уже некоторое время красит стул. Он покрасил стул.',why:'В первом случае выделяем процесс, начавшийся раньше: has been painting. Во втором — завершённый результат: has painted. Первая фраза сама по себе не обещает, что стул уже готов.'};
 const key=mapped[lesson.id];return key?scenes[key]:null;
}
export function lessonVisualHTML(lesson){
 const s=lessonVisual(lesson);if(!s)return '';
 return `<figure class="course-visual"><img src="/assets/course-scenes/${s.file}" alt="${esc(s.alt)}" loading="lazy" width="1536" height="1024"><figcaption><h3>${esc(s.title)}</h3><p lang="en">${esc(s.en)}</p><p>${esc(s.ru)}</p><p class="small-note">${esc(s.why)}</p></figcaption></figure>`;
}
export function courseGuideHTML(lesson,index=0){
 const g=lesson.courseGuide;if(!g)return lessonVisualHTML(lesson);
 return `<details class="course-guide card" ${index===0?'open':''}><summary>Сначала понять: ${esc(lesson.title)}</summary><div class="course-guide-content"><p class="course-purpose">${esc(g.purpose)}</p>${g.explanation.map((s,i)=>`<section><span class="eyebrow">${String(i+1).padStart(2,'0')}</span><h2>${esc(s.title)}</h2><p>${esc(s.body)}</p></section>`).join('')}${lessonVisualHTML(lesson)}<section><h2>Посмотри, как меняется смысл</h2>${g.examples.map((e,i)=>`<div class="course-example"><div class="spread"><p lang="en">${esc(e.en)}</p><button type="button" class="btn small ghost" data-guide-speak="${i}" aria-label="Послушать пример ${i+1}">${icon('sound')}</button></div><p>${esc(e.ru)}</p><p class="small-note">${esc(e.why)}</p></div>`).join('')}</section>${g.sources?.length?`<details class="course-sources"><summary>На чём основано объяснение</summary><p class="small-note">Объяснения и упражнения написаны для этого курса. Источники помогают проверить правило и способ подачи.</p><ul>${g.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>${s.notes?`<p class="small-note">${esc(s.notes)}</p>`:''}</li>`).join('')}</ul></details>`:''}</div></details>`;
}
export function bindCourseGuide(root,lesson){
 root.querySelectorAll('[data-guide-speak]').forEach(button=>button.onclick=()=>speak(lesson.courseGuide.examples[+button.dataset.guideSpeak].en,.9,'en-US',{button,isCurrent:()=>button.isConnected}));
}
