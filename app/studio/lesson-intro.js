import {esc,icon} from './core.js';
import {speak} from './audio.js';
import {lessonVisualHTML,lessonVisualSupportHTML,courseGuideHTML} from './course-guide.js';

const list=value=>Array.isArray(value)?value:[];

// One explanation, read once. A gradual lesson (introSections below the full
// count) shows only its opening idea here; each later point is introduced by
// the short explanation immediately before the task that needs it.
export function lessonIntroParts(lesson){
 const sections=list(lesson?.sections),examples=list(lesson?.examples);
 const shown=Number.isInteger(lesson?.introSections)&&lesson.introSections>0?Math.min(lesson.introSections,sections.length):sections.length;
 const exampleCount=Number.isInteger(lesson?.introExamples)?Math.min(Math.max(lesson.introExamples,0),examples.length):shown===sections.length?examples.length:0;
 return {sections:sections.slice(0,shown),later:sections.length-shown,examples:examples.slice(0,exampleCount)};
}

export function lessonIntroHTML(lesson,index=0,lessons=[]){
 const start=`<a class="btn primary lesson-start" href="#/lesson/${encodeURIComponent(lesson.id)}/${index}?practice">${index?'Продолжить практику':'Попробовать самому'} ${icon('arrow')}</a>`;
 if(lesson.courseGuide)return `<section class="card lesson-intro" aria-label="Объяснение перед практикой"><span class="eyebrow">Сначала поймём идею</span>${courseGuideHTML(lesson,0)}${start}</section>`;
 const {sections,later,examples}=lessonIntroParts(lesson);
 const recycled=list(lesson.recycles).map(id=>list(lessons).find(l=>l?.id===id)).filter(Boolean);
 const sectionHTML=sections.map(s=>`<section><h2>${esc(s.title)}</h2>${String(s.body).split('\n\n').map(p=>`<p>${esc(p)}</p>`).join('')}</section>`).join('');
 const exampleHTML=examples.length?`<section class="lesson-intro-examples"><h2>Послушай и сравни</h2>${examples.map((e,i)=>`<div class="course-example"><div class="spread"><p lang="en">${esc(e.en)}</p><button type="button" class="btn small ghost" data-intro-speak="${i}" aria-label="Послушать пример ${i+1}">${icon('sound')}</button></div><p>${esc(e.ru)}</p>${e.why?`<p class="small-note">${esc(e.why)}</p>`:''}</div>`).join('')}</section>`:'';
 const laterHTML=later>0?'<p class="small-note lesson-intro-later">Остальное разберём по шагам: короткое объяснение появится прямо перед заданием, где оно понадобится.</p>':'';
 const recycleHTML=recycled.length?`<p class="lesson-recycles"><span class="eyebrow">Заодно повторим</span> ${recycled.map(l=>`<a href="#/lesson/${encodeURIComponent(l.id)}">${esc(l.title)}</a>`).join(' · ')}</p>`:'';
 const sources=list(lesson.sources).filter(s=>typeof s?.url==='string'&&s.url.startsWith('https://'));
 const sourceHTML=sources.length?`<details class="course-sources"><summary>На чём основано объяснение</summary><p class="small-note">Объяснение и задания написаны для этого курса. Правило сверено с этими материалами; их тексты не скопированы.</p><ul>${sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>${s.notes?` — ${esc(s.notes)}`:''}</li>`).join('')}</ul></details>`:'';
 return `<section class="card lesson-intro" aria-label="Объяснение перед практикой"><span class="eyebrow">Сначала поймём идею</span>${lessonVisualHTML(lesson)}${sectionHTML}${laterHTML}${lessonVisualSupportHTML(lesson,{scene:false})}${exampleHTML}${recycleHTML}${start}${sourceHTML}</section>`;
}

export function bindLessonIntro(root,lesson){
 const {examples}=lessonIntroParts(lesson);
 root.querySelectorAll('[data-intro-speak]').forEach(button=>button.onclick=()=>{
  const example=examples[Number(button.dataset.introSpeak)];
  if(example)speak(example.en,.9,'en-US',{button,isCurrent:()=>button.isConnected});
 });
}
