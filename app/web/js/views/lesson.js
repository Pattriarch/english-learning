import { getLesson, getTopic, postProgress, lessonStart } from '../api.js';
import { html, setHTML, empty, $, plural } from '../dom.js';
import { SCENES, SCENE_LABEL } from '../scenes/index.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export async function lesson(root, { id }) {
  const [data, topicData] = await Promise.all([getLesson(id), getTopic(id).catch(() => null)]);

  if (!data || !Array.isArray(data.scenes) || !data.scenes.length) {
    setHTML(
      root,
      html`<a class="faint" href="#/topic/${encodeURIComponent(id)}" style="font-size:13px">← тема</a>
        <h1 style="margin-top:10px">Урок не создан</h1>
        <p class="sub">Для этой темы упражнений пока нет. Теория на странице темы уже есть.</p>
        ${empty('Пусто', 'Уроки добавляются постепенно — по самым болевым темам первым делом.')}`
    );
    return null;
  }

  const scenes = data.scenes;
  const start = lessonStart(topicData);
  let idx = clamp(start.sceneIdx | 0, 0, scenes.length);
  let score = Object.assign({ passed: 0, failed: 0, streakBest: 0, done: false }, start.score || {});
  let streak = 0;
  let live = null;

  setHTML(
    root,
    html`
      <div class="lhead">
        <a class="faint" href="#/topic/${encodeURIComponent(id)}" style="font-size:13px">← ${data.title || id}</a>
        <span class="spacer"></span>
        <span class="scenekind" id="kind"></span>
      </div>
      <div class="steps" id="steps"></div>
      <div id="stage"></div>
    `
  );

  const stage = $('#stage', root);
  const stepsEl = $('#steps', root);
  const kindEl = $('#kind', root);

  function drawSteps() {
    setHTML(
      stepsEl,
      html`${scenes.map((_, i) => html`<i class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></i>`)}`
    );
    const s = scenes[idx];
    kindEl.textContent = s ? (SCENE_LABEL[s.type] || s.type) + ' · ' + (idx + 1) + '/' + scenes.length : 'итог';
  }

  function save(event, detail) {
    return postProgress({ topicId: id, sceneIdx: idx, event, detail: detail || '', score });
  }

  const ctx = {
    topicId: id,
    report(pass, detail) {
      if (pass) {
        score.passed++;
        streak++;
        score.streakBest = Math.max(score.streakBest, streak);
      } else {
        score.failed++;
        streak = 0;
      }
      save(pass ? 'ex_pass' : 'ex_fail', detail);
    },
    next() {
      idx++;
      if (idx >= scenes.length) {
        score.done = true;
        save('', 'lesson_done');
        finish();
      } else {
        save('', 'scene_' + idx);
        show();
      }
    },
  };

  function teardown() {
    if (live && live.destroy) {
      try { live.destroy(); } catch (e) { /* ignore */ }
    }
    live = null;
  }

  function show() {
    teardown();
    drawSteps();
    const scene = scenes[idx];
    const mount = SCENES[scene && scene.type];
    if (!mount) {
      setHTML(stage, html`<div class="err">Неизвестный тип сцены: ${(scene && scene.type) || '—'}</div>`);
      setTimeout(() => ctx.next(), 0);
      return;
    }
    stage.scrollIntoView({ block: 'nearest' });
    live = mount(stage, scene, ctx) || null;
  }

  function finish() {
    teardown();
    drawSteps();
    const total = score.passed + score.failed;
    const pct = total ? Math.round((score.passed / total) * 100) : 0;
    setHTML(
      stage,
      html`<div class="card pad stack">
        <h3>Урок пройден</h3>
        <div class="row wrap" style="gap:26px">
          <div><div class="streak">${pct}%<small>точность</small></div></div>
          <div><div class="streak s-active">${score.passed}<small>верно</small></div></div>
          <div><div class="streak s-struggling">${score.failed}<small>мимо</small></div></div>
          <div><div class="streak">${score.streakBest}<small>лучшая серия</small></div></div>
        </div>
        <p class="muted" style="font-size:14px">
          ${pct >= 85
            ? 'Тема закрыта. Проверка будет в письмах.'
            : total
            ? 'Ниже 85% — тема остаётся в работе. Имеет смысл прогнать ещё раз через пару дней.'
            : 'Ответов не засчитано.'}
        </p>
        <div class="actions">
          <a class="btn primary" href="#/topic/${encodeURIComponent(id)}">К теме</a>
          <button class="btn ghost" id="again">Пройти заново</button>
          <a class="btn ghost" href="#/topics">Каталог</a>
        </div>
      </div>`
    );
    $('#again', stage).addEventListener('click', () => {
      idx = 0;
      score = { passed: 0, failed: 0, streakBest: 0, done: false };
      streak = 0;
      show();
    });
  }

  if (idx >= scenes.length) finish();
  else {
    if (idx > 0) {
      setHTML(
        stage,
        html`<div class="card pad stack">
          <h3>Ты остановился на сцене ${idx + 1}</h3>
          <p class="muted" style="font-size:14px">
            Всего ${scenes.length} ${plural(scenes.length, 'сцена', 'сцены', 'сцен')}.
          </p>
          <div class="actions">
            <button class="btn primary" id="resume">Продолжить</button>
            <button class="btn ghost" id="restart">С начала</button>
          </div>
        </div>`
      );
      drawSteps();
      $('#resume', stage).addEventListener('click', show);
      $('#restart', stage).addEventListener('click', () => {
        idx = 0;
        show();
      });
    } else show();
  }

  return { destroy: teardown };
}
