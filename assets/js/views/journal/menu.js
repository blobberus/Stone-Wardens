// Context / dropdown menu: openMenu({x, y} | {anchor}, items) with keyboard support.
// items: [{label, icon, onClick, danger, checked, disabled, hint}] | {sep: true} | {heading: 'Text'}
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';

let current = null;

export function closeMenu() { current?.close(); }

export function openMenu({ x = 0, y = 0, anchor = null, items = [], label = 'Menu', align = 'start' }) {
  closeMenu();
  const back = document.activeElement;
  const el = h('div', { class: 'jr-menu', role: 'menu', 'aria-label': label, tabindex: '-1' });
  const buttons = [];
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { if (el.lastChild && !el.lastChild.classList.contains('jr-menu-sep')) el.append(h('div', { class: 'jr-menu-sep', role: 'separator' })); continue; }
    if (it.heading) { el.append(h('div', { class: 'jr-menu-heading' }, it.heading)); continue; }
    const b = h('button', {
      type: 'button', class: ['jr-menu-item', it.danger && 'is-danger'], role: it.checked != null ? 'menuitemradio' : 'menuitem',
      'aria-checked': it.checked != null ? String(!!it.checked) : null, disabled: it.disabled, tabindex: '-1',
      onclick: () => { close(); it.onClick?.(); },
    },
    it.checked != null ? h('span', { class: 'jr-menu-check' }, it.checked ? icon('check') : null) : (it.icon ? icon(it.icon) : h('span', { class: 'jr-menu-check' })),
    h('span', { class: 'jr-menu-label' }, it.label),
    it.hint ? h('kbd', { class: 'jr-menu-hint' }, it.hint) : null);
    buttons.push(b);
    el.append(b);
  }
  if (el.lastChild?.classList.contains('jr-menu-sep')) el.lastChild.remove();
  (document.querySelector('body > #overlays') || document.body).append(el);

  // position: keep inside the viewport
  const r = el.getBoundingClientRect();
  let left = x;
  let top = y;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = align === 'end' ? a.right - r.width : a.left;
    top = a.bottom + 4;
    if (top + r.height > innerHeight - 8) top = Math.max(8, a.top - r.height - 4);
  } else if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
  left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;

  const enabled = () => buttons.filter((b) => !b.disabled);
  const focusAt = (i) => { const list = enabled(); if (list.length) list[(i + list.length) % list.length].focus(); };
  el.addEventListener('keydown', (e) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i < 0 ? -1 : i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') { e.preventDefault(); close(true); }
  });
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  const onScroll = (e) => { if (!el.contains(e.target)) close(); };
  const onBlur = () => close();
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onBlur);
    window.addEventListener('blur', onBlur);
  }, 0);
  let closed = false;
  function close(restore = false) {
    if (closed) return;
    closed = true;
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onBlur);
    window.removeEventListener('blur', onBlur);
    if (current?.el === el) current = null;
    if (restore && back?.isConnected) back.focus?.();
  }
  current = { el, close };
  requestAnimationFrame(() => focusAt(Math.max(0, enabled().findIndex((b) => b.getAttribute('aria-checked') === 'true'))));
  return current;
}
