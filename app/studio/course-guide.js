import {esc,icon} from './core.js';
import {speak} from './audio.js';
import {lessonDiagramHTML,bindLessonVisuals,teachingVisuals} from './lesson-visuals.js';

const scenes={
 states:{file:'be-states-scene.png',alt:'Слева девушка с ключами и рюкзаком готова выйти; справа она устало зевает на диване.',title:'Выходим — или лучше отдохнуть?',en:'I am ready. I am tired.',ru:'Я готова. Я устала.',why:'Слева она готова выйти, справа хочет отдохнуть. В обеих фразах говорим о её состоянии. Почему здесь появляется am? Разберём ниже.'},
 place:{file:'prepositions-scene.png',alt:'Одна и та же кружка внутри открытого шкафчика, на нём и под ним: три отдельных примера слева направо.',title:'Предмет тот же, место разное',en:'The cup is in the cabinet. The cup is on the cabinet. The cup is under the cabinet.',ru:'Кружка в шкафчике. Кружка на шкафчике. Кружка под шкафчиком.',why:'Слева направо: in — внутри; on — на поверхности; under — ниже предмета, под ним. Cup — кружка, cabinet — шкафчик. Маленькое слово меняет место, которое мы представляем.'},
 count:{file:'countability-scene.png',alt:'Слева одно яблоко, в середине три яблока, справа вода, которую наливают в стакан.',title:'Яблоки считаем по одному, воду измеряем',en:'An apple. Three apples. Some water.',ru:'Одно яблоко. Три яблока. Немного воды.',why:'Яблоки — отдельные предметы: apple → apples. Water обозначает вещество, поэтому здесь не three waters. Можно посчитать стаканы: three glasses of water — три стакана воды. В кафе waters иногда означает порции воды; это другой контекст.'},
 size:{file:'comparatives-scene.png',alt:'Три растения в одинаковых горшках: невысокое, выше и самое высокое, слева направо.',title:'Высокое → выше → самое высокое',en:'This plant is tall. That plant is taller. The last plant is the tallest.',ru:'Это растение высокое. То растение выше. Последнее растение — самое высокое.',why:'Plant — растение. Taller сравнивает высоту с другим растением. The tallest выделяет самое высокое из трёх. Сравнение описывает именно высоту: картинка ничего не говорит о возрасте растений.'},
 habit:{file:'habit-now-scene.png',alt:'Слева три повторяющиеся сцены утреннего чтения; справа крупно показан один текущий момент чтения.',title:'Так обычно бывает — или это происходит сейчас',en:'I read every morning. I am reading now.',ru:'Я читаю каждое утро. Я сейчас читаю.',why:'Слева повторение сцен обозначает привычку: every morning — каждое утро. Справа один момент: now — сейчас. Для этого момента нужны am и reading. По одному снимку привычку не узнать; здесь её специально показывают несколько кадров.'},
 past:{file:'past-interrupted-scene.png',alt:'Слева человек уже вымыл посуду. Справа он ещё моет тарелку, когда звонит телефон.',title:'Закончил дело — или был в процессе',en:'I washed the dishes. I was washing the dishes when the phone rang.',ru:'Я вымыл посуду. Я мыл посуду, когда зазвонил телефон.',why:'Слева — завершённое дело в прошлом: washed. Справа — процесс в тот момент: was washing. Rang — прошедшая форма ring, «зазвонил». Мы знаем, что звонок застал его за мытьём, но сама фраза не говорит, перестал ли он мыть посуду.'},
 articles:{file:'articles-scene.png',alt:'В кафе сначала показывают яблоко, затем указывают на уже знакомое яблоко.',title:'Сначала знакомим, потом узнаём',en:'It is an apple. The apple is red.',ru:'Это яблоко. Это яблоко красное.',why:'an apple — вводим один предмет. the apple — собеседник уже понимает, какое именно яблоко имеется в виду.'},
 time:{file:'time-scene.png',alt:'Слева человек ещё красит стул, справа стул уже покрашен.',title:'Процесс и готовый результат',en:'He is painting the chair. He has painted the chair.',ru:'Он красит стул. Он покрасил стул.',why:'Слева работа идёт сейчас: is painting. Справа работа завершена, и мы видим результат: has painted. Это разные взгляды на действие; готовый результат — один из случаев Present Perfect.'},
 perspective:{file:'perspective-scene.png',alt:'Свет под дверью и две возможные причины: человек дома или свет оставили включённым.',title:'Что вижу — и что только предполагаю',en:'The light is on. She might be home.',ru:'Свет горит. Возможно, она дома.',why:'Горящий свет — наблюдение. Вывод о человеке — предположение: might оставляет место другой причине. Если бы мы сказали She is home, это звучало бы как уверенное утверждение.'}
};
const mapped={
 'path-be':'states','path-place-time':'place','path-countability':'count','path-plurals':'count',
 'path-comparatives':'size','comparison':'size','path-present-continuous':'habit','present':'habit','path-past-continuous':'past',
 'path-articles-basic':'articles','articles':'articles','path-articles-advanced':'articles',
 'path-present-perfect':'time','present-perfect':'time','path-present-perfect-continuous':'time',
 'path-deduction':'perspective','modals-deduction':'perspective'
};
export function lessonVisual(lesson){
 if(lesson.id==='path-plurals')return {...scenes.count,en:'One apple. Three apples.',ru:'Одно яблоко. Три яблока.',why:'Сравни две части слева: один предмет — apple, несколько — apples. Справа вода: её не считают по одной штуке. Как говорить о воде, разберём отдельно в теме исчисляемых и неисчисляемых слов.'};
 if(lesson.id==='path-present-perfect-continuous')return {...scenes.time,en:'He has been painting the chair. He has painted the chair.',ru:'Он уже некоторое время красит стул. Он покрасил стул.',why:'В первом случае выделяем процесс, начавшийся раньше: has been painting. Во втором — завершённый результат: has painted. Первая фраза сама по себе не обещает, что стул уже готов.'};
 const key=mapped[lesson.id];return key?scenes[key]:null;
}
export function lessonVisualHTML(lesson){
 const s=lessonVisual(lesson);if(!s)return '';
 return `<figure class="course-visual"><img src="/assets/course-scenes/${s.file}" alt="${esc(s.alt)}" loading="lazy" width="1536" height="1024"><figcaption><h3>${esc(s.title)}</h3><div class="diagram-english"><p lang="en">${esc(s.en)}</p><button type="button" class="btn small ghost" data-scene-speak aria-label="Послушать подпись к иллюстрации">${icon('sound')}</button></div><p>${esc(s.ru)}</p><p class="small-note">${esc(s.why)}</p></figcaption></figure>`;
}
export function lessonVisualSupportHTML(lesson){
 const diagram=lessonDiagramHTML(lesson),scene=lessonVisualHTML(lesson);if(!diagram&&!scene)return '';
 const count=teachingVisuals[lesson.id]?.items.length;
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
