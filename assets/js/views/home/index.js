// Landing page (#/home): the campaign poster with the way into the tabs. It has no sidebar tab (`menu: false`);
// the sidebar title opens it, and the first time a device opens the site without a route it lands here.
// Fitting the poster (never stretched, painted lettering never cut off) is all in assets/css/home.css.
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { allViews, href } from '../../core/router.js';

const SEEN_KEY = 'sw:home:seen'; // localStorage, per device: set once the landing page has been shown here
const LINKS = ['characters', 'journal', 'quests', 'compendium', 'wardens-library']; // under "Open the map"
const POSTER = 'assets/img/stone-wardens-poster'; // -960/-1600/-2560.webp, made from References/StoneWardensPoster1.png
const WIDTHS = [960, 1600, 2560];

const seen = () => { try { return !!localStorage.getItem(SEEN_KEY); } catch { return true; } };

/** main.js calls this before the router starts: on this device's first visit a URL without a route (no `#/view`)
 *  opens the landing page instead of the default view. Deep links are left alone. */
export function routeFirstVisit() {
  const bare = !location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\//g, '');
  if (bare && !seen()) history.replaceState(null, '', '#/home');
}

function build(el) {
  const views = new Map(allViews().map((v) => [v.id, v]));
  const link = (id) => {
    const v = views.get(id);
    return v ? h('li', null, h('a', { class: 'btn btn-sm home-link', href: href(id) }, icon(v.icon || 'file'), h('span', null, v.title))) : null;
  };
  el.append(h('div', { class: 'home' },
    h('h1', { class: 'sr-only' }, 'The Stone Wardens: A Fallen Firmament Campaign'),
    h('div', { class: 'home-poster' },
      h('img', {
        class: 'home-art',
        src: `${POSTER}-1600.webp`,
        srcset: WIDTHS.map((w) => `${POSTER}-${w}.webp ${w}w`).join(', '),
        sizes: '(max-width: 759px) 100vw, calc(100vw - 232px)',
        width: 4000, height: 2700, decoding: 'async', fetchpriority: 'high',
        alt: 'A stone statue stands alone on a green hill under a wide blue sky. The gods and destiny await.',
      }),
      h('nav', { class: 'home-start', 'aria-label': 'Begin' },
        views.has('map') ? h('a', { class: 'btn btn-primary home-enter', href: href('map') }, icon(views.get('map').icon || 'map'), h('span', null, 'Open the map')) : null,
        h('ul', { class: 'home-links', role: 'list' }, LINKS.map(link)))),
  ));
}

export default {
  id: 'home',
  title: 'Home',
  icon: 'emblem',
  menu: false, // no sidebar tab (main.js buildSidebar)
  mount: build,
  show() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked: it shows again next time */ }
    document.title = 'The Stone Wardens';
  },
};
