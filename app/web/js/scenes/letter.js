// letter — «Чужое письмо»: тыкаешь в подозрительные куски, потом раскрытие.
import { html, setHTML, $, $$, plural } from '../dom.js';
import { mdInline } from '../markdown.js';

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

export function mountLetter(root, scene, ctx) {
  const segs = scene.segments || [];
  const marked = new Set();
  let done = false;

  // Кликабельны все error-сегменты и «обманки» длиной >2 слов.
  const clickable = new Set();
  segs.forEach((s, i) => {
    if (s.error || words(s.text) > 2) clickable.add(i);
  });

  function body() {
    return html`${segs.map((s, i) =>
      clickable.has(i)
        ? html`<span class="seg click" data-i="${i}">${s.text}</span>`
        : html`<span class="seg">${s.text}</span>`
    )}`;
  }

  function draw() {
    setHTML(
      root,
      html`<div class="card pad stack">
        <div>
          <div class="scenekind">Чужое письмо</div>
          <p class="muted" style="margin:8px 0 0;font-size:14px">${scene.from_ru || ''}</p>
        </div>
        <div class="ltext" id="text">${body()}</div>
        <div class="actions">
          <button class="btn primary" id="done">Готово</button>
          <span class="faint" style="font-size:13px" id="cnt">отмечено 0</span>
        </div>
        <div id="after"></div>
      </div>`
    );
    $('#text', root).addEventListener('click', (e) => {
      const el = e.target.closest('.seg.click');
      if (!el || done) return;
      const i = Number(el.dataset.i);
      if (marked.has(i)) marked.delete(i);
      else marked.add(i);
      el.classList.toggle('marked', marked.has(i));
      $('#cnt', root).textContent = 'отмечено ' + marked.size;
    });
    $('#done', root).addEventListener('click', reveal);
  }

  function reveal() {
    if (done) return;
    done = true;
    const errors = [];
    $$('.seg', root).forEach((el) => {
      const i = Number(el.dataset.i);
      const s = Number.isFinite(i) ? segs[i] : null;
      if (!s) return;
      el.classList.remove('marked', 'click');
      if (s.error) {
        const found = marked.has(i);
        el.classList.add(found ? 'found' : 'missed');
        errors.push({ seg: s, found });
      } else if (marked.has(i)) {
        el.classList.add('falsepos');
      }
    });

    const found = errors.filter((e) => e.found).length;
    const falsePos = [...marked].filter((i) => !segs[i].error).length;
    errors.forEach((e) =>
      ctx.report(e.found, 'letter: ' + (e.found ? 'нашёл' : 'пропустил') + ' «' + e.seg.text + '»')
    );

    $('#done', root).disabled = true;
    $('#cnt', root).textContent = '';
    setHTML(
      $('#after', root),
      html`
        <div class="row wrap" style="gap:26px;margin-top:20px">
          <div class="streak s-active">${found}/${errors.length}<small>ошибок найдено</small></div>
          ${falsePos
            ? html`<div class="streak s-shaky">${falsePos}<small>${plural(falsePos, 'ложная тревога', 'ложные тревоги', 'ложных тревог')}</small></div>`
            : ''}
        </div>
        <div style="margin-top:18px">
          <h2>Разбор</h2>
          <div class="fixlist">
            ${errors.map(
              (e) => html`<div class="fi">
                <span class="${e.found ? 'a' : 'q'}">${e.found ? '✓' : '✗'}</span>
                <span class="q">${e.seg.text}</span>
                <span class="faint"> → </span>
                <span class="a">${e.seg.fix || ''}</span>
                ${e.seg.note_ru ? html`<div class="why">${mdInline(e.seg.note_ru)}</div>` : ''}
              </div>`
            )}
          </div>
        </div>
        ${scene.corrected
          ? html`<div style="margin-top:18px">
              <h2>Как надо целиком</h2>
              <div class="lettertext">${scene.corrected}</div>
            </div>`
          : ''}
        <div class="actions"><button class="btn primary" id="next">Дальше</button></div>
      `
    );
    $('#next', root).addEventListener('click', () => ctx.next());
  }

  if (!segs.length) {
    setHTML(root, html`<div class="err">В письме нет сегментов</div>`);
    return null;
  }
  draw();
  return null;
}
