import {$,$$,esc,icon,api,toast,busy,uid,dateKey,formatDate,words,getDraft,queueDraft,feedbackHTML,bindMistakes,cardModal,empty,mediaURL,openModal,progressLesson,clipUTF8} from './core.js';
import {voice,speak,stopAudio} from './audio.js';
import {mountVoiceSettings} from './voice-settings.js';
const heading=(title,sub,extra='')=>`<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${extra}</div>`;
const passages=[
 {title:'A different kind of morning',text:"For years, Nina checked her phone before getting out of bed. By the time she started work, she already felt tired. Last month she decided to try something different. She left her phone in the kitchen and put a book beside her bed. At first, she found it difficult to resist checking messages. After a week, however, she began to enjoy the quiet. She hasn't stopped using social media, but she no longer lets it decide how her day begins. The biggest surprise was that she didn't need more free time. She just needed to use the first twenty minutes differently.",task:'Почему Нина изменила привычку? Что было труднее всего и какой вывод она сделала? Ответь по-английски, затем опиши похожую перемену в своей жизни.'},
 {title:'The repair café',text:"When a small repair café opened in his neighbourhood, Daniel assumed it was a shop. He took his broken lamp there and asked how much the repair would cost. Instead of giving him a price, a volunteer handed him a screwdriver. The idea was to teach people to fix their own things. Daniel was nervous because he had never repaired anything electrical before. With the volunteer's help, he discovered that a loose connection was causing the problem. An hour later, he walked home with a working lamp and a skill he hadn't expected to learn. He returned the following weekend, this time to help someone repair a bicycle.",task:'Чем кафе оказалось не похоже на магазин? Чему научился Дэниел и почему вернулся? Перескажи историю в 60–90 словах без копирования.'},
 {title:'A four-day experiment',text:"A small design company tested a four-day working week for three months. Employees received the same salary, but meetings were limited to twenty minutes and everyone agreed to check email only three times a day. At the end of the trial, the team had completed almost as many projects as before. Staff reported feeling less exhausted. However, some clients found it frustrating that nobody answered calls on Fridays. The company decided to keep the shorter week but introduce a rotating Friday schedule. The experiment didn't remove every problem. It helped the team identify which habits were actually wasting time.",task:'Какие изменения сопровождали сокращённую неделю? Какую проблему заметили клиенты и как её решили? Дай собственную оценку эксперимента, опираясь на факты.'}
];
const modes=[['writing','pen','Письмо'],['speaking','mic','Разговор'],['reading','book','Чтение'],['listening','sound','Аудирование'],['vocabulary','cards','Активный словарь'],['translation','loop','Перевод мысли']];
const tasks={
 writing:[
  ['Письмо с конкретной целью','Напиши 120–180 слов: ты записался на курс, но расписание изменилось и теперь тебе не подходит. Объясни ситуацию, предложи два решения и задай уточняющий вопрос.'],
  ['Твоя позиция','Напиши 150–200 слов: нужно ли запрещать смартфоны на рабочих встречах? Дай позицию, два аргумента, пример и возражение.'],
  ['История из жизни','Расскажи в 120–180 словах о решении, которое сначала казалось ошибкой, но привело к хорошему результату. Используй конкретные детали.']
 ],
 speaking:[
  ['Разговор после знакомства','You have just met a new colleague. Tell them about a skill you are learning outside work, explain why it interests you, and ask about their hobbies. Speak for 60–90 seconds.'],
  ['Объясни и договорись','Your friend wants to take an expensive holiday, but you have a smaller budget. Explain your concerns, suggest an alternative, and ask what matters most to them.'],
  ['Мнение с аргументом','Would you rather live in a large city or a small town? Explain your preference, give a personal example, and acknowledge one disadvantage.']
 ],
 vocabulary:[
  ['Из памяти — в предложение','Напиши связный рассказ на 80–120 слов, используя make progress, run out of time, figure out, take responsibility и reliable. Ситуация должна быть правдоподобной.'],
  ['Объясни без перевода','Объясни по-английски 5 слов: deadline, habit, evidence, opportunity, confident. Для каждого дай свой пример.'],
  ['Слова из твоей жизни','Выбери 5 выражений из своих карточек. Напиши с ними связную историю и 3 вопроса, которые можно задать собеседнику.']
 ],
 translation:[
  ['Объясни ситуацию','Я работаю над этим проектом уже три недели. Обычно всё идёт по плану, но вчера появилась неожиданная проблема. Если мы не найдём решение к пятнице, придётся перенести встречу с клиентом.'],
  ['Передай оттенок мысли','Я бы с удовольствием присоединился, но у меня уже есть планы. Может быть, перенесём встречу на следующую неделю? Мне не обязательно работать в четверг, так что я смогу приехать пораньше.'],
  ['Расскажи о перемене','Раньше я думал, что для изучения языка достаточно запоминать правила. Теперь я понимаю, что нужно каждый день выражать собственные мысли, даже если я делаю ошибки.']
 ]
};
export function restorePracticeTask(raw){
 try{const t=JSON.parse(raw);return t&&typeof t.id==='string'&&typeof t.title==='string'&&typeof t.prompt==='string'&&t.prompt.trim()?{...t,passage:typeof t.passage==='string'?t.passage:'',conversation:Array.isArray(t.conversation)?t.conversation.slice(-6):[]}:null;}catch{return null;}
}
export function practiceTaskIndex(raw,count){const n=Number(raw);return Number.isSafeInteger(n)&&n>=0?n%count:0;}
export function plannedPractice(raw,mode,day,blockId){
 try{const plan=JSON.parse(raw),block=plan?.blocks?.find(b=>b.id===blockId),task=restorePracticeTask(JSON.stringify(block?.practiceTask));
  return /^\d{4}-\d{2}-\d{2}$/.test(day)&&plan.version===1&&plan.day===day&&task&&task.mode===mode&&modes.some(m=>m[0]===mode)?{day,blockId,task}:null;
 }catch{return null;}
}
export function mountPractice(root,data,mode,refresh,planned=null){
 if(!modes.some(m=>m[0]===mode))mode='writing';let index=practiceTaskIndex(getDraft('practice-index:'+mode,data.state),tasks[mode]?.length||passages.length),conversation=[],currentPrompt='',source='',requestID=uid(),currentMode=mode==='speaking'?'writing':mode,taskVersion=0;
 const taskStoreKey=planned?'planner:practice:'+planned.day+':'+planned.blockId:'practice-task:'+mode;
 let generated=planned?.task||restorePracticeTask(getDraft(taskStoreKey,data.state));
 let selectedLevel=generated?.level||getDraft('practice-level',data.state)||'B1';
 if(!['A1','A2','B1','B2','C1','C2'].includes(selectedLevel))selectedLevel='B1';
 root.innerHTML=heading('Здесь говоришь ты.','Полные мысли, реальные ситуации и обратная связь по делу.')+`
 <div class="practice-layout"><aside class="card practice-menu">${modes.map(([m,i,t])=>`<button data-mode="${m}" class="${m===mode?'active':''}">${icon(i)}${t}</button>`).join('')}<p>Меняй формат в течение дня.<br>Понимание становится навыком, когда ты используешь язык сам.</p></aside>
 <section class="card" id="practice-work"></section></div>`;
 $$('[data-mode]').forEach(b=>b.onclick=()=>location.hash='/practice/'+b.dataset.mode);
 function draw(){
  taskVersion++;
  const inputMode=mode==='reading'||mode==='listening',p=passages[index%passages.length],task=generated?[generated.title,generated.prompt]:inputMode?[p.title,p.task]:tasks[mode][index%tasks[mode].length];
  currentPrompt=task[1];source=generated?generated.passage||'':inputMode?p.text:'';conversation=generated?.conversation||[];requestID=uid();currentMode=mode==='speaking'?'writing':mode;const key=`free:${mode}:${generated?.id||index}`;
  $('#practice-work').innerHTML=`<div class="spread" style="margin-bottom:22px"><span class="eyebrow" style="margin:0">${esc(task[0])}</span><button class="btn small" id="new-task">${icon('loop')} Другое задание</button></div>
   ${inputMode?`<div class="actions" style="margin-bottom:18px"><button class="btn" id="listen">${icon('sound')} Прослушать</button><button class="btn ghost small" id="toggle-source">${mode==='listening'?'Показать текст':'Скрыть текст'}</button><select id="speech-rate" aria-label="Скорость речи"><option value=".75">0.75×</option><option value=".9" selected>0.9×</option><option value="1">1×</option></select></div><div class="reading-text" id="passage" ${mode==='listening'?'hidden':''}>${esc(source)}</div><p class="small-note">${mode==='listening'?'Сначала послушай без текста. Здесь используется синтез речи; живые записи — в медиатеке.':'Прочитай целиком, выдели главную мысль, затем сформулируй ответ без копирования.'}</p>`:''}
   ${planned&&!inputMode&&source?`<details class="planned-source" open><summary>Материал для задания</summary><div class="reading-text">${esc(source)}</div></details>`:''}
   <div class="prompt" id="practice-prompt">${esc(currentPrompt)}</div>
   <details id="custom-task-panel" style="margin:20px 0"><summary class="small-note" style="cursor:pointer">Своя задача или материал из учебника</summary><div class="spacer"></div>
   <div class="field"><label for="custom-task">Что ты хочешь написать или отработать</label><textarea id="custom-task" rows="2" placeholder="Впиши собственное задание…"></textarea></div>
   <div class="field"><label for="custom-context">Исходный текст для проверки смысла (необязательно)</label><textarea id="custom-context" rows="4" placeholder="Отрывок, субтитры или контекст ситуации">${esc(getDraft('source-context',data.state))}</textarea><small>Материал будет передан выбранному помощнику вместе с ответом.</small></div><button class="btn small" id="apply-task">Использовать это задание</button></details>
   <div class="field"><div class="answer-input-header"><label for="answer">${mode==='translation'?'Передай мысль на английском':'Твой ответ на английском'}</label><button type="button" id="voice" class="btn" aria-controls="answer">${icon('mic')} Надиктовать ответ</button></div><textarea id="answer" class="answer-area" rows="${mode==='writing'?10:7}" spellcheck="false" placeholder="${mode==='speaking'?'Нажми «Надиктовать ответ» или начни писать…':'Начни с собственной мысли…'}">${esc(getDraft(key,data.state))}</textarea></div>
   <div class="answer-meta"><span id="word-count"></span><span>Ctrl + Enter — проверить</span></div>
   <div class="exercise-actions"><div class="actions"><button id="read-answer" class="btn ghost small" aria-label="Прослушать свой текст">${icon('sound')}</button></div><button id="check" class="btn primary">Получить разбор ${icon('arrow')}</button></div>
   <audio class="audio-preview" id="audio-preview" controls hidden></audio><p class="small-note" style="margin-top:15px">Запись можно прослушать до ухода со страницы. Расшифровка и разбор сохраняются в журнале; оценка произношения по тексту не выставляется.</p>
   <div id="feedback"></div><div id="followup"></div>`;
  if(planned)$('#practice-work').insertAdjacentHTML('afterbegin',`<p class="small-note"><a href="#/today">${icon('back')} План на ${esc(new Date(planned.day+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'}))}</a> · ${esc(planned.task.level)}</p>`);
  if(!planned)$('#practice-work').insertAdjacentHTML('afterbegin',`<div class="practice-task-controls"><select id="practice-level" aria-label="Уровень нового задания">${['A1','A2','B1','B2','C1','C2'].map(l=>`<option ${l===selectedLevel?'selected':''}>${l}</option>`).join('')}</select><input id="task-topic" placeholder="Интересы: работа, кино, путешествия…" aria-label="Тема нового задания"><button class="btn small" id="ai-task">${icon('spark')} Новая ситуация</button></div><p class="small-note">Уровень применяется к новой ситуации. ${generated?`Текущее задание: ${esc(generated.level||'B1–B2')}.`:'Сохранённые примеры рассчитаны на B1–B2.'}</p>`);
  if($('#practice-level'))$('#practice-level').onchange=e=>{selectedLevel=e.target.value;queueDraft('practice-level',selectedLevel);};
  const target=$('#answer'),onText=()=>{queueDraft(key,target.value);$('#word-count').textContent=words(target.value)+' слов';requestID=uid();$('#feedback').innerHTML='';$('#followup').innerHTML='';};$('#word-count').textContent=words(target.value)+' слов';target.oninput=()=>{currentMode=mode==='speaking'?'writing':mode;onText();};
  $('#new-task').hidden=!!planned;$('#custom-task-panel').hidden=!!planned;
  $('#new-task').onclick=()=>{stopAudio();generated=null;queueDraft(taskStoreKey,'');index=(index+1)%(tasks[mode]?.length||passages.length);queueDraft('practice-index:'+mode,String(index));draw();};
  if($('#ai-task'))$('#ai-task').onclick=ev=>busy(ev.currentTarget,async()=>{stopAudio();const version=taskVersion,payload={mode,level:selectedLevel,topic:$('#task-topic').value.trim()};await queueDraft(key,target.value,true);const result=await api('/practice/task',payload);if(!root.isConnected||version!==taskVersion)return;generated=result;await queueDraft(taskStoreKey,JSON.stringify(generated),true);if(!root.isConnected||version!==taskVersion)return;draw();toast('Новая ситуация готова. Задание сохранено.');},'Готовим ситуацию…');
  $('#apply-task').onclick=()=>{stopAudio();const custom=$('#custom-task').value.trim(),context=$('#custom-context').value.trim();generated={id:uid(),title:'Твоя задача',prompt:custom||currentPrompt,passage:context,level:generated?.level||'B1'};queueDraft('source-context',context);queueDraft(taskStoreKey,JSON.stringify(generated));draw();toast('Задание и контекст сохранены.');};
  const previous=data.state.attempts?.filter(a=>a.lessonId==='free'&&a.exerciseId===`${mode}-${generated?.id||index}`).at(-1);
  if(previous&&previous.answer===target.value){$('#feedback').innerHTML=feedbackHTML(previous);bindMistakes($('#feedback'));}
  $('#voice').onclick=ev=>voice(ev.currentTarget,target,data.settings,()=>{currentMode='speaking';onText();});
  $('#read-answer').onclick=()=>speak(target.value);
  if($('#listen'))$('#listen').onclick=()=>speak(source,+$('#speech-rate').value);
  if($('#toggle-source'))$('#toggle-source').onclick=()=>{const el=$('#passage');el.hidden=!el.hidden;$('#toggle-source').textContent=el.hidden?'Показать текст':'Скрыть текст';};
  $('#check').onclick=ev=>busy(ev.currentTarget,async()=>{
   if(target.value.trim().length<2)throw Error('Напиши ответ или воспользуйся микрофоном.');const submitted=target.value,payload={id:requestID,lessonId:'free',exerciseId:`${mode}-${generated?.id||index}`,prompt:currentPrompt,context:clipUTF8(source+'\n'+JSON.stringify(conversation.slice(-6)),16000),answer:submitted,mode:currentMode,level:generated?.level||'B1'};stopAudio();await queueDraft(key,submitted,true);
   const a=await api('/check',payload);
   await refresh();if($('#answer')!==target||target.value!==submitted){toast('Разбор предыдущей версии сохранён в журнале.');return;}
   $('#feedback').innerHTML=feedbackHTML(a);bindMistakes($('#feedback'));conversation.push({question:currentPrompt,answer:target.value});
   $('#followup').innerHTML=a.feedback.followUp?`<div class="followup"><div class="eyebrow">Продолжим мысль</div><p>${esc(a.feedback.followUp)}</p><div class="actions"><button class="btn small" id="respond">Ответить ${icon('arrow')}</button><button class="btn small ghost" id="listen-question">${icon('sound')} Послушать</button></div></div>`:'';
   if($('#respond'))$('#respond').onclick=()=>{stopAudio();generated={id:uid(),title:'Продолжение разговора',prompt:a.feedback.followUp,passage:source,level:generated?.level||'B1',conversation:conversation.slice(-6)};queueDraft(taskStoreKey,JSON.stringify(generated));draw();$('#answer').focus();};
   if($('#listen-question'))$('#listen-question').onclick=()=>speak(a.feedback.followUp);
  },'Читаем и разбираем…');
  target.onkeydown=ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();$('#check').click();}};
 }
 draw();
}
export function mountReview(root,data,refresh){
 let reveal=false,reviewID=uid(),shownCardID='',queue=data.state.cards.filter(c=>Date.parse(c.due)<=Date.now()).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due)),finished=0;
 root.innerHTML=heading('Вспомнить. Сказать. Сохранить.','Сначала русский смысл. Затем твой английский — без подсказок.',`<div class="actions"><a class="btn primary" href="#/lexicon/quick?deck=saved">${icon('cards')} Быстро · без печати</a><button class="btn" id="add-card">${icon('plus')} Своя карточка</button></div>`)+`
 <div class="srs-head"><span class="pill blue" id="review-count">${queue.length} к повторению</span><div class="actions"><a class="btn small" href="/api/anki/export">${icon('download')} Скачать для Anki</a><button class="btn small" id="sync-anki">${icon('loop')} Отправить в Anki</button></div></div>
 <section id="review-work"></section><div class="section-heading"><h2>Мой словарь</h2><span class="small-note">${data.state.cards.length} карточек</span></div>
 <div class="card"><div class="search"><label class="hidden" for="card-search">Поиск карточек</label>${icon('search')}<input id="card-search" placeholder="Найти слово или фразу…"></div><div class="cards-table" id="cards-table"></div></div>
 <p class="small-note" style="margin-top:17px">Интервалы рассчитываются по схеме SM-2: ошибки возвращают карточку через 10 минут, успешные ответы увеличивают интервал. Anki получает отдельные карточки; расписания двух приложений не синхронизируются.</p>`;
 const reviewWork=$('#review-work'),isCurrent=()=>root.isConnected&&$('#review-work',root)===reviewWork;
 $('#add-card').onclick=()=>cardModal({},async()=>{const updated=await refresh();if(isCurrent())mountReview(root,updated,refresh);});$('#sync-anki').onclick=ev=>busy(ev.currentTarget,async()=>{const out=await api('/anki/sync',{});toast('Передано в Anki: '+out.added);},'Передаём…');
 function draw(){
  const c=queue[0];shownCardID=c?.id||'';$('#review-count').textContent=`${queue.length} осталось · ${finished} повторено`;
  if(!c){$('#review-work').innerHTML=empty(finished?'На сегодня всё повторено.':'Сейчас нет карточек к повторению.','Добавляй выражения из видео, собственных ошибок и учебников. Карточки вернутся, когда придёт время.','<a class="btn primary" href="#/media">Найти новую фразу '+icon('arrow')+'</a>');return;}
  reveal=false;reviewID=uid();$('#review-work').innerHTML=`<div class="card review-card"><div class="eyebrow">Вспомни по-английски</div><p class="review-front">${esc(c.front)}</p><textarea id="recall" rows="2" spellcheck="false" aria-label="Ответ на карточку" placeholder="Напиши фразу по памяти…">${esc(getDraft('review:'+c.id,data.state))}</textarea><div class="actions" style="justify-content:center;margin-top:18px"><button class="btn" id="voice">${icon('mic')} Сказать</button><button class="btn primary" id="reveal">Показать ответ</button></div><audio id="audio-preview" class="audio-preview" controls hidden></audio><div id="review-answer"></div></div>`;
  const recall=$('#recall'),saveRecall=()=>queueDraft('review:'+c.id,recall.value);recall.oninput=saveRecall;
  $('#voice').onclick=ev=>voice(ev.currentTarget,recall,data.settings,saveRecall);
  $('#reveal').onclick=()=>{
   if(!$('#recall').value.trim()){toast('Сначала попробуй вспомнить фразу. Если не получается, напиши «не помню».');$('#recall').focus();return;}
   stopAudio();reveal=true;$('#reveal').hidden=true;
   $('#review-answer').innerHTML=`<div class="review-back"><div class="eyebrow">Английская фраза</div><div class="english">${esc(c.back)}</div><button class="btn small ghost" id="say-card">${icon('sound')} Прослушать</button>${mediaURL(c.image)?`<img class="capture-preview" src="${mediaURL(c.image)}" alt="Контекст фразы">`:''}<p class="small-note" style="white-space:pre-line">${esc(c.note)}</p><p class="small-note">${esc(c.source)}</p><div class="small-note">Насколько самостоятельно ты вспомнил смысл и формулировку?</div><div class="review-ratings">${[['Ещё раз','10 минут'],['Трудно','Более короткий интервал'],['Помню','Обычный интервал'],['Легко','Более длинный интервал']].map(([t,sub],i)=>`<button class="btn ${i===2?'primary':''}" data-rating="${i}">${t}<small>${sub}</small></button>`).join('')}</div></div>`;
   $('#say-card').onclick=()=>speak(c.back);$$('[data-rating]').forEach(b=>b.onclick=async()=>{
    if(!reveal)return;reveal=false;$$('[data-rating]').forEach(x=>x.disabled=true);
    stopAudio();
    try{await api('/review',{id:reviewID,cardId:c.id,rating:+b.dataset.rating,answer:$('#recall').value});}catch(e){if(isCurrent()&&shownCardID===c.id){reveal=true;$$('[data-rating]',root).forEach(x=>x.disabled=false);toast(e.message,true);}return;}
    queue=queue.filter(item=>item.id!==c.id);queueDraft('review:'+c.id,'');finished++;try{data=await refresh();}catch(e){toast('Повторение сохранено. Не удалось обновить список: '+e.message,true);}if(isCurrent()){if(shownCardID===c.id)draw();drawCards();}
   });
  };
 }
 function drawCards(){
  const q=$('#card-search').value.toLowerCase(),cards=data.state.cards.filter(c=>(c.front+' '+c.back).toLowerCase().includes(q));
  $('#cards-table').innerHTML=cards.length?cards.map(c=>`<div class="saved-card">${mediaURL(c.image)?`<img class="card-thumb" src="${mediaURL(c.image)}" alt="">`:''}<div><p>${esc(c.front)}</p><p class="english">${esc(c.back)}</p><small class="muted">Повторение: ${formatDate(c.due)} · ${c.repetitions} успешных подряд</small></div><button class="btn small ghost" data-delete="${c.id}" aria-label="Удалить карточку">${icon('trash')}</button></div>`).join(''):'<p class="small-note">Карточки появятся здесь после добавления.</p>';
  $$('[data-delete]').forEach(b=>b.onclick=()=>{const d=openModal('Удалить карточку?',`<p>Карточка исчезнет из местного словаря. Если она отправлена в Anki, там она сохранится.</p><div class="actions"><button class="btn danger" id="confirm-delete">Удалить</button><button class="btn" id="cancel-delete">Отмена</button></div>`);$('#cancel-delete').onclick=()=>d.close();$('#confirm-delete').onclick=ev=>busy(ev.currentTarget,async()=>{await api('/cards/'+b.dataset.delete,{},'DELETE');d.close();data=await refresh();if(!isCurrent())return;queue=queue.filter(c=>c.id!==b.dataset.delete);drawCards();if(shownCardID===b.dataset.delete)draw();});});
 }
 $('#card-search').oninput=drawCards;draw();drawCards();
}
export function mountJournal(root,data){
 const p=data.state,days=Array.from({length:56},(_,i)=>{const d=new Date();d.setDate(d.getDate()-55+i);return dateKey(d);}),total=Object.values(p.activity).reduce((a,b)=>a+b,0),graded=p.attempts.filter(a=>a.feedback.verdict!=='ungraded');
 const skills=[['translation','Перевод'],['writing','Письмо'],['speaking','Речь'],['reading','Чтение'],['listening','Аудирование'],['vocabulary','Словарь']].map(([id,t])=>[t,p.attempts.filter(a=>a.mode===id).length]);const max=Math.max(1,...skills.map(x=>x[1]));
 root.innerHTML=heading('Прогресс, который видно.','Твои тексты, разборы и регулярность — всё в одном месте.',`<a class="btn" href="/api/progress/export">${icon('download')} Экспорт JSON</a>`)+`
 <div class="grid2"><div class="card"><div class="spread"><h3>Последние 8 недель</h3><span class="pill">${Math.floor(total/60)} мин практики</span></div><p class="small-note">Считается активное время на открытой странице. Длительное отсутствие взаимодействия останавливает счётчик.</p><div class="heatmap">${days.map(d=>{const n=p.activity[d]||0;return `<div class="heat-day ${n>=3600?'high':n>=1200?'mid':n?'low':''}" title="${d}: ${Math.floor(n/60)} минут"></div>`;}).join('')}</div></div>
 <div class="card"><h3>Баланс практики</h3><div class="skills-bars">${skills.map(([t,n])=>`<div class="skill-row"><span>${t}</span><div class="progress-track"><span style="width:${n/max*100}%"></span></div><span>${n}</span></div>`).join('')}</div><p class="small-note" style="margin-top:15px">Количество ответов по форматам; это не оценка владения навыком.</p></div></div>
 <div class="section-heading"><h2>Журнал ответов</h2><span class="small-note">${p.attempts.length} ответов · ${graded.length} с оценкой</span></div>
 <div class="filters"><div class="search">${icon('search')}<input id="history-search" aria-label="Поиск в журнале" placeholder="Найти фразу, тему или ошибку…"></div><select id="history-filter" aria-label="Фильтр ответов"><option value="all">Все ответы</option><option value="mistakes">Нужно доработать</option><option value="correct">Верные</option><option value="ungraded">Без оценки</option></select></div><div id="history-list"></div>`;
 root.insertAdjacentHTML('beforeend',`<details class="surface progress-storage"><summary>Как и где сохраняется мой прогресс</summary><p>Ответы, разборы, карточки, интервалы повторения, отметки занятий и время практики автоматически записываются сервером. При обычном запуске через Start-English.cmd файл находится в <code>app/data/studio/progress.json</code>. Рядом находится <code>progress.json.bak</code> — предыдущая успешная версия.</p><p>Черновик сначала сохраняется в браузере, затем отправляется серверу. Изображения хранятся отдельно в <code>app/data/studio/media/</code>. Голосовые записи доступны на странице; для постоянного хранения скачай запись.</p><p>Это локальный профиль на этом компьютере. Облачная синхронизация не настроена. «Экспорт JSON» сохраняет переносимую копию текстового прогресса; «Снимок для Git» в настройках создаёт файл для ручного коммита.</p><a class="text-link" href="#/settings">Резервная копия и перенос ${icon('arrow')}</a></details>`);
 function draw(){
  const q=$('#history-search').value.toLowerCase(),filter=$('#history-filter').value,items=[...p.attempts].reverse().filter(a=>(a.answer+' '+a.prompt+' '+a.feedback.explanation).toLowerCase().includes(q)&&(filter==='all'||filter==='mistakes'&&['partial','incorrect'].includes(a.feedback.verdict)||a.feedback.verdict===filter));
  $('#history-list').innerHTML=items.length?items.slice(0,100).map(a=>`<article class="card history-entry"><div class="spread"><span class="pill ${a.feedback.verdict==='correct'?'green':'blue'}">${esc(data.lessons.find(l=>l.id===a.lessonId)?.title||(a.lessonId==='pronunciation'?data.pronunciation?.lessons?.find(l=>l.id===a.exerciseId)?.title:null)||data.library?.books?.flatMap(b=>b.units)?.find(u=>'book-'+u.id===a.lessonId||(a.lessonId==='free'&&a.exerciseId.startsWith('book-'+u.id+'-')))?.title||'Свободная практика')}</span><span class="small-note">${formatDate(a.at)} · ${words(a.answer)} слов</span></div><p class="small-note" style="margin-top:18px">${esc(a.prompt)}</p><div class="english">${esc(a.answer)}</div><details><summary class="small-note" style="cursor:pointer;color:var(--blue)">Открыть разбор</summary>${feedbackHTML(a)}</details></article>`).join(''):empty('Пока здесь чистый лист.','Каждый проверенный ответ сохраняется вместе с объяснением. Начни с одного занятия.','<a class="btn primary" href="#/practice">Перейти к практике</a>');bindMistakes($('#history-list'));
 }$('#history-search').oninput=draw;$('#history-filter').onchange=draw;draw();
}
export function mountSettings(root,data,refresh){
 const c=data.settings;
 root.innerHTML=heading('Настрой под себя.','Помощник, голос и надёжное сохранение прогресса.')+`
 <div class="settings-layout"><div class="stack"><form class="card" id="settings-form"><h2>Помощник для разбора ответов</h2>
 <div class="field"><label for="provider">Как проверять английский</label><select id="provider">${[['codex','ChatGPT через Codex CLI'],['ollama','Локальная модель · Ollama'],['claude','Claude Code CLI'],['compatible','Совместимый API'],['offline','Без ИИ · сравнение с примерами']].map(([v,t])=>`<option value="${v}" ${v===c.provider?'selected':''}>${t}</option>`).join('')}</select></div>
 <div class="status-box" id="provider-help"></div>
 <div class="field" id="endpoint-field"><label for="endpoint">Адрес сервиса</label><input id="endpoint" value="${esc(c.endpoint)}" placeholder="http://127.0.0.1:11434"><small>Для совместимого API — базовый адрес с /v1, без /chat/completions.</small></div>
 <div class="field" id="model-field"><label for="model">Модель</label><input id="model" value="${esc(c.model)}" placeholder="По умолчанию для CLI"><small id="model-help">Для Ollama укажи точное имя установленной модели.</small></div>
 <div class="field" id="key-field"><label for="api-key">API-ключ</label><input id="api-key" type="password" autocomplete="new-password" placeholder="${data.hasKey?'Ключ сохранён; оставь пустым, чтобы сохранить':'Вставь ключ сервиса'}"><small>Сохраняется только на этом компьютере и не входит в экспорт прогресса.</small></div>
 <div class="field"><label for="whisper">Локальное распознавание речи (необязательно)</label><input id="whisper" value="${esc(c.whisperUrl)}" placeholder="http://127.0.0.1:8080/inference"><small>Адрес whisper.cpp. Если пусто — используется распознавание Chrome/Edge; оно может отправлять аудио сервису браузера. Запись остаётся доступна и без распознавания.</small></div>
 <div class="field"><label for="goal">План занятий, минут в день</label><input id="goal" type="number" min="15" max="480" step="5" value="${c.dailyMinutes}" required></div>
 <div class="field"><label for="deck">Колода Anki</label><input id="deck" value="${esc(c.deck)}"></div>
 <div class="actions"><button class="btn primary" type="submit">${icon('check')} Сохранить настройки</button><button class="btn" id="test-ai" type="button">${icon('spark')} Проверить подключение</button></div>
 </form><section class="card voice-settings" id="voice-settings"></section></div><div class="stack">
 <section class="card"><h2>Прогресс принадлежит тебе</h2><p>Каждый ответ, карточка и повторение сохраняются в <code>app/data/studio/progress.json</code>. При записи создаётся резервная копия <code>progress.json.bak</code>.</p><div class="actions"><a class="btn" href="/api/progress/export">${icon('download')} Скачать JSON</a><button class="btn" id="import-progress">${icon('upload')} Импортировать</button></div><input type="file" id="progress-file" accept=".json,application/json" hidden><p class="small-note" style="margin-top:17px">Импорт объединяет записи по идентификаторам. Существующие карточки на этом компьютере сохраняют своё расписание. Картинки переносятся отдельно — папкой media или через архив для Anki.</p></section>
 <section class="card"><h2>Локальный вариант</h2><p>Стартовая модель для твоей RTX 3080 Ti: Qwen3.5 9B. Установи Ollama и выполни:</p><p><code>ollama pull qwen3.5:9b</code></p><p>Выбери Ollama слева и укажи <code>qwen3.5:9b</code>. Загрузка весов занимает около 6,6 ГБ; качество разбора зависит от модели.</p><p><a href="https://ollama.com/library/qwen3.5" target="_blank" rel="noreferrer" style="color:var(--blue)">Модель и установка ↗</a></p></section>
 <section class="card"><h2>Диктовка и Anki</h2><p>Для локального распознавания твоей речи можно запустить <a href="https://github.com/ggml-org/whisper.cpp/tree/master/examples/server" target="_blank" rel="noreferrer" style="color:var(--blue)">whisper.cpp server</a> с английской моделью и вписать адрес /inference. В приложение звук отправляется как WAV 16 кГц.</p><p>Для прямой передачи карточек открой Anki с дополнением AnkiConnect: <code>2055492159</code>. Можно обойтись без дополнения: скачать ZIP с TSV и картинками в «Повторении».</p></section>
 </div></div>`;
 void mountVoiceSettings($('#voice-settings',root));
 function providerHelp(){
  const v=$('#provider').value;$('#endpoint-field').hidden=!['ollama','compatible'].includes(v);$('#key-field').hidden=v!=='compatible';$('#model-field').hidden=v==='offline';
  $('#provider-help').innerHTML={
   codex:'Использует установленный Codex CLI с текущим входом через ChatGPT и его лимитами. Браузер открывать не нужно. Если вход не выполнен: <code>codex login</code>. Модель можно оставить пустой.',
   claude:'Использует <code>claude -p</code>. С 15 июня 2026 автоматические вызовы расходуют отдельные кредиты Agent SDK, а не обычный лимит интерактивной подписки. <a href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan" target="_blank" rel="noreferrer">Условия Anthropic ↗</a>',
   ollama:'Ответы обрабатываются локальной моделью. Ollama должен быть запущен, а указанная модель — загружена. Платный API не требуется.',
   compatible:'Сервис с интерфейсом chat/completions и JSON-ответами. Тексты и контекст отправляются этому сервису. Оплата и лимиты зависят от провайдера.',
   offline:'Теория и все упражнения доступны. Известные варианты распознаются; остальные ответы сохраняются без оценки. Произвольный текст нельзя корректно оценить одним сравнением строк.'
  }[v];
 }
 $('#provider').onchange=()=>{const v=$('#provider').value;if(v==='ollama'){$('#endpoint').value='http://127.0.0.1:11434';$('#model').value='qwen3.5:9b';}else if(v==='codex'||v==='claude')$('#model').value='';providerHelp();};providerHelp();
 async function save(){const settings={provider:$('#provider').value,endpoint:$('#endpoint').value.trim(),model:$('#model').value.trim(),apiKey:$('#api-key').value.trim(),whisperUrl:$('#whisper').value.trim(),dailyMinutes:+$('#goal').value,deck:$('#deck').value.trim()};const keyInput=$('#api-key');await api('/settings',settings);await refresh();keyInput.value='';return settings;}
 $('#settings-form').onsubmit=ev=>{ev.preventDefault();busy($('#settings-form button[type=submit]'),async()=>{await save();toast('Настройки сохранены.');});};
 $('#test-ai').onclick=ev=>busy(ev.currentTarget,async()=>{const s=await save();if(s.provider==='offline'){toast('Включён режим без ИИ. Подключение не требуется.');return;}await api('/ai/test',{});toast('Подключение работает. Можно проверять свободные ответы.');},'Проверяем…');
 $('#import-progress').onclick=()=>$('#progress-file').click();
 $('#import-progress').insertAdjacentHTML('afterend','<button class="btn" id="git-snapshot">Снимок для Git</button>');
 $('#git-snapshot').onclick=ev=>busy(ev.currentTarget,async()=>{const result=await api('/progress/snapshot',{});toast('Сохранено: '+result.path+'. Файл можно добавить в Git.');});
 $('#progress-file').onchange=async ev=>{const file=ev.target.files[0];if(!file)return;try{if(file.size>20*1024*1024)throw Error('Файл больше 20 МБ.');const p=JSON.parse(await file.text());await api('/progress/import',p);await refresh();toast('Прогресс объединён. Текущие записи сохранены.');}catch(e){toast(e.message,true);}ev.target.value='';};
}
export function mountBooks(root,data,refresh){
 const books={egiu:'English Grammar in Use',vocab:'Vocabulary in Use',colloc:'Collocations in Use',phrasal:'Phrasal Verbs in Use',essential:'Essential Grammar'};
 root.innerHTML=heading('Твои учебники. Твоя программа.','Книги — для глубины. Мастерская — чтобы применить прочитанное.')+`
 <div class="notice">Для уровня B1–B2 начни с Murphy English Grammar in Use, Vocabulary Upper-Intermediate, Collocations Intermediate и Phrasal Verbs Intermediate. Advanced оставь для точечных вопросов. Материала уже достаточно: докупать книги не нужно.</div>
 <div class="section-heading"><h2>В папке «книги»</h2><span class="small-note">${data.books.length} PDF и других файлов</span></div>
 <div class="library-grid">${data.books.length?data.books.map((name,i)=>`<article class="card book-card"><div class="book-spine">${icon('book')}</div><h3>${esc(name.replace(/\.pdf$/i,'').replace(/_/g,' '))}</h3><small>${/advanced/i.test(name)?'После основной программы · B2–C1':/elementary/i.test(name)?'Повторение основ · A1–A2':'Основная практика · B1–B2'}</small><a class="btn small" href="/books/${encodeURIComponent(name)}" target="_blank" rel="noreferrer">Открыть PDF ${icon('arrow')}</a></article>`).join(''):empty('Папка пока пустая','Добавь PDF в папку «книги» рядом с приложением.')}</div>
 <div class="section-heading"><h2>Каталог тем из оглавлений</h2><span class="small-note">${data.topics.length} тем</span></div>
 <div class="card"><div class="filters"><div class="search">${icon('search')}<input id="topic-search" aria-label="Поиск темы" placeholder="Тема, слово или номер юнита…"></div><select id="book-filter" aria-label="Фильтр учебника"><option value="">Все учебники</option>${[...new Set(data.topics.map(t=>t.book))].map(b=>`<option value="${esc(b)}">${esc(books[b]||b)}</option>`).join('')}</select></div><div class="catalog-list" id="catalog"></div></div>
 <p class="small-note" style="margin-top:18px">Каталог сохранён из предыдущей версии проекта. Уроки мастерской — оригинальные объяснения и задания по темам, а не копии страниц. Чтобы разобрать конкретный отрывок книги, открой PDF и вставь нужный текст в «Практика → Своя задача или материал».</p>`;
 function draw(){
  const q=$('#topic-search').value.toLowerCase(),b=$('#book-filter').value,topics=data.topics.filter(t=>(!b||t.book===b)&&(t.title+' '+t.title_ru+' '+t.unit).toLowerCase().includes(q));
  $('#catalog').innerHTML=topics.length?topics.map(t=>{const l=data.lessons.find(l=>l.id==='custom-'+t.id);return `<div class="topic-row"><span class="pill">${esc(t.unit)}</span><div><h3>${esc(t.title)}</h3><p>${esc(t.title_ru)} · ${esc(books[t.book]||t.book)}</p></div>${l?`<a class="btn small" href="#/lesson/${l.id}">Открыть ${icon('arrow')}</a>`:`<button class="btn small" data-generate="${esc(t.id)}">${icon('spark')} Создать занятие</button>`}</div>`;}).join(''):'<p class="muted">По этому запросу тем не найдено.</p>';
  $$('[data-generate]').forEach(b=>b.onclick=ev=>busy(ev.currentTarget,async()=>{if(data.settings.provider==='offline')throw Error('Подключи помощника в настройках, чтобы создавать новые занятия.');const l=await api('/lessons/generate',{topicId:b.dataset.generate});await refresh();location.hash='/lesson/'+l.id;},'Готовим урок…'));
 }$('#topic-search').oninput=draw;$('#book-filter').onchange=draw;draw();
}
