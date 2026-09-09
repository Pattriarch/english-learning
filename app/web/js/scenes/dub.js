// dub — «Дубляж»: русская реплика → твой перевод → эталон и самооценка.
import { html, setHTML, $ } from '../dom.js';
import { md } from '../markdown.js';

export function mountDub(root, scene, ctx) {
  const steps = scene.steps || [];
  let i = 0;

  function draw() {
    const s = steps[i];
    setHTML(
      root,
      html`
        <div class="card pad stack">
          <div>
            <div class="scenekind">Дубляж</div>
            ${scene.show_ru ? html`<p class="muted" style="margin:8px 0 0;font-size:14px">${scene.show_ru}</p>` : ''}
          </div>
          <div class="faint" style="font-size:13.5px">${s.scene_ru || ''}</div>
          <div class="dubline">${s.line_ru || ''}</div>
          <textarea id="ans" rows="3" placeholder="как это скажут по-английски" spellcheck="false"></textarea>
          <div class="actions">
            <button class="btn primary" id="cmp">Сравнить</button>
            <span class="faint" style="font-size:12px">реплика ${i + 1} из ${steps.length}</span>
          </div>
          <div id="after"></div>
        </div>
      `
    );
    const ta = $('#ans', root);
    ta.focus();
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') compare();
    });
    $('#cmp', root).addEventListener('click', compare);
  }

  function compare() {
    const s = steps[i];
    const mine = $('#ans', root).value.trim();
    $('#ans', root).disabled = true;
    $('#cmp', root).disabled = true;
    setHTML(
      $('#after', root),
      html`
        <div class="refbox">
          <div class="rl">эталон</div>
          <div class="rv">${s.reference || ''}</div>
          ${s.alt ? html`<div class="rl">тоже ок</div><div class="rv alt">${s.alt}</div>` : ''}
          <div class="rl">разбор</div>
          <div class="md" style="margin-top:4px">${md(s.note_ru || '')}</div>
        </div>
        <div class="actions" style="flex-wrap:wrap">
          <span class="faint" style="font-size:13px">честно:</span>
          <button class="btn" data-v="hit">совпал</button>
          <button class="btn" data-v="close">близко</button>
          <button class="btn" data-v="miss">мимо</button>
        </div>
      `
    );
    $('#after', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      const v = b.dataset.v;
      ctx.report(v !== 'miss', 'dub: ' + v + ' | ' + mine);
      if (i === steps.length - 1) ctx.next();
      else { i++; draw(); }
    });
  }

  if (!steps.length) {
    setHTML(root, html`<div class="err">В сцене нет реплик</div>`);
    return null;
  }
  draw();
  return null;
}
