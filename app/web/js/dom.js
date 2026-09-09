// Мини-хелперы разметки: html`` экранирует всё, что подставляется.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

class Raw {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export const raw = (value) => new Raw(value);

function part(v) {
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v == null || v === false || v === true) return '';
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Raw(out);
}

export function setHTML(node, content) {
  node.innerHTML = content instanceof Raw ? content.value : String(content ?? '');
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Делегирование: on(root, '.choice', 'click', (el, ev) => ...) */
export function on(root, sel, type, fn) {
  root.addEventListener(type, (ev) => {
    const el = ev.target.closest(sel);
    if (el && root.contains(el)) fn(el, ev);
  });
}

export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- словари статусов ---

export const USAGE = {
  active: 'применяю',
  shaky: 'шатко',
  struggling: 'болит',
  unknown: 'не встречалось',
};

export const STUDY = {
  mastered: 'освоено',
  completed: 'пройдено',
  started: 'начато',
  untouched: 'не тронуто',
};

export const USAGE_ORDER = ['active', 'shaky', 'struggling', 'unknown'];
export const STUDY_ORDER = ['mastered', 'completed', 'started', 'untouched'];

export const BOOKS = {
  egiu: 'English Grammar in Use',
  essential: 'Essential Grammar in Use',
  phrasal: 'Phrasal Verbs',
  colloc: 'Collocations',
  vocab: 'Vocabulary in Use',
  slang: 'Сленг и разговорное',
};
export const BOOK_ORDER = ['egiu', 'essential', 'phrasal', 'colloc', 'vocab', 'slang'];

export const EVENT_KIND = {
  letter_error: 'ошибка',
  letter_ok: 'ок в письме',
  ex_pass: 'упр. верно',
  ex_fail: 'упр. мимо',
  theory_read: 'теория',
};

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function empty(title, hint) {
  return html`<div class="empty"><b>${title}</b>${hint || ''}</div>`;
}
