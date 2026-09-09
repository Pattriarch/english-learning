// Минимальный markdown: заголовки, **жирный**, *курсив*, `код`, списки, ---.
// Таблицы и ссылки сознательно не поддержаны.
import { esc, raw } from './dom.js';

function inline(text) {
  let s = esc(text);
  // `код` — первым, чтобы не ловить ** внутри
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return '\0' + (codes.length - 1) + '\0';
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,!?):;])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,!?):;])/g, '$1<em>$2</em>');
  s = s.replace(/\0(\d+)\0/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

/** Возвращает Raw-разметку. Оборачивай в <div class="md">. */
export function md(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // 'ul' | 'ol'

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      const lvl = Math.min(h[1].length, 3);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^(---+|\*\*\*+|___+)$/.test(t)) { flush(); out.push('<hr>'); continue; }

    const ul = /^[-*+]\s+(.*)$/.exec(t);
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      flushPara();
      if (list !== kind) { flushList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }

    if (list) { // продолжение пункта списка
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(t) + '</li>');
      continue;
    }
    para.push(t);
  }
  flush();
  return raw(out.join('\n'));
}

/** Нарратив сцен: то же, но однострочно и без обёртки <p> для одиночной строки. */
export const mdInline = (src) => raw(inline(String(src || '')));
