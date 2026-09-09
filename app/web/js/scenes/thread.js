// thread — фейк-мессенджер: «печатает…», пузыри, вердикт под выбранной репликой.
import { html, setHTML, $, $$, shuffle, esc } from '../dom.js';
import { mdInline } from '../markdown.js';

const TYPING = 700;

export function mountThread(root, scene, ctx) {
  const steps = scene.steps || [];
  const contact = scene.contact || {};
  let i = 0;
  let timers = [];
  let dead = false;

  const wait = (ms) =>
    new Promise((res) => {
      const t = setTimeout(res, ms);
      timers.push(t);
    });

  setHTML(
    root,
    html`
      <div class="chat">
        <div class="chathead">
          <span class="av">${contact.emoji || '💬'}</span>
          <div>
            <div style="font-weight:600">${contact.name || 'Собеседник'}</div>
            <div class="faint" style="font-size:12.5px">${contact.desc_ru || ''}</div>
          </div>
        </div>
        <div class="msgs" id="msgs"></div>
      </div>
      ${scene.intro_ru ? html`<p class="faint" style="font-size:13px;margin:10px 0 0">${scene.intro_ru}</p>` : ''}
      <div id="panel"></div>
    `
  );

  const msgs = $('#msgs', root);
  const panel = $('#panel', root);

  function add(cls, text) {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    msgs.appendChild(div);
    div.scrollIntoView({ block: 'nearest' });
    return div;
  }

  async function step() {
    const s = steps[i];
    setHTML(panel, '');
    for (const line of s.incoming || []) {
      const dots = add('bub in typing', '···');
      await wait(TYPING);
      if (dead) return;
      dots.remove();
      add('bub in', line);
      await wait(120);
      if (dead) return;
    }
    const opts = shuffle((s.options || []).map((o, k) => ({ o, k })));
    setHTML(
      panel,
      html`<div class="choices">
        ${opts.map(({ o, k }) => html`<button class="choice" data-k="${k}">${o.text}</button>`)}
      </div>`
    );
    $$('.choice', panel).forEach((b) =>
      b.addEventListener('click', () => pick(Number(b.dataset.k)), { once: true })
    );
  }

  function pick(k) {
    const s = steps[i];
    const o = (s.options || [])[k];
    const verdict = o.verdict || 'error';
    add('bub out', o.text);
    const note = document.createElement('div');
    note.className = 'note-under note-' + esc(verdict);
    setHTML(note, mdInline(o.note_ru || ''));
    msgs.appendChild(note);
    note.scrollIntoView({ block: 'nearest' });

    ctx.report(verdict === 'natural', 'thread: ' + o.text);

    const last = i === steps.length - 1;
    setHTML(
      panel,
      html`<div class="actions">
        <span class="mono s-${verdict === 'natural' ? 'active' : verdict === 'textbook' ? 'shaky' : 'struggling'}" style="font-size:12px">${label(verdict)}</span>
        <span class="spacer"></span>
        <button class="btn primary" id="go">${last ? 'Чем кончилось' : 'Дальше'}</button>
      </div>`
    );
    $('#go', panel).addEventListener('click', () => (last ? outro() : (i++, step())));
  }

  function outro() {
    setHTML(
      panel,
      html`<div class="card pad stack" style="margin-top:14px">
        <div class="muted" style="font-size:14px">${scene.outro_ru || ''}</div>
        <div class="actions"><button class="btn primary" id="next">Дальше</button></div>
      </div>`
    );
    $('#next', panel).addEventListener('click', () => ctx.next());
  }

  if (!steps.length) {
    setHTML(panel, html`<div class="err">В треде нет шагов</div>`);
    return null;
  }
  step();

  return {
    destroy() {
      dead = true;
      timers.forEach(clearTimeout);
      timers = [];
    },
  };
}

function label(v) {
  if (v === 'natural') return 'так и говорят';
  if (v === 'textbook') return 'правильно, но по-учебниковому';
  return 'ошибка';
}
