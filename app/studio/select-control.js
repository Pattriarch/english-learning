// Keep the native select as the form value and event source. The picker is only
// its presentation, so existing settings/filter handlers remain unchanged.
const controls = new WeakMap();
let observer, picker, active, visible = [], cursor = 0;

function labelFor(select) {
  if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
  const labels = [...(select.labels || [])].map(label => {
    const copy = label.cloneNode(true);
    copy.querySelectorAll('select,button,input,textarea').forEach(node => node.remove());
    return copy.textContent.trim();
  });
  return labels.join(' ') || 'Выбрать вариант';
}
function optionsFor(select) {
  return [...select.options].map((option, index) => ({option, index, label: option.textContent.trim(),
    disabled: option.disabled || option.parentElement?.disabled, selected: option.selected}));
}
export function syncSelect(select) {
  const button = controls.get(select);
  if (!button) return;
  button.querySelector('span').textContent = select.selectedOptions[0]?.textContent || 'Выбрать';
  button.disabled = select.matches(':disabled');
  button.setAttribute('aria-label', `${labelFor(select)}: ${button.textContent}`);
}
function highlight(index) {
  cursor = Math.max(0, Math.min(index, visible.length - 1));
  const list = picker.querySelector('[role=listbox]');
  list.querySelectorAll('[role=option]').forEach((node, i) => node.classList.toggle('is-focused', i === cursor));
  if (visible.length) {
    const id = `picker-option-${visible[cursor].index}`;
    list.setAttribute('aria-activedescendant', id);
    picker.querySelector('input').setAttribute('aria-activedescendant', id);
    document.getElementById(id)?.scrollIntoView({block: 'nearest'});
  } else {list.removeAttribute('aria-activedescendant');picker.querySelector('input').removeAttribute('aria-activedescendant');}
}
function choose(item) {
  if (!active?.select.isConnected) return;
  const {select} = active;
  const index = [...select.options].indexOf(item.option);
  if (select.matches(':disabled') || index < 0 || item.option.disabled || item.option.parentElement?.disabled) {drawOptions(picker.querySelector('input').value);return;}
  const changed = select.selectedIndex !== index;
  select.selectedIndex = index;
  syncSelect(select);
  picker.close();
  if (changed) {
    select.dispatchEvent(new Event('input', {bubbles: true}));
    select.dispatchEvent(new Event('change', {bubbles: true}));
  }
}
function drawOptions(query = '') {
  const list = picker.querySelector('[role=listbox]');
  const needle = query.trim().toLocaleLowerCase('ru');
  visible = optionsFor(active.select).filter(item => !item.disabled && item.label.toLocaleLowerCase('ru').includes(needle));
  list.replaceChildren();
  visible.forEach(item => {
    const option = document.createElement('div');
    option.id = `picker-option-${item.index}`;
    option.role = 'option';
    option.setAttribute('aria-selected', String(item.selected));
    option.textContent = item.label;
    option.onclick = () => choose(item);
    list.append(option);
  });
  picker.querySelector('.select-empty').hidden = visible.length > 0;
  picker.querySelector('.select-result-count').textContent = `${visible.length} вариантов`;
  highlight(Math.max(0, visible.findIndex(item => item.selected)));
}
function ensurePicker() {
  if (picker) return;
  picker = document.createElement('dialog');
  picker.className = 'select-picker';
  picker.setAttribute('aria-labelledby', 'select-picker-title');
  picker.innerHTML = '<div class="select-picker-head"><h2 id="select-picker-title"></h2><button type="button" class="select-close" aria-label="Закрыть выбор">×</button></div><input class="select-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="select-picker-options" placeholder="Найти вариант…" aria-label="Поиск вариантов" autocomplete="off"><div class="select-result-count" role="status"></div><div id="select-picker-options" class="select-options" role="listbox" tabindex="0" aria-labelledby="select-picker-title"></div><p class="select-empty" hidden>Ничего не найдено. Попробуй другое слово.</p>';
  document.body.append(picker);
  picker.querySelector('.select-close').onclick = () => picker.close();
  picker.querySelector('input').oninput = event => drawOptions(event.target.value);
  picker.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); highlight(cursor + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && (event.target.matches('input') || event.target.role === 'listbox')) {
      event.preventDefault(); if (visible[cursor]) choose(visible[cursor]);
    } else if (event.target.role === 'listbox' && ['Home', 'End'].includes(event.key)) {
      event.preventDefault(); highlight(event.key === 'Home' ? 0 : visible.length - 1);
    }
  };
  picker.onclick = event => {
    if (event.target !== picker) return;
    const rect = picker.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) picker.close();
  };
  picker.onclose = () => {
    active?.button.setAttribute('aria-expanded', 'false');
    if (active?.button.isConnected) active.button.focus({preventScroll:true});
    active = null;
  };
}
function openPicker(select, button) {
  if (select.matches(':disabled')) return;
  ensurePicker(); active = {select, button};
  const title = labelFor(select), search = picker.querySelector('input');
  picker.querySelector('h2').textContent = title;
  search.value = '';
  search.hidden = select.options.length <= 10;
  picker.querySelector('.select-result-count').hidden = search.hidden;
  const rect = button.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 320), window.innerWidth - 32);
  picker.style.setProperty('--picker-left', `${Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))}px`);
  picker.style.setProperty('--picker-top', `${Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 420))}px`);
  picker.style.setProperty('--picker-width', `${width}px`);
  picker.showModal(); drawOptions();
  // Account for the actual search/header height rather than assuming every
  // picker has the same height near the bottom edge of a short screen.
  if (window.innerWidth > 680) {
    const height = picker.getBoundingClientRect().height;
    picker.style.setProperty('--picker-top', `${Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - height - 16))}px`);
  }
  button.setAttribute('aria-expanded', 'true');
  (search.hidden ? picker.querySelector('[role=listbox]') : search).focus();
}
export function enhanceSelects(root = document.getElementById('app')) {
  root?.querySelectorAll('select:not([multiple])').forEach(select => {
    if (select.size > 1 || select.closest('[hidden]')) return;
    if (controls.has(select)) { syncSelect(select); return; }
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'select-trigger';
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span></span><i aria-hidden="true"></i>';
    controls.set(select, button);
    select.classList.add('select-native');
    select.after(button); syncSelect(select);
    select.addEventListener('change', () => syncSelect(select));
    button.onclick = () => openPicker(select, button);
  });
  if (active) {
    if (!active.select.isConnected || active.select.matches(':disabled')) picker.close();
    else {
      const search = picker.querySelector('input');
      search.hidden = active.select.options.length <= 10;
      picker.querySelector('.select-result-count').hidden = search.hidden;
      drawOptions(search.hidden ? '' : search.value);
    }
  }
}
export function initSelectControls() {
  if (observer) return;
  const root = document.getElementById('app');
  observer = new MutationObserver(records => {
    if (records.some(record => record.target instanceof Element && (record.target.closest('select') || record.target.matches('fieldset')) ||
      [...record.addedNodes].some(node => node instanceof Element && (node.matches('select') || node.querySelector('select'))) ||
      (active && !active.select.isConnected))) enhanceSelects(root);
  });
  observer.observe(root, {childList:true, subtree:true, attributes:true, attributeFilter:['disabled','selected']});
  enhanceSelects(root);
}
