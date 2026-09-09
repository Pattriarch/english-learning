import { getTopic, getTopics } from '../api.js';
import { html, setHTML, empty, fmtDate, USAGE, STUDY, BOOKS, EVENT_KIND } from '../dom.js';
import { md } from '../markdown.js';

export async function topic(root, { id }) {
  const [data, all] = await Promise.all([
    getTopic(id).catch((e) => (e && e.status === 404 ? null : Promise.reject(e))),
    getTopics().catch(() => []),
  ]);
  if (!data) {
    setHTML(
      root,
      html`<a class="faint" href="#/topics" style="font-size:13px">← каталог</a>
        <h1 style="margin-top:10px">Темы нет</h1>
        <p class="sub">В каталоге нет темы <span class="mono">${id}</span>.</p>
        ${empty('Проверь ссылку', 'Возможно, каталог перезалили и id изменился.')}`
    );
    return;
  }
  const t = data.topic || {};
  const st = (all || []).find((x) => x.topic.id === id);
  const usage = st ? st.usage_status : null;
  const study = st ? st.study_status : null;
  const hasLesson = data.has_lesson ?? data.hasLesson ?? (st ? st.has_lesson : false);
  const events = data.events || [];
  const theory = data.theory || '';

  setHTML(
    root,
    html`
      <a class="faint" href="#/topics" style="font-size:13px">← каталог</a>
      <h1 style="margin-top:10px">${t.title || id}</h1>
      <p class="sub">${t.title_ru || ''}</p>

      <div class="row wrap" style="margin-bottom:22px">
        <span class="tag">${BOOKS[t.book] || t.book || '—'}${t.unit ? ' · ' + t.unit : ''}</span>
        <span class="tag">${t.level || '—'}</span>
        <span class="tag">${t.category || ''}</span>
        ${usage ? html`<span class="row" style="gap:6px"><span class="dot b-${usage}"></span><span class="s-${usage}" style="font-size:13px">письмо: ${USAGE[usage] || usage}</span></span>` : ''}
        ${study ? html`<span class="row" style="gap:6px"><span class="dot b-${study}"></span><span class="s-${study}" style="font-size:13px">тренажёр: ${STUDY[study] || study}</span></span>` : ''}
        <span class="spacer"></span>
        ${hasLesson
          ? html`<a class="btn primary" href="#/lesson/${encodeURIComponent(id)}">Тренироваться</a>`
          : html`<span class="faint" style="font-size:13px">урок ещё не написан</span>`}
      </div>

      <section class="section">
        <h2>Теория</h2>
        ${theory
          ? html`<div class="card pad md">${md(theory)}</div>`
          : empty('Теории пока нет', 'Она приезжает вместе с уроком.')}
      </section>

      <section class="section">
        <h2>История из писем</h2>
        ${events.length
          ? html`<div class="card pad events">${events.map(
              (e) => html`<div class="ev">
                <time>${fmtDate(e.created_at)}</time>
                <span class="evk s-${kindClass(e.kind)}">${EVENT_KIND[e.kind] || e.kind}</span>
                <span class="evd">${e.detail || '—'}</span>
              </div>`
            )}</div>`
          : empty('Тема ещё не всплывала', 'Ни в письмах, ни в тренажёре.')}
      </section>
    `
  );
}

function kindClass(kind) {
  if (kind === 'letter_error' || kind === 'ex_fail') return 'struggling';
  if (kind === 'letter_ok' || kind === 'ex_pass') return 'active';
  return 'unknown';
}
