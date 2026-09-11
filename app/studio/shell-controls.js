import {initSelectControls} from './select-control.js';
let cleanup = () => {};

export function bindShellControls() {
  cleanup();
  initSelectControls();
  const sidebar = document.getElementById('sidebar'), menu = document.getElementById('menu');
  const backdrop = document.getElementById('menu-backdrop'), close = document.getElementById('menu-close');
  const more = document.getElementById('mobile-more'), content = document.querySelector('.content');
  const mobileNav = document.querySelector('.mobile-nav');
  const narrow = window.matchMedia('(max-width: 900px)');
  let opener = menu;
  function setOpen(open) {
    sidebar.classList.toggle('open', open);
    sidebar.inert = narrow.matches && !open;
    backdrop.hidden = !open;
    content.inert = open;
    mobileNav.inert = open;
    document.body.classList.toggle('menu-is-open', open);
    menu.setAttribute('aria-expanded', String(open));
    more.setAttribute('aria-expanded', String(open));
    if (open) close.focus(); else if (opener.isConnected && opener.getClientRects().length) opener.focus({preventScroll:true});
    else if (document.activeElement === close) document.getElementById('main').focus({preventScroll:true});
  }
  [menu, more].forEach(button => button.onclick = () => {opener = button; setOpen(!sidebar.classList.contains('open'));});
  close.onclick = () => setOpen(false);
  backdrop.onclick = () => setOpen(false);
  sidebar.onclick = event => {if (event.target.closest('a[href^="#/"]') && sidebar.classList.contains('open')) setOpen(false);};
  sidebar.onkeydown = event => {
    if (!sidebar.classList.contains('open')) return;
    if (event.key === 'Escape') {event.preventDefault();setOpen(false);return;}
    if (event.key !== 'Tab') return;
    const targets = [...sidebar.querySelectorAll('a,button')].filter(node => node.getClientRects().length);
    const first = targets[0], last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
  };
  const adapt = () => {
    if (!sidebar.isConnected) {narrow.removeEventListener('change', adapt);return;}
    if (!narrow.matches && sidebar.classList.contains('open')) setOpen(false);
    sidebar.inert = narrow.matches && !sidebar.classList.contains('open');
  };
  narrow.addEventListener('change', adapt); adapt();
  cleanup = () => narrow.removeEventListener('change', adapt);
  document.body.classList.remove('menu-is-open');
}
