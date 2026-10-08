import {esc,icon} from './core.js';
import {speak} from './audio.js';
import {lessonDiagramHTML,bindLessonVisuals,lessonTeachingVisual} from './lesson-visuals.js';
import {expandedLessonScene} from './lesson-scenes.js';

const scenes={
 states:{file:'be-states-scene.png',alt:'Слева девушка с ключами и рюкзаком готова выйти; справа она устало зевает на диване.',title:'Готова выйти — или устала?',en:'I am ready. I am tired.',ru:'Я готова. Я устала.',panels:[['I am ready.','Я готова.'],['I am tired.','Я устала.']],why:'Она ничего не делает — она говорит, какая она сейчас. Это состояние, поэтому после I стоит am. По-русски на этом месте пусто, а в английском без am нельзя.'},
 place:{file:'prepositions-scene.png',alt:'Одна и та же кружка внутри открытого шкафчика, на нём и под ним: три отдельных примера слева направо.',title:'Предмет тот же, место разное',en:'The cup is in the cabinet. The cup is on the cabinet. The cup is under the cabinet.',ru:'Кружка в шкафчике. Кружка на шкафчике. Кружка под шкафчиком.',panels:[['The cup is in the cabinet.','Кружка в шкафчике.'],['The cup is on the cabinet.','Кружка на шкафчике.'],['The cup is under the cabinet.','Кружка под шкафчиком.']],why:'Слева направо: in — внутри; on — на поверхности; under — ниже предмета, под ним. Cup — кружка, cabinet — шкафчик. Маленькое слово меняет место, которое мы представляем.'},
 count:{file:'countability-scene.png',alt:'Слева одно яблоко, в середине три яблока, справа вода, которую наливают в стакан.',title:'Яблоки можно посчитать, воду — нет',en:'An apple. Three apples. Some water.',ru:'Одно яблоко. Три яблока. Немного воды.',panels:[['An apple.','Одно яблоко.'],['Three apples.','Три яблока.'],['Some water.','Немного воды.']],why:'Слева одно яблоко — an apple. В центре три — three apples: яблоки считают по одному, и у слова появляется -s. Справа воду наливают в стакан: её по одной не посчитаешь. Поэтому не говорят a water или three waters. Вместо числа ставят some: some water — немного воды.'},
 size:{file:'comparatives-scene.png',alt:'Три растения в одинаковых горшках: невысокое, выше и самое высокое, слева направо.',title:'Высокое → выше → самое высокое',en:'This plant is tall. That plant is taller. The last plant is the tallest.',ru:'Это растение высокое. То растение выше. Последнее растение — самое высокое.',panels:[['This plant is tall.','Это растение высокое.'],['That plant is taller.','То растение выше.'],['The last plant is the tallest.','Последнее — самое высокое.']],why:'Plant — растение. Taller сравнивает высоту с другим растением. The tallest выделяет самое высокое из трёх. Сравнение описывает именно высоту: картинка ничего не говорит о возрасте растений.'},
 habit:{file:'habit-now-scene.png',alt:'Слева три повторяющиеся сцены утреннего чтения; справа крупно показан один текущий момент чтения.',title:'Каждое утро — или прямо сейчас',en:'I read every morning. I am reading now.',ru:'Я читаю каждое утро. Я сейчас читаю.',panels:[['I read every morning.','Я читаю каждое утро.'],['I am reading now.','Я сейчас читаю.']],why:'Слева три маленьких кадра — три разных утра. Она каждый раз читает в кресле: это привычка, every morning — «каждое утро». Здесь просто read, без am. Справа один крупный кадр — то, что идёт прямо сейчас: now — «сейчас». Здесь read превращается в am reading: впереди am, на конце -ing.'},
 past:{file:'past-interrupted-scene.png',alt:'Слева человек уже вымыл посуду. Справа он ещё моет тарелку, когда звонит телефон.',title:'Закончил дело — или был в процессе',en:'I washed the dishes. I was washing the dishes when the phone rang.',ru:'Я вымыл посуду. Я мыл посуду, когда зазвонил телефон.',panels:[['I washed the dishes.','Я вымыл посуду.'],['I was washing the dishes when the phone rang.','Я мыл посуду, когда зазвонил телефон.']],why:'Слева — завершённое дело в прошлом: washed. Справа — процесс в тот момент: was washing. Rang — прошедшая форма ring, «зазвонил». Мы знаем, что звонок застал его за мытьём, но сама фраза не говорит, перестал ли он мыть посуду.'},
 articles:{file:'articles-scene.png',alt:'В кафе сначала показывают яблоко, затем указывают на уже знакомое яблоко.',title:'Первый раз — an apple, потом — the apple',en:'It is an apple. The apple is red.',ru:'Это яблоко. Яблоко красное.',panels:[['It is an apple.','Это яблоко.'],['The apple is red.','Яблоко красное.']],why:'Слева яблоко показывают впервые: It is an apple — «это яблоко». Собеседник его ещё не видел, поэтому перед apple стоит an — это тот же a, просто apple начинается с гласного звука. Справа речь о том же яблоке: The apple is red — «яблоко красное». Теперь оба знают, какое яблоко, поэтому the.'},
 time:{file:'time-scene.png',alt:'Слева человек ещё красит стул, справа стул уже покрашен.',title:'Процесс и готовый результат',en:'He is painting the chair. He has painted the chair.',ru:'Он красит стул. Он покрасил стул.',panels:[['He is painting the chair.','Он красит стул.'],['He has painted the chair.','Он покрасил стул.']],why:'Слева работа идёт сейчас: is painting. Справа работа завершена, и мы видим результат: has painted. Это разные взгляды на действие; готовый результат — один из случаев Present Perfect.'},
 perspective:{file:'perspective-scene.png',alt:'Свет под дверью и две возможные причины: человек дома или свет оставили включённым.',title:'Что вижу — и что только предполагаю',en:'The light is on. She might be home.',ru:'Свет горит. Возможно, она дома.',why:'Горящий свет — наблюдение. Вывод о человеке — предположение: might оставляет место другой причине. Если бы мы сказали She is home, это звучало бы как уверенное утверждение.'}
};
const mapped={
 'path-be':'states','path-place-time':'place','path-countability':'count','path-plurals':'count',
 'path-comparatives':'size','comparison':'size','path-present-continuous':'habit','present':'habit','path-past-continuous':'past',
 'path-articles-basic':'articles','articles':'articles','path-articles-advanced':'articles',
 'path-present-perfect':'time','present-perfect':'time','path-present-perfect-continuous':'time',
 'path-deduction':'perspective','modals-deduction':'perspective'
};
// Light copies of the scenes for cards and banners; the lesson keeps the full image.
export const scenePoster=scene=>'/assets/posters/'+String(scene.file).replace(/\.png$/,'.jpg');
// A short English label for a lesson without a scene: the English term from its
// title ("I, me, my"), or its shortest example when that fits a poster whole.
export function posterWord(lesson){
 const terms=String(lesson?.title||'').match(/[A-Za-z][A-Za-z'’.\-]*(?:(?:,\s*|\s+|\s*\/\s*|\s*→\s*|\s+и\s+)[A-Za-z'’.\-]+)*/g)||[];
 const term=terms.sort((a,b)=>b.length-a.length)[0]||'';
 if(term.length>1&&term.length<=22)return term.replace(/\s+и\s+/g,' · ');
 const example=(lesson?.examples||[]).map(x=>x?.en).filter(Boolean).sort((a,b)=>a.length-b.length)[0]||'';
 return example.length<=24?example:'';
}
export function lessonVisual(lesson){
 const expanded=expandedLessonScene(lesson);if(expanded)return expanded;
 if(lesson.id==='path-plurals')return {...scenes.count,en:'One apple. Three apples.',ru:'Одно яблоко. Три яблока.',title:'Одно яблоко — apple, три яблока — apples',panels:[['One apple.','Одно яблоко.'],['Three apples.','Три яблока.'],['','']],why:'Слева одно яблоко: one apple. В середине три яблока: three apples — к apple добавилось -s, потому что яблок больше одного. Справа вода: её не считают по штукам, поэтому к water -s не добавляют. О таких словах — отдельный урок.'};
 if(lesson.id==='path-present-perfect-continuous')return {...scenes.time,en:'He has been painting the chair. He has painted the chair.',ru:'Он уже некоторое время красит стул. Он покрасил стул.',panels:[['He has been painting the chair.','Он уже некоторое время красит стул.'],['He has painted the chair.','Он покрасил стул.']],why:'В первом случае выделяем процесс, начавшийся раньше: has been painting. Во втором — завершённый результат: has painted. Первая фраза сама по себе не обещает, что стул уже готов.'};
 const key=mapped[lesson.id];return key?scenes[key]:null;
}
export function lessonVisualHTML(lesson){
 const s=lessonVisual(lesson);if(!s)return '';
 if(s.association){
  const meaning=s.panels?.length?`<div class="course-scene-labels">${s.panels.map(([en,ru])=>`<div><p lang="en">${esc(en)}</p><p>${esc(ru)}</p></div>`).join('')}</div>`:`<div><p lang="en">${esc(s.en)}</p><p>${esc(s.ru)}</p></div>`;
  return `<figure class="course-visual course-scene-association"><div class="course-visual-frame"><img src="/assets/course-scenes/${esc(s.file)}" alt="${esc(s.alt)}" loading="lazy" width="${Number(s.width)||1536}" height="${Number(s.height)||1024}"></div><figcaption>${meaning}<button type="button" class="btn small ghost" data-scene-speak aria-label="Послушать подпись к иллюстрации">${icon('sound')}</button></figcaption></figure>`;
 }
 // A scene of several panels gets one subtitle under each panel and, below,
 // each English line paired with its translation, so nothing has to be matched by guesswork.
 const panels=s.panels||[],sides=panels.length===3?['Слева','В центре','Справа']:['Слева','Справа'];
 const subtitles=panels.length?`<div class="course-visual-panels" style="--panels:${panels.length}">${panels.map(([en])=>`<span>${en?`<p class="course-visual-subtitle" lang="en">${esc(en)}</p>`:''}</span>`).join('')}</div>`:`<p class="course-visual-subtitle" lang="en">${esc(s.en)}</p>`;
 const meaning=panels.length?`<ol class="course-visual-pairs">${panels.filter(([en])=>en).map(([en,ru],i)=>`<li><small>${sides[i]}</small><p lang="en">${esc(en)}</p><p>${esc(ru)}</p></li>`).join('')}</ol>`:`<p>${esc(s.ru)}</p>`;
 return `<figure class="course-visual${panels.length?' has-panels':''}"><div class="course-visual-frame"><img src="/assets/course-scenes/${s.file}" alt="${esc(s.alt)}" loading="lazy" width="1536" height="1024">${subtitles}</div><figcaption><h3>${esc(s.title)}</h3><div class="diagram-english"><p lang="en">${esc(s.en)}</p><button type="button" class="btn small ghost" data-scene-speak aria-label="Послушать подпись к иллюстрации">${icon('sound')}</button></div>${meaning}<p class="small-note">${esc(s.why)}</p></figcaption></figure>`;
}
export function lessonVisualSupportHTML(lesson,{scene:withScene=true}={}){
 const diagram=lessonDiagramHTML(lesson),scene=withScene?lessonVisualHTML(lesson):'';if(!diagram&&!scene)return '';
 const count=lessonTeachingVisual(lesson)?.items.length;
 return `<details class="course-visual-support"><summary><span>Разобраться наглядно</span><small>${count?`Схема · ${count} примера${scene?' · иллюстрация':''}`:'Иллюстрация с объяснением'}</small></summary><div class="course-visual-support-body">${scene}${diagram}</div></details>`;
}
export function courseGuideHTML(lesson,index=0){
 const g=lesson.courseGuide;if(!g)return lessonVisualSupportHTML(lesson);
 return `<details class="course-guide card" ${index===0?'open':''}><summary>Сначала понять: ${esc(lesson.title)}</summary><div class="course-guide-content"><p class="course-purpose">${esc(g.purpose)}</p>${g.explanation.map((s,i)=>`<section><span class="eyebrow">${String(i+1).padStart(2,'0')}</span><h2>${esc(s.title)}</h2><p>${esc(s.body)}</p></section>`).join('')}${lessonVisualSupportHTML(lesson)}<section><h2>Посмотри, как меняется смысл</h2>${g.examples.map((e,i)=>`<div class="course-example"><div class="spread"><p lang="en">${esc(e.en)}</p><button type="button" class="btn small ghost" data-guide-speak="${i}" aria-label="Послушать пример ${i+1}">${icon('sound')}</button></div><p>${esc(e.ru)}</p><p class="small-note">${esc(e.why)}</p></div>`).join('')}</section>${g.sources?.length?`<details class="course-sources"><summary>На чём основано объяснение</summary><p class="small-note">Объяснения и упражнения написаны для этого курса. Источники помогают проверить правило и способ подачи.</p><ul>${g.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>${s.notes?`<p class="small-note">${esc(s.notes)}</p>`:''}</li>`).join('')}</ul></details>`:''}</div></details>`;
}
export function bindCourseGuide(root,lesson){
 bindLessonVisuals(root,lesson);
 root.querySelectorAll('[data-scene-speak]').forEach(button=>button.onclick=()=>speak(lessonVisual(lesson).en,.9,'en-US',{button,isCurrent:()=>button.isConnected}));
 root.querySelectorAll('[data-guide-speak]').forEach(button=>button.onclick=()=>speak(lesson.courseGuide.examples[+button.dataset.guideSpeak].en,.9,'en-US',{button,isCurrent:()=>button.isConnected}));
}
