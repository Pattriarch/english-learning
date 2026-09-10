import {$,$$,esc,icon,progressLesson,getDraft,queueDraft,cardModal} from './core.js';
import {mountSubtitleSources} from './subtitle-sources.js';

const safeLink=url=>/^https:\/\/(tv\.apple\.com|www\.sonypictures\.com|www\.sonypictures\.jp|help\.netflix\.com)\//.test(url||'')?url:'#';
const stageNames=['Подготовиться','Услышать и понять','Говорить и писать'];
export function mountCinema(data,refresh){
  const root=$('#main'),series=data.cinema?.series?.[0];
  if(!series){root.innerHTML='<div class="empty"><h1>Киноклуб</h1><p>Курс пока не загружен. Перезапустите приложение, чтобы подключить материалы.</p></div>';return;}
  const lessons=new Map(data.lessons.map(l=>[l.id,l]));
  const courseLessons=series.episodes.flatMap(e=>e.lessonIds).map(id=>lessons.get(id)).filter(Boolean);
  const total=courseLessons.reduce((n,l)=>n+l.exercises.length,0);
  const mastered=courseLessons.filter(l=>progressLesson(l,data.state).done).length;
  let selected=series.episodes.find(e=>e.id===getDraft('cinema:selected',data.state))||series.episodes[0];
  root.innerHTML=`<div class="cinema-page">
    <section class="cinema-hero">
      <div class="cinema-hero-copy"><div class="cinema-kicker">ENGLISH THROUGH STORIES / SEASON 01</div>
        <h1>Смотри внимательно.<br><em>Говори по-своему.</em></h1>
        <p>${esc(series.subtitle)}. Истории о выборе, доверии и силе слов — твой материал для живого английского.</p>
        <div class="actions"><a class="btn light" href="#/lesson/${esc(series.episodes[0].lessonIds[0])}">Первое занятие ${icon('arrow')}</a><a class="btn cinema-outline" href="#/media">${icon('play')} Медиатека</a></div>
      </div>
      <div class="cinema-poster" aria-hidden="true"><div class="cinema-poster-sun"></div><span class="cinema-poster-label">THE ART OF<br>MAKING<br><i>YOUR CASE.</i></span><span class="cinema-poster-caption">A STUDY IN LANGUAGE & HUMAN CHOICES</span><div class="cinema-poster-line"></div></div>
    </section>
    <div class="cinema-numbers"><div><strong>${series.episodes.length}</strong><span>эпизодов в программе</span></div><div><strong>${courseLessons.length}</strong><span>готовых занятий</span></div><div><strong>${total}</strong><span>самостоятельных ответов</span></div><div><strong>${mastered}<small> / ${courseLessons.length}</small></strong><span>занятий освоено</span></div></div>
    <section class="cinema-method">
      <div><span class="eyebrow">ОТ ПРОСМОТРА К РЕЧИ</span><h2>Один эпизод.<br> Два учебных вечера.</h2><p>Сначала разберись в языке и посмотри. Затем напиши, поспорь и перенеси новые фразы в свою жизнь.</p></div>
      ${series.plan.map((p,i)=>`<details class="cinema-plan" ${i===0?'open':''}><summary><span class="cinema-step">${i+1}</span><span>${esc(p.title)}<small>около ${p.minutes} минут</small></span></summary><ol>${p.steps.map(t=>`<li>${esc(t)}</li>`).join('')}</ol></details>`).join('')}
    </section>
    <div class="section-heading"><h2>Твой следующий эпизод</h2><span class="small-note">B1 → C1 · усложнение до C2</span></div>
    <section class="cinema-workbench">
      <div class="cinema-workbench-top"><label for="cinema-episode-select">Открыть рабочие заметки</label><select id="cinema-episode-select">${series.episodes.map(e=>`<option value="${esc(e.id)}" ${e.id===selected.id?'selected':''}>${String(e.number).padStart(2,'0')} · ${esc(e.title)}</option>`).join('')}</select></div>
      <div id="cinema-session"></div>
    </section>
    <div class="section-heading"><h2>Весь первый сезон</h2><span class="small-note">Все занятия уже подготовлены</span></div>
    <label class="cinema-search-label" for="cinema-search">Найти эпизод или языковую тему</label><input id="cinema-search" type="search" placeholder="Например: переговоры, Past Perfect, доверие" autocomplete="off">
    <div class="cinema-episode-grid" id="cinema-episodes"></div>
    <section class="cinema-materials">
      <div><span class="eyebrow">ВИДЕО И СУБТИТРЫ</span><h2>Подключи свой эпизод.</h2><p>${esc(series.subtitleStatus.message)}</p><div class="actions"><a href="#/media" class="btn primary">${icon('play')} Загрузить видео и SRT / VTT</a><a href="#/capture" class="btn">${icon('cards')} Захватить фразу</a></div></div>
      <ol>${series.subtitleStatus.workflow.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>
    </section>
    <details class="cinema-sources"><summary>Материалы курса, источники и субтитры</summary><p>${esc(data.cinema.contentNote)}</p><p>${esc(series.extension)}</p><ul>${data.cinema.sources.map(s=>`<li><a href="${esc(safeLink(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a><p>${esc(s.note)}</p></li>`).join('')}</ul></details>
  </div>`;

  function lessonLink(id,index){
    const l=lessons.get(id);
    if(!l)return `<div class="cinema-lesson-link unavailable"><span>${index+1}</span><div>${esc(stageNames[index])}<small>Материал не загружен</small></div></div>`;
    const p=progressLesson(l,data.state);
    return `<a class="cinema-lesson-link ${p.done?'mastered':''}" href="#/lesson/${esc(id)}"><span>${p.done?icon('check'):index+1}</span><div>${esc(stageNames[index])}<small>${l.minutes} мин · ${p.tried}/${p.total} ответов</small></div>${icon('arrow')}</a>`;
  }
  function renderEpisodes(){
    const query=$('#cinema-search',root).value.trim().toLocaleLowerCase();
    const visible=series.episodes.filter(e=>[e.title,e.focus,e.grammar,...e.lexicon].join(' ').toLocaleLowerCase().includes(query));
    $('#cinema-episodes',root).innerHTML=visible.length?visible.map(e=>`<article class="cinema-episode">
      <div class="cinema-episode-top"><span class="cinema-episode-number">${String(e.number).padStart(2,'0')}</span><span class="pill">${esc(e.level)}</span></div>
      <h3>${esc(e.title)}</h3><p class="cinema-episode-focus">${esc(e.focus)}</p><div class="cinema-grammar">${esc(e.grammar)}</div>
      <div class="cinema-lesson-links">${e.lessonIds.map(lessonLink).join('')}</div>
      <div class="cinema-episode-footer"><button class="btn small ghost" data-cinema-focus="${esc(e.id)}">Заметки и фразы</button><details><summary>О серии · спойлер</summary><p>${esc(e.synopsis)}</p><a href="${esc(safeLink(e.source))}" target="_blank" rel="noopener noreferrer">Официальное описание ↗</a></details></div>
    </article>`).join(''):'<p class="small-note">По этому запросу эпизодов нет. Попробуй название или другую тему.</p>';
    $$('[data-cinema-focus]',root).forEach(b=>b.onclick=()=>{
      selected=series.episodes.find(e=>e.id===b.dataset.cinemaFocus);
      $('#cinema-episode-select',root).value=selected.id;
      queueDraft('cinema:selected',selected.id);
      renderSession();
      $('.cinema-workbench',root).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    });
  }
  function renderSession(){
    const e=selected,watched=getDraft('cinema:watched:'+e.id,data.state)==='yes';
    $('#cinema-session',root).innerHTML=`<div class="cinema-session-body">
      <div><span class="eyebrow">S01E${String(e.number).padStart(2,'0')}</span><h3>${esc(e.title)}<small>${esc(e.focus)}</small></h3><p>${esc(e.watch)}</p>
        <label class="cinema-watched"><input type="checkbox" id="cinema-watched" ${watched?'checked':''}> Эпизод просмотрен</label><p class="small-note">Отметка о просмотре сохраняется отдельно от освоения заданий.</p>
        <div class="cinema-chunks">${e.lexicon.map((phrase,i)=>`<button data-cinema-phrase="${i}" title="Добавить фразу в карточки">${esc(phrase.split(' — ')[0])}<span>+</span></button>`).join('')}</div><p class="small-note">60 тематических сочетаний на сезон. Нажми на фразу, чтобы подготовить карточку.</p>
      </div>
      <div><label for="cinema-notes">Твои наблюдения и таймкоды</label><textarea id="cinema-notes" rows="7" maxlength="18000" placeholder="Сцена / что удалось услышать / какую мысль хочу уметь выражать / две фразы на повторение">${esc(getDraft('cinema:notes:'+e.id,data.state))}</textarea><p class="small-note">Заметки сохраняются автоматически в общем JSON-прогрессе. Субтитры и кадры загружаются через медиатеку.</p><a href="#/lesson/${esc(e.lessonIds.find(id=>{const l=lessons.get(id);return l&&!progressLesson(l,data.state).done;})||e.lessonIds[0])}" class="btn primary">Продолжить этот эпизод ${icon('arrow')}</a></div>
    </div><div id="cinema-subtitle-sources"></div>`;
    mountSubtitleSources($('#cinema-subtitle-sources',root),data,e.id);
    $('#cinema-notes',root).oninput=event=>queueDraft('cinema:notes:'+e.id,event.target.value);
    $('#cinema-watched',root).onchange=event=>queueDraft('cinema:watched:'+e.id,event.target.checked?'yes':'no',true);
    $$('[data-cinema-phrase]',root).forEach(b=>b.onclick=()=>{
      const phrase=e.lexicon[Number(b.dataset.cinemaPhrase)],parts=phrase.split(' — ');
      cardModal({front:parts.slice(1).join(' — '),back:parts[0],note:'Добавь своё предложение и личную ассоциацию. Сочетание из тематического словаря курса; не заявляется как реплика сериала.',source:`Better Call Saul · S01E${String(e.number).padStart(2,'0')} · ${e.title}`},async()=>{if(refresh)data=await refresh();});
    });
  }
  $('#cinema-episode-select',root).onchange=event=>{selected=series.episodes.find(e=>e.id===event.target.value);queueDraft('cinema:selected',selected.id);renderSession();};
  $('#cinema-search',root).oninput=renderEpisodes;
  renderSession();renderEpisodes();
}
