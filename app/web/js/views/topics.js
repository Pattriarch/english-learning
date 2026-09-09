import { getTopics } from '../api.js';
import { html, setHTML, empty, USAGE, STUDY, BOOKS, BOOK_ORDER, $, on } from '../dom.js';

const hasLesson = (t) => (t.has_lesson ?? t.hasLesson ?? null);

function group(list) {
  const books = new Map();
  for (const t of list) {
    const b = t.topic.book || 'other';
    if (!books.has(b)) books.set(b, new Map());
    const cats = books.get(b);
    const c = t.topic.category || '—';
    if (!cats.has(c)) cats.set(c, []);
    cats.get(c).push(t);
  }
  const order = [...BOOK_ORDER, ...[...books.keys()].filter((b) => !BOOK_ORDER.includes(b))];
  return order.filter((b) => books.has(b)).map((b) => [b, books.get(b)]);
}

function row(t) {
  const id = t.topic.id;
  const lesson = hasLesson(t);
  return html`<a class="trow" href="#/topic/${encodeURIComponent(id)}">
    <span class="uid mono">${t.topic.unit ? '#' + t.topic.unit : id.split('-')[0]}</span>
    <span class="ti">
      <span class="tt">${t.topic.title}</span>
      <span class="tr">${t.topic.title_ru || ''}</span>
    </span>
    ${lesson ? html`<span class="lesson">урок</span>` : ''}
    <span class="marks">
      <span class="dot b-${t.usage_status}" title="письмо: ${USAGE[t.usage_status] || t.usage_status}"></span>
      <span class="dot b-${t.study_status}" title="тренажёр: ${STUDY[t.study_status] || t.study_status}"></span>
    </span>
  </a>`;
}

function list(items) {
  if (!items.length) return empty('Ничего не нашлось', 'Сбрось фильтры или поищи иначе.');
  return html`${group(items).map(
    ([book, cats]) => html`<div class="book">
      <h2>${BOOKS[book] || book}</h2>
      ${[...cats.entries()].map(
        ([cat, rows]) => html`<div class="cat">
          <div class="catname">${cat}</div>
          <div class="tlist">${rows.map(row)}</div>
        </div>`
      )}
    </div>`
  )}`;
}

export async function topics(root) {
  const all = await getTopics();
  const lessonsKnown = all.some((t) => hasLesson(t) !== null);
  const state = { pain: false, lesson: false, q: '' };

  setHTML(
    root,
    html`
      <h1>Каталог</h1>
      <p class="sub">${all.length} тем. Левая точка — как идёт в письмах, правая — тренажёр.</p>
      <div class="filters">
        <input type="search" id="q" placeholder="поиск по теме" autocomplete="off">
        <button class="chip" data-f="pain">только болевые</button>
        ${lessonsKnown ? html`<button class="chip" data-f="lesson">только с уроками</button>` : ''}
        <span class="spacer"></span>
        <span class="faint mono" id="count"></span>
      </div>
      <div id="tlist"></div>
    `
  );

  const box = $('#tlist', root);
  const count = $('#count', root);

  function apply() {
    const q = state.q.trim().toLowerCase();
    const items = all.filter((t) => {
      if (state.pain && t.usage_status !== 'struggling') return false;
      if (state.lesson && hasLesson(t) !== true) return false;
      if (!q) return true;
      const s = (t.topic.title + ' ' + (t.topic.title_ru || '') + ' ' + t.topic.category + ' ' + t.topic.id).toLowerCase();
      return s.includes(q);
    });
    count.textContent = items.length + ' / ' + all.length;
    setHTML(box, list(items));
  }

  on(root, '.chip', 'click', (el) => {
    const f = el.dataset.f;
    state[f] = !state[f];
    el.classList.toggle('on', state[f]);
    apply();
  });
  $('#q', root).addEventListener('input', (e) => {
    state.q = e.target.value;
    apply();
  });

  apply();
}
