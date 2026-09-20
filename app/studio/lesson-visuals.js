import {esc,icon} from './core.js';
import {speak} from './audio.js';
import {basicVisuals} from './visuals-basic.js';
import {advancedVisuals} from './visuals-advanced.js';

export const teachingVisuals={...basicVisuals,...advancedVisuals};
const kinds=new Set(['contrast','sequence','timeline','scale']);
const focus={
 'path-be':['am','is','are'],
 'path-articles-basic':['an','a','The'],
 'path-present-simple':['works',"doesn't",'Does','work'],
 'path-present-continuous':['am working','Are','working','work'],
 'path-questions-basic':['are','do','does'],
 'path-pronouns':['I','me','my'],
 'path-there-is':['There is','There are','Is there'],
 'path-past-simple':['did','Did',"didn't"],
 'path-past-continuous':['was','were','when'],
 'path-future-simple':['will',"won't"],
 'path-future-plans':['going to','am meeting'],
 'path-present-perfect':['finished','have finished','Have','been'],
 'path-comparatives':['smallest','smaller than','small'],
 'path-past-habits':['used to','called'],
 'path-obligation':["don't have to",'have to','should',"mustn't"],
 'path-zero-first':['If','will'],
 'path-gerund-infinitive':['want to','enjoy','am','reading'],
 'path-relative-basic':['who','that'],
 'path-connectors-basic':['because','so','but','Although'],
 'path-everyday-phrasal':['Turn off','Turn','off','it']
};
// Mark only deliberately selected whole words/phrases, never raw lesson HTML.
export function visualSentence(text,id){
 const terms=(focus[id]||[]).slice().sort((a,b)=>b.length-a.length);
 if(!terms.length)return esc(text);
 const escaped=terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const expression=new RegExp('\\b('+escaped.join('|')+')\\b','g');
 let output='',offset=0;
 for(const match of text.matchAll(expression)){
  output+=esc(text.slice(offset,match.index))+'<mark>'+esc(match[0])+'</mark>';
  offset=match.index+match[0].length;
 }
 return output+esc(text.slice(offset));
}
export function lessonDiagramHTML(lesson){
 const visual=teachingVisuals[lesson.id];if(!visual)return '';
 const kind=kinds.has(visual.kind)?visual.kind:'contrast';
 return `<section class="lesson-diagram diagram-${kind}" aria-label="Наглядное объяснение"><div class="diagram-heading"><span class="eyebrow">Сравни и пойми</span><h3>${esc(visual.title)}</h3><p>${esc(visual.why)}</p></div><ol class="diagram-items">${visual.items.map((item,i)=>`<li class="diagram-item"><div class="diagram-label"><span class="diagram-node" aria-hidden="true">${i+1}</span><strong>${esc(item.label)}</strong></div><p class="diagram-ru">${esc(item.ru)}</p><div class="diagram-answer"><div class="diagram-english"><p lang="en">${visualSentence(item.en,lesson.id)}</p><button type="button" class="btn small ghost" data-visual-speak="${i}" aria-label="Послушать пример ${i+1}: ${esc(item.en)}">${icon('sound')}</button></div><p class="diagram-note">${esc(item.note)}</p></div><p class="diagram-recall-prompt" hidden>Скажи эту мысль по-английски, затем открой пример.</p></li>`).join('')}</ol>${visual.footnote?`<p class="diagram-footnote">${esc(visual.footnote)}</p>`:''}<div class="diagram-actions"><button type="button" class="btn small secondary" data-visual-recall aria-pressed="false">Скрыть английский · вспомнить самому</button><span class="small-note">Это тренировка с опорой; результат не оценивается.</span></div></section>`;
}
export function bindLessonVisuals(root,lesson){
 const visual=teachingVisuals[lesson.id];if(!visual)return;
 root.querySelectorAll('[data-visual-speak]').forEach(button=>button.onclick=()=>{
  const item=visual.items[Number(button.dataset.visualSpeak)];
  if(item)speak(item.en,.9,'en-US',{button,isCurrent:()=>button.isConnected});
 });
 root.querySelectorAll('[data-visual-recall]').forEach(button=>button.onclick=()=>{
  const panel=button.closest('.lesson-diagram');if(!panel)return;
  const hidden=button.getAttribute('aria-pressed')!=='true';
  button.setAttribute('aria-pressed',String(hidden));
  button.textContent=hidden?'Показать английский и пояснения':'Скрыть английский · вспомнить самому';
  panel.querySelectorAll('.diagram-answer,.diagram-footnote').forEach(el=>el.hidden=hidden);
  panel.querySelectorAll('.diagram-recall-prompt').forEach(el=>el.hidden=!hidden);
 });
}
