import { getStats } from '../api.js';
import { html, setHTML, empty, plural, USAGE, STUDY, USAGE_ORDER, STUDY_ORDER, fmtDate } from '../dom.js';

function meter(counts, order) {
  const total = order.reduce((s, k) => s + (counts[k] || 0), 0) || 1;
  return html`<div class="meter">${order.map(
    (k) => html`<i class="b-${k}" style="width:${((counts[k] || 0) / total) * 100}%"></i>`
  )}</div>`;
}

function legend(counts, order, labels) {
  return html`<div class="legend">${order.map(
    (k) => html`<div><span class="dot b-${k}"></span><span>${labels[k]}</span><b class="s-${k}">${counts[k] || 0}</b></div>`
  )}</div>`;
}

export async function dashboard(root) {
  const s = await getStats();
  const usage = s.usage || {};
  const study = s.study || {};
  const weak = s.weak_topics || s.weakTopics || [];
  const botLink = s.botLink || s.bot_link || '';
  const streak = s.streak || 0;
  const letters = s.letters || 0;

  setHTML(
    root,
    html`
      <section class="section card pad hero">
        <div class="streak">${streak}<small>${plural(streak, 'день подряд', 'дня подряд', 'дней подряд')}</small></div>
        <div class="muted" style="font-size:14px">
          ${letters ? html`${letters} ${plural(letters, 'письмо', 'письма', 'писем')} разобрано` : 'писем ещё не было'}
          ${s.last_letter_at ? html`<br><span class="faint">последнее — ${fmtDate(s.last_letter_at)}</span>` : ''}
          ${s.anki_queue ? html`<br><span class="faint">${s.anki_queue} карточек ждут выгрузки в Anki</span>` : ''}
        </div>
        <div class="spacer"></div>
        ${botLink
          ? html`<a class="btn primary" href="${botLink}" target="_blank" rel="noopener">Написать письмо</a>`
          : ''}
      </section>

      <section class="section duo">
        <div class="card pad">
          <h2>Применяю в письме</h2>
          ${meter(usage, USAGE_ORDER)} ${legend(usage, USAGE_ORDER, USAGE)}
        </div>
        <div class="card pad">
          <h2>Изучено в тренажёре</h2>
          ${meter(study, STUDY_ORDER)} ${legend(study, STUDY_ORDER, STUDY)}
        </div>
      </section>

      <section class="section">
        <h2>Болевые темы</h2>
        ${weak.length
          ? html`<div class="card pad painlist">${weak.map(
              (w) => html`<a href="#/topic/${encodeURIComponent(w.topic_id || w.topicId)}">
                <span class="pt">${w.title}</span>
                <span class="faint" style="font-size:13px">${w.title_ru || w.titleRu || ''}</span>
                <span class="pn">${w.errors || 0} ${plural(w.errors || 0, 'ошибка', 'ошибки', 'ошибок')}</span>
              </a>`
            )}</div>`
          : empty('Болевых тем нет', letters ? 'Либо ты хорош, либо писем пока мало.' : 'Появятся, когда бот разберёт первые письма.')}
      </section>

      <section class="section">
        <a class="btn ghost" href="#/topics">Весь каталог</a>
        <a class="btn ghost" href="#/letters">Письма и разборы</a>
      </section>
    `
  );
}
