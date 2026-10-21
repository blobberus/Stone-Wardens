// Hash router. Views are mounted once (lazily) and then shown/hidden, so heavy views (the map) persist.
import { h } from './dom.js';

const views = new Map();
const listeners = new Set();
let container = null;
let active = null;
let fallback = 'map';

export function registerView(view) {
  views.set(view.id, { order: 100, ...view, el: null, mounted: false });
}

export const allViews = () => [...views.values()].sort((a, b) => a.order - b.order);

export function href(view, ...parts) {
  return `#/${[view, ...parts.filter((p) => p != null && p !== '').map((p) => encodeURIComponent(p))].join('/')}`;
}

export function parse(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { view: segs[0] || fallback, parts: segs.slice(1), query, hash: raw };
}

export const current = () => parse();

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : `#${to.startsWith('/') ? '' : '/'}${to}`;
  if (replace) history.replaceState(null, '', target);
  else if (location.hash !== target) history.pushState(null, '', target);
  render();
}

export function onRoute(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function render() {
  const route = parse();
  let view = views.get(route.view);
  if (!view) { view = views.get(fallback); route.view = fallback; }
  if (!view) return;
  if (active && active !== view) {
    active.el.hidden = true;
    try { active.hide?.(); } catch (e) { console.error(e); }
  }
  if (!view.mounted) {
    view.el = container.querySelector(`[data-view="${view.id}"]`) || container.appendChild(h('section', { class: 'view', 'data-view': view.id }));
    view.mounted = true;
    try { view.mount(view.el); } catch (e) { console.error(`[router] mount ${view.id} failed`, e); }
  }
  view.el.hidden = false;
  active = view;
  document.title = `${view.title} · The Stone Wardens`;
  try { view.show?.(route); } catch (e) { console.error(`[router] show ${view.id} failed`, e); }
  listeners.forEach((fn) => fn(route));
}

export function start(el, { defaultView = 'map' } = {}) {
  container = el;
  fallback = defaultView;
  window.addEventListener('hashchange', render);
  render();
}
