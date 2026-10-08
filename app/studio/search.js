import {esc,icon} from './core.js';

// One search for the whole app: a word goes to the dictionary, a topic to its
// lesson, anything else to the section that holds it. Ctrl+K or ⌘K opens it.
const sections=[
 ['#/today','home','Сегодня','план дня главная'],
 ['#/roadmap','layers','Курс A1–C2','программа уроки карта обучения'],
 ['#/hub','mic','Практика','говорить писать упражнения'],
 ['#/lexicon','cards','Слова','словарь лексика контекст'],
 ['#/review','cards','Повторить карточки','карточки повторение anki'],
 ['#/conversation','mic','Разговор','собеседник диалог речь говорить'],
 ['#/cinema','film','Кино','киноклуб сериал сцена субтитры'],
 ['#/pronunciation','sound','Произношение','чтение звуки транскрипция ipa'],
 ['#/notebook','journal','Мои мысли','тетрадь перевод дневник'],
 ['#/practice','pen','Свободное письмо','практика эссе текст'],
 ['#/transfer','loop','Закрепление','применение возврат повтор'],
 ['#/projects','pen','Проекты и проверки','контрольные проверка'],
 ['#/tenses','clock','Карта времён','времена tense'],
 ['#/books','book','Учебники','библиотека книги murphy in use'],
 ['#/mastery','chart','Результаты A1–C2','уровень навыки итоги'],
 ['#/journal','chart','Мой прогресс','журнал история работы'],
 ['#/media','play','Медиатека','видео фильмы'],
 ['#/method','book','Как заниматься','метод советы'],
 ['#/settings','settings','Настройки','голос озвучка модель ии'],
 ['#/designs','spark','Дизайн','тема оформление вид']
];
const norm=text=>String(text||'').toLowerCase().replace(/ё/g,'е');

export function searchResults(query,lessons=[]){
 const q=norm(query).trim();
 if(!q)return [{title:'Разделы',rows:sections.slice(0,8).map(([href,iconName,title])=>({href,icon:iconName,title}))}];
 const groups=[],words=q.split(/\s+/),hits=text=>words.every(w=>norm(text).includes(w));
 groups.push({title:'Словарь',rows:[{href:'#/lexicon/search?q='+encodeURIComponent(query.trim().slice(0,100)),icon:'search',title:`Найти «${query.trim().slice(0,60)}» в словаре`,sub:'Значение, примеры и сочетания'}]});
 const found=lessons.filter(l=>!String(l.id).startsWith('cinema-')&&hits([l.title,l.subtitle,l.goal,l.formula,l.level].join(' '))).slice(0,6);
 if(found.length)groups.push({title:'Уроки',rows:found.map(l=>({href:'#/lesson/'+encodeURIComponent(l.id),icon:'layers',title:l.title,sub:[l.level,l.goal].filter(Boolean).join(' · ')}))});
 const places=sections.filter(([,,title,keys])=>hits(title+' '+keys)).slice(0,5);
 if(places.length)groups.push({title:'Разделы',rows:places.map(([href,iconName,title])=>({href,icon:iconName,title}))});
 return groups;
}

let dialog=null;
export function openSearch(data){
 if(!dialog){
  dialog=document.createElement('dialog');dialog.className='search-dialog';dialog.setAttribute('aria-label','Поиск');
  dialog.innerHTML=`<div class="search-box">${icon('search')}<label class="visually-hidden" for="search-input">Слово, урок или раздел</label><input id="search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Слово, урок или раздел"><button type="button" class="search-close" aria-label="Закрыть поиск">Esc</button></div><div class="search-results" id="search-results" role="listbox" aria-label="Результаты"></div><div class="search-foot" aria-hidden="true"><span>↑ ↓ выбрать</span><span>Enter открыть</span></div>`;
  document.body.append(dialog);
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.querySelector('.search-close').onclick=()=>dialog.close();
 }
 const input=dialog.querySelector('#search-input'),list=dialog.querySelector('#search-results');let active=0;
 const rows=()=>[...list.querySelectorAll('.search-row')];
 const mark=()=>rows().forEach((row,i)=>{row.setAttribute('aria-selected',String(i===active));if(i===active)row.scrollIntoView({block:'nearest'});});
 const draw=()=>{
  const groups=searchResults(input.value,data?.lessons||[]);active=0;
  list.innerHTML=groups.map(group=>`<div class="search-group" role="group" aria-label="${esc(group.title)}"><span class="search-group-title">${esc(group.title)}</span>${group.rows.map(row=>`<a class="search-row" role="option" href="${esc(row.href)}">${icon(row.icon)}<span><strong>${esc(row.title)}</strong>${row.sub?`<small>${esc(row.sub)}</small>`:''}</span></a>`).join('')}</div>`).join('');
  rows().forEach((row,i)=>{row.onclick=()=>dialog.close();row.onmousemove=()=>{if(active!==i){active=i;mark();}};});mark();
 };
 input.oninput=draw;
 input.onkeydown=event=>{
  const all=rows();if(!all.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();active=(active+(event.key==='ArrowDown'?1:-1)+all.length)%all.length;mark();}
  else if(event.key==='Enter'){event.preventDefault();location.hash=all[active].getAttribute('href');dialog.close();}
 };
 input.value='';draw();
 if(!dialog.open)dialog.showModal();
 input.focus();
}

export function bindSearchShortcut(getData){
 document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&(event.code==='KeyK'||event.key.toLowerCase()==='k')){event.preventDefault();openSearch(getData());}
 });
}
