import { getLetters, getTopics } from '../api.js';
import { html, setHTML, empty, fmtDate, plural, on } from '../dom.js';

function topicChip(id, titles) {
  if (!id) return '';
  return html` <a class="tag" href="#/topic/${encodeURIComponent(id)}">${titles[id] || id}</a>`;
}

function block(title, body) {
  return html`<div style="margin-top:16px"><h2>${title}</h2>${body}</div>`;
}

function letterBody(l, titles) {
  const a = l.analysis || {};
  const errors = a.errors || [];
  const upgrades = a.upgrades || [];
  const inserts = a.russian_inserts || a.russianInserts || [];
  const ok = l.topics_ok || l.topicsOk || a.topics_ok || [];
  const slang = a.slang_bonus || a.slangBonus;

  return html`<div class="lbody">
    <div class="toggle" data-id="${l.id}">
      <button data-view="orig" class="on">оригинал</button>
      <button data-view="fixed">исправленное</button>
    </div>
    <div class="lettertext" data-text="orig">${l.original || ''}</div>
    <div class="lettertext" data-text="fixed" hidden>${a.corrected || 'разбора нет'}</div>

    ${errors.length
      ? block(
          'Ошибки',
          html`<div>${errors.map(
            (e) => html`<div class="fixrow">
              <span class="q">${e.quote}</span><span class="faint"> → </span><span class="a">${e.fix}</span>
              ${topicChip(e.topic_id || e.topicId, titles)}
              ${e.explain_ru ? html`<div class="why">${e.explain_ru}</div>` : ''}
            </div>`
          )}</div>`
        )
      : ''}

    ${upgrades.length
      ? block(
          'Можно сильнее',
          html`<div>${upgrades.map(
            (u) => html`<div class="fixrow">
              <span class="mono muted">${u.quote}</span><span class="faint"> → </span><span class="a">${u.better}</span>
              ${u.why_ru ? html`<div class="why">${u.why_ru}</div>` : ''}
            </div>`
          )}</div>`
        )
      : ''}

    ${inserts.length
      ? block(
          'Русские вставки',
          html`<div>${inserts.map(
            (r) => html`<div class="fixrow">
              <span>${r.ru}</span><span class="faint"> → </span><span class="a">${r.en}</span>
              ${r.alt ? html`<div class="why">разговорнее: <span class="mono">${r.alt}</span></div>` : ''}
            </div>`
          )}</div>`
        )
      : ''}

    ${ok.length
      ? block(
          'Сработало',
          html`<div class="row wrap" style="gap:6px">${ok.map((id) => topicChip(id, titles))}</div>`
        )
      : ''}

    ${slang && slang.phrase
      ? block(
          'Сленг-бонус',
          html`<div class="fixrow">
            <span class="a">${slang.phrase}</span>
            <div class="why">${slang.meaning_ru || ''}</div>
            ${slang.example ? html`<div class="why mono">${slang.example}</div>` : ''}
          </div>`
        )
      : ''}
  </div>`;
}

export async function letters(root) {
  const [list, all] = await Promise.all([getLetters(), getTopics().catch(() => [])]);
  const titles = {};
  (all || []).forEach((t) => (titles[t.topic.id] = t.topic.title));

  if (!list || !list.length) {
    setHTML(
      root,
      html`<h1>Письма</h1>
        <p class="sub">Здесь оседают разборы из бота.</p>
        ${empty('Писем ещё нет', 'Напиши первое боту — разбор приедет сюда.')}`
    );
    return;
  }

  setHTML(
    root,
    html`<h1>Письма</h1>
      <p class="sub">${list.length} ${plural(list.length, 'письмо', 'письма', 'писем')} с разбором. Раскрой, чтобы посмотреть.</p>
      ${list.map((l) => {
        const errs = ((l.analysis || {}).errors || []).length;
        return html`<details class="letter">
          <summary>
            <span class="ldate">${fmtDate(l.created_at)}</span>
            <span class="lprompt">${l.prompt || 'без темы'}</span>
            <span class="lcount ${errs ? 's-struggling' : 's-active'}">${errs ? errs + ' ' + plural(errs, 'ошибка', 'ошибки', 'ошибок') : 'чисто'}</span>
          </summary>
          ${letterBody(l, titles)}
        </details>`;
      })}`
  );

  on(root, '.toggle button', 'click', (btn) => {
    const box = btn.closest('.lbody');
    box.querySelectorAll('.toggle button').forEach((b) => b.classList.toggle('on', b === btn));
    box.querySelectorAll('[data-text]').forEach((el) => {
      el.hidden = el.dataset.text !== btn.dataset.view;
    });
  });
}
