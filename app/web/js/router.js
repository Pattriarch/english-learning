// Hash-роутинг: #/ , #/topics , #/topic/:id , #/lesson/:id , #/letters
import { esc } from './dom.js';

const routes = [];
let root = null;
let current = null;

export function route(pattern, handler) {
  const names = [];
  const rx = new RegExp(
    '^' +
      pattern.replace(/:([a-z]+)/gi, (_, n) => {
        names.push(n);
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ rx, names, handler });
}

export function go(path) {
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

export function parse() {
  let h = location.hash.replace(/^#/, '');
  if (!h || h === '/') return '/';
  return h.replace(/\/+$/, '') || '/';
}

function markNav(path) {
  const key = path === '/' ? 'dash' : path.startsWith('/letters') ? 'letters' : 'topics';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === key));
}

async function render() {
  const path = parse();
  markNav(path);
  const hit = routes.find((r) => r.rx.test(path));
  if (current && current.destroy) {
    try { current.destroy(); } catch (e) { /* ignore */ }
  }
  current = null;
  if (!hit) {
    root.innerHTML = '<div class="empty"><b>Страницы нет</b>Проверь ссылку.</div>';
    return;
  }
  const m = hit.rx.exec(path);
  const params = {};
  hit.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
  root.innerHTML = '<div class="faint">Загрузка…</div>';
  try {
    current = (await hit.handler(root, params)) || null;
  } catch (e) {
    console.error(e);
    root.innerHTML = '<div class="err">Не загрузилось: ' + esc(e && e.message ? e.message : e) + '</div>';
  }
}

export function start(mount) {
  root = mount;
  addEventListener('hashchange', render);
  render();
}
