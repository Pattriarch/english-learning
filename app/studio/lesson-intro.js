import {esc,icon} from './core.js';
import {lessonVisualHTML,courseGuideHTML} from './course-guide.js';

// The first lesson introduces only I am. Other forms arrive before the task
// that needs them, instead of requiring the whole table on the first screen.
export function lessonIntroHTML(lesson,index=0){
 const first=lesson.id==='path-be',sections=first?lesson.sections.slice(0,1):lesson.sections;
 const body=lesson.courseGuide?courseGuideHTML(lesson,0):`${first?lessonVisualHTML(lesson):''}${sections.map(s=>`<section><h2>${esc(s.title)}</h2>${s.body.split('\n\n').map(p=>`<p>${esc(p)}</p>`).join('')}</section>`).join('')}${!first?courseGuideHTML(lesson,0):''}`;
 const sources=first?`<details class="course-sources"><summary>Учебник, видео и обсуждение по теме</summary><ul><li><a href="#/unit/grammar-elementary-001">Murphy · am / is / are</a> — дополнительные примеры в библиотеке.</li><li><a href="https://learnenglish.britishcouncil.org/free-resources/grammar/english-grammar-reference/link-verbs" target="_blank" rel="noopener noreferrer">British Council · глаголы-связки</a> — почему глагол может описывать состояние.</li><li><a href="https://www.youtube.com/watch?v=87LAZgZeuuY&t=28s" target="_blank" rel="noopener noreferrer">Разбор первого урока Murphy на русском</a> — сравнение с «был / буду», с 0:28.</li><li><a href="https://www.reddit.com/r/EnglishLearning/comments/f9i1g7/" target="_blank" rel="noopener noreferrer">Вопрос ученика: что вообще значит be?</a> — обсуждение трудности, а не справочник правил.</li></ul></details>`:'';
 return `<section class="card lesson-intro" aria-label="Объяснение перед практикой"><span class="eyebrow">Сначала поймём идею</span>${body}<a class="btn primary lesson-start" href="#/lesson/${encodeURIComponent(lesson.id)}/${index}?practice">${index?'Продолжить практику':'Попробовать самому'} ${icon('arrow')}</a>${sources}</section>`;
}
