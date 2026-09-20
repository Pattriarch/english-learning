import {esc,icon} from './core.js';

export function lessonGuidanceHTML(lesson,exercise,index){
 if(!lesson.beginner)return '';
 const g=exercise.guidance;
 if(!g)return '<div class="lesson-step-heading"><span class="eyebrow">Теперь сам · без готового образца</span><p>Используй то, что уже потренировал. Одной короткой мысли достаточно, если в задании не сказано иначе.</p></div>';
 return `<section class="lesson-guidance" aria-label="Объяснение перед заданием"><div class="spread"><span class="eyebrow">Шаг ${index+1} · сначала разберёмся</span><button type="button" class="btn small ghost" id="guidance-toggle" aria-expanded="true" aria-controls="guidance-body">Убрать опору</button></div><div id="guidance-body"><h2>${esc(g.title)}</h2><p class="lesson-guidance-body">${esc(g.body)}</p><div class="lesson-guidance-example"><div class="spread"><p lang="en">${esc(g.example)}</p><button type="button" class="btn small ghost" id="guidance-listen" aria-label="Послушать образец">${icon('sound')}</button></div><p>${esc(g.translation)}</p></div></div></section>`;
}

export function lessonPrerequisiteHTML(lesson,lessons){
 if(!lesson.beginner)return '';
 const required=(lesson.prerequisites||[]).map(id=>lessons.find(l=>l.id===id)).filter(Boolean);
 return required.length?`<p class="lesson-prerequisites">Перед этим: ${required.map(l=>`<a href="#/lesson/${esc(l.id)}">${esc(l.title)}</a>`).join(' · ')}. Если пока трудно, начни с этого шага.</p>`:'<p class="lesson-prerequisites">Начало с нуля. Не нужно знать времена или правила: новые слова и формы разобраны перед каждым заданием.</p>';
}
