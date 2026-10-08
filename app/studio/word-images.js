import {esc} from './core.js';
import {speak} from './audio.js';

let manifest=null,pending=null;
const forms={apples:'apple',books:'book',cats:'cat',dogs:'dog',chairs:'chair',tables:'table',doors:'door',windows:'window',keys:'key',cups:'cup',eggs:'egg',bananas:'banana',oranges:'orange',sandwiches:'sandwich',cars:'car',buses:'bus',bicycles:'bicycle',houses:'house',parks:'park',streets:'street',trains:'train',shirts:'shirt',flowers:'flower',mountains:'mountain',ships:'ship',beds:'bed',bags:'bag',trees:'tree'};
const safeURL=url=>/^https:\/\//.test(url||'')?url:'';
const aliases={airplane:'plane',couch:'sofa',sock:'socks',boot:'boots',eyeglasses:'glasses',spectacles:'glasses'};
function imageKey(word){
 const key=String(word||'').toLowerCase().trim(),base=aliases[key]||forms[key]||key;
 if(manifest?.images?.[base])return base;
 const singular=base.endsWith('ies')?base.slice(0,-3)+'y':base.endsWith('es')&&manifest?.images?.[base.slice(0,-2)]?base.slice(0,-2):base.endsWith('s')?base.slice(0,-1):base;
 return manifest?.images?.[singular]?singular:base;
}
function imageFitsContext(image,en,ru=''){
 if(!image.contextKeywords?.length)return true;
 const tokens=String(en||'').toLowerCase().match(/[a-z]+/g)||[],meaning=String(ru||'').toLowerCase();
 return image.contextKeywords.some(word=>/^[a-z]+$/.test(word)?tokens.includes(word):meaning.includes(word));
}
export function loadWordImages(){
 if(!pending)pending=fetch('/assets/words/manifest.json').then(r=>{if(!r.ok)throw Error('images unavailable');return r.json();}).then(value=>{manifest=value;return value;}).catch(()=>null);
 return pending;
}
export function wordImage(word){
 const item=manifest?.images?.[imageKey(word)];
 return item&&/^\/assets\/words\/[a-z0-9-]+\.jpg$/.test(item.src||'')?item:null;
}
export function wordImageCredit(image){
 if(!image?.license)return '';
 return `<details class="word-image-credit"><summary>Фото · ${esc(image.license)}</summary><p>${esc(image.creator)} · ${safeURL(image.sourceUrl)?`<a href="${esc(image.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(image.title||'Исходное фото')}</a>`:''} · ${safeURL(image.licenseUrl)?`<a href="${esc(image.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(image.license)}</a>`:esc(image.license)}${image.modification?` · ${esc(image.modification)}`:''}</p></details>`;
}
export function wordImageNote(image){return image?.license?[image.title,image.creator,image.sourceUrl,image.license,image.licenseUrl,image.modification].filter(Boolean).join(' · '):'';}
export function wordFigureHTML(image,{listen=true}={}){
 if(!image)return '';
 return `<figure class="word-photo"><img src="${esc(image.src)}" alt="${esc(image.alt)}" loading="lazy" width="${Number(image.width)||800}" height="${Number(image.height)||600}"><figcaption><div class="word-photo-label"><span><strong lang="en">${esc(image.label||image.word)}</strong><span>${esc(image.ru)}</span>${image.ipa?`<small>${esc(image.ipa)}</small>`:''}</span>${listen?`<button type="button" class="btn small ghost" data-word-listen="${esc(image.spoken||image.word)}" aria-label="Послушать ${esc(image.spoken||image.word)}">♪</button>`:''}</div>${wordImageCredit(image)}</figcaption></figure>`;
}
export function bindWordImages(root){root?.querySelectorAll('[data-word-listen]').forEach(button=>button.onclick=()=>speak(button.dataset.wordListen,.9,'en-US',{button,isCurrent:()=>button.isConnected}));}
export function lexicalWordImage(entry,context){
 const image=wordImage(entry.word);if(!image||['three','back','bad-apple'].includes(image.word))return null;
 const sense=entry.senses?.find(s=>s.id===context?.senseId);
 // Match the taught meaning, not a homonym (ship code, orange color, fish verb).
 const meaning=[context?.meaningRu,context?.ru].filter(Boolean).join(' ').toLowerCase();
 if(!image.meaningStems?.some(stem=>meaning.includes(stem)))return null;
 if(!imageFitsContext(image,context?.en,meaning))return null;
 if(sense?.pos&&!/noun|n\.|числ|сущ/i.test(sense.pos)&&!['rain','sun'].includes(image.word))return null;
 return {...image,alt:image.alt,associationRu:image.ru,contextId:context?.id};
}
function wordsIn(text){return [...new Set((String(text||'').toLowerCase().match(/[a-z]+/g)||[]).map(imageKey))];}
export function lessonWordImagesHTML(lesson,exercise=null){
 if(!manifest)return '';
 const pairs=manifest.minimalPairs?.[lesson.id];
 let items;
 if(pairs&&!exercise)items=pairs.flat().map(wordImage).filter(Boolean);
 else {
  if(!['A1','A2'].includes(lesson.level))return '';
  const text=exercise?[exercise.prompt,exercise.context,exercise.guidance?.example].filter(Boolean).join(' '):[...(lesson.examples||[]).map(e=>e.en),...(lesson.courseGuide?.examples||[]).map(e=>e.en)].join(' ');
  items=wordsIn(text).map(wordImage).filter(image=>image&&!['back','three','bad-apple'].includes(image.word)&&imageFitsContext(image,text)).slice(0,exercise?2:4);
 }
 if(!items.length)return '';
 return `<section class="lesson-word-images" aria-label="Слова в картинках"><p class="small-note">${pairs&&!exercise?'Послушай слова в парах: похожее звучание, разный смысл.':'Свяжи слово с предметом и послушай, как оно звучит.'}</p><div class="word-photo-grid">${items.map(item=>wordFigureHTML(item)).join('')}</div></section>`;
}
