// radar — блиц: 7 секунд на карточку, ✓ / ✗, комбо, разбор в конце.
import { html, setHTML, $ } from '../dom.js';
import { mdInline } from '../markdown.js';

const LIMIT = 7000;

export function mountRadar(root, scene, ctx) {
  const cards = scene.cards || [];
  let i = -1;
  let combo = 0;
  let best = 0;
  let answered = true;
  let tick = null;
  let hop = null;
  const wrong = [];

  const clear = () => { clearTimeout(tick); clearTimeout(hop); tick = hop = null; };

  function intro() {
    setHTML(
      root,
      html`<div class="card pad stack">
        <div class="scenekind">Радар</div>
        <h3>${cards.length} карточек, 7 секунд на каждую</h3>
        <p class="muted" style="font-size:14px">${scene.intro_ru || 'Звучит по-американски — ✓, режет ухо — ✗.'}</p>
        <p class="faint" style="font-size:13px">Клавиши: ← не звучит, → звучит. Просрочил — не засчитано.</p>
        <div class="actions"><button class="btn primary" id="start">Поехали</button></div>
      </div>`
    );
    $('#start', root).addEventListener('click', next);
  }

  function next() {
    i++;
    if (i >= cards.length) return finish();
    const c = cards[i];
    answered = false;
    setHTML(
      root,
      html`<div class="radar">
        <div class="timerbar" id="bar"></div>
        <div class="radarbody">
          <div class="radarphrase" id="phrase">${c.phrase || ''}</div>
          <div class="radarbtns">
            <button class="btn" data-ok="0">✗</button>
            <button class="btn" data-ok="1">✓</button>
          </div>
          <div class="flash" id="flash"></div>
        </div>
        <div class="combo">
          <span>${i + 1} / ${cards.length}</span>
          <span>комбо <b id="combo">${combo}</b></span>
        </div>
      </div>`
    );
    const bar = $('#bar', root);
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => {
      bar.style.transition = `width ${LIMIT}ms linear`;
      bar.style.width = '0%';
    });
    tick = setTimeout(() => answer(null), LIMIT);
  }

  function onClick(e) {
    const b = e.target.closest('[data-ok]');
    if (b) answer(b.dataset.ok === '1');
  }

  function answer(said) {
    if (answered) return;
    answered = true;
    clear();
    const c = cards[i];
    const bar = $('#bar', root);
    if (bar) {
      const w = getComputedStyle(bar).width;
      bar.style.transition = 'none';
      bar.style.width = w;
    }
    const right = said !== null && said === !!c.ok;
    if (right) { combo++; best = Math.max(best, combo); } else { combo = 0; wrong.push({ card: c, timeout: said === null }); }
    $('#combo', root).textContent = combo;
    root.querySelectorAll('[data-ok]').forEach((b) => {
      b.disabled = true;
      if ((b.dataset.ok === '1') === !!c.ok) b.classList.add('pick-ok');
    });
    ctx.report(right, 'radar: ' + (c.phrase || '') + (said === null ? ' (просрочено)' : ''));

    setHTML(
      $('#flash', root),
      html`<div class="s-${right ? 'active' : 'struggling'}" style="font-size:13px;font-family:var(--mono)">
          ${said === null ? '7 секунд вышли' : right ? 'в точку' : 'мимо'}
        </div>
        <div style="margin-top:4px">${mdInline(c.flash_ru || '')}</div>
        ${c.fix ? html`<div class="fx" style="margin-top:4px">→ ${c.fix}</div>` : ''}`
    );
    hop = setTimeout(next, 2200);
  }

  function finish() {
    clear();
    const total = cards.length;
    const ok = total - wrong.length;
    setHTML(
      root,
      html`<div class="card pad stack">
        <div class="scenekind">Радар · итог</div>
        <div class="row wrap" style="gap:26px">
          <div class="streak">${ok}/${total}<small>попаданий</small></div>
          <div class="streak">${best}<small>лучшее комбо</small></div>
        </div>
        ${wrong.length
          ? html`<div>
              <h2 style="margin-top:8px">Что не поймал</h2>
              <div class="misslist">
                ${wrong.map(
                  (w) => html`<div class="mi">
                    <div class="${w.card.ok ? 'mf' : 'mp'}">${w.card.phrase}</div>
                    ${w.card.fix ? html`<div class="mf">${w.card.fix}</div>` : ''}
                    <div class="muted" style="font-size:13px;margin-top:3px">
                      ${mdInline(w.card.flash_ru || '')}${w.timeout ? ' · не успел' : ''}
                    </div>
                  </div>`
                )}
              </div>
            </div>`
          : html`<p class="muted" style="font-size:14px">Чисто. Все ${total} на месте.</p>`}
        <div class="actions"><button class="btn primary" id="next">Дальше</button></div>
      </div>`
    );
    $('#next', root).addEventListener('click', () => ctx.next());
  }

  function onKey(e) {
    if (answered) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (hop) { clear(); next(); } }
      return;
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); answer(false); }
    if (e.key === 'ArrowRight') { e.preventDefault(); answer(true); }
  }
  addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);

  const detach = {
    destroy() {
      clear();
      removeEventListener('keydown', onKey);
      root.removeEventListener('click', onClick);
    },
  };

  if (!cards.length) {
    setHTML(root, html`<div class="err">В радаре нет карточек</div>`);
    return detach;
  }
  intro();
  return detach;
}
