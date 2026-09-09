// case — «Дело №…»: нарратив, выбор, улика.
import { html, setHTML, $, $$ } from '../dom.js';
import { md } from '../markdown.js';

export function mountCase(root, scene, ctx) {
  const steps = scene.steps || [];
  let i = 0;

  function draw() {
    const s = steps[i];
    setHTML(
      root,
      html`
        <div class="card pad stack">
          <div>
            <div class="scenekind">${scene.caseTitle || 'Дело'}</div>
            ${i === 0 && scene.intro_ru ? html`<p class="muted" style="margin:8px 0 0;font-size:14px">${scene.intro_ru}</p>` : ''}
          </div>
          <div class="md">${md(s.narrative || '')}</div>
          <div>
            <h3>${s.question_ru || ''}</h3>
            <div class="choices">
              ${(s.choices || []).map((c, k) => html`<button class="choice" data-k="${k}">${c}</button>`)}
            </div>
          </div>
          <div id="after"></div>
        </div>
        <div class="faint mono" style="margin-top:10px;font-size:12px">
          показание ${i + 1} из ${steps.length}
        </div>
      `
    );

    $$('.choice', root).forEach((b) =>
      b.addEventListener('click', () => pick(Number(b.dataset.k)), { once: true })
    );
  }

  function pick(k) {
    const s = steps[i];
    const right = Number(s.answer) === k;
    $$('.choice', root).forEach((b, n) => {
      b.disabled = true;
      if (n === k) b.classList.add(right ? 'pick-ok' : 'pick-bad');
      else if (n === Number(s.answer) && !right) b.classList.add('reveal');
    });
    ctx.report(right, 'case: ' + (s.choices || [])[k]);

    const last = i === steps.length - 1;
    setHTML(
      $('#after', root),
      html`<div class="verdictbox ${right ? 'ok' : 'bad'}">
          <div class="vh">${right ? 'улика' : 'мимо — но улика та же'}</div>
          <div class="md">${md(s.clue_ru || '')}</div>
        </div>
        <div class="actions">
          <button class="btn primary" id="go">${last ? 'Развязка' : 'Следующее показание'}</button>
        </div>`
    );
    $('#go', root).addEventListener('click', () => (last ? outro() : (i++, draw())));
  }

  function outro() {
    setHTML(
      root,
      html`<div class="card pad stack">
        <div class="scenekind">${scene.caseTitle || 'Дело'} · закрыто</div>
        <div class="md">${md(scene.outro_ru || 'Дело закрыто.')}</div>
        <div class="actions"><button class="btn primary" id="next">Дальше</button></div>
      </div>`
    );
    $('#next', root).addEventListener('click', () => ctx.next());
  }

  if (!steps.length) {
    setHTML(root, html`<div class="err">В сцене нет шагов</div>`);
    return null;
  }
  draw();
  return null;
}
