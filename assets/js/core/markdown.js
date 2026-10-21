// Obsidian-flavoured markdown: wikilinks, embeds, callouts, highlights, comments, tags, tasks, frontmatter.
import { Marked } from '../../../vendor/marked/marked.esm.js';
import DOMPurify from '../../../vendor/dompurify/purify.es.mjs';
import { load as yamlLoad, dump as yamlDump } from '../../../vendor/js-yaml/js-yaml.mjs';
import { resolveLink, parseLink, linkTypes } from './links.js';
import { escapeHtml, slugify, extOf, baseName } from './util.js';
import { store } from './store.js';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']);
const CALLOUT_ALIASES = {
  summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success',
  help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure',
  error: 'danger', cite: 'quote',
};
const TAG_RE = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u;

// ---------- marked extensions ----------

const wikilink = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\[\[([^\]\n]+?)\]\]/.exec(src);
    if (m) return { type: 'wikilink', raw: m[0], body: m[1] };
  },
  renderer(t) {
    const r = resolveLink(t.body);
    const cls = ['wikilink', r.exists ? '' : 'is-unresolved'].filter(Boolean).join(' ');
    return `<a class="${cls}" href="${escapeHtml(r.href || '#')}" data-kind="${escapeHtml(r.kind || '')}" title="${escapeHtml(r.title || '')}">${escapeHtml(r.label)}</a>`;
  },
};

const embed = {
  name: 'embed',
  level: 'inline',
  start: (src) => { const i = src.indexOf('![['); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^!\[\[([^\]\n]+?)\]\]/.exec(src);
    if (m) return { type: 'embed', raw: m[0], body: m[1] };
  },
  renderer(t) {
    const [target, opt] = t.body.split('|').map((s) => s.trim());
    if (IMAGE_EXT.has(extOf(target)) || /^https?:\/\//.test(target)) {
      const width = /^\d+(x\d+)?$/.test(opt || '') ? opt.split('x')[0] : '';
      return `<span class="embed embed-image" data-embed-image="${escapeHtml(target)}" data-width="${width}"></span>`;
    }
    return `<span class="embed" data-embed="${escapeHtml(t.body)}"></span>`;
  },
};

const highlight = {
  name: 'highlight',
  level: 'inline',
  start: (src) => { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^==(?=\S)([\s\S]*?\S)==(?!=)/.exec(src);
    if (m) return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
  },
  renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
};

const tag = {
  name: 'tag',
  level: 'inline',
  start(src) {
    const re = /(^|\s)#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])/gu;
    const m = re.exec(src);
    return m ? m.index + m[1].length : undefined;
  },
  tokenizer(src) {
    const m = TAG_RE.exec(src);
    if (m) return { type: 'tag', raw: m[0], tag: m[1] };
  },
  renderer(t) {
    return `<a class="tag" href="#/journal?tag=${encodeURIComponent(t.tag)}">#${escapeHtml(t.tag)}</a>`;
  },
};

const callout = {
  name: 'callout',
  level: 'block',
  start(src) { const m = /^ {0,3}>\s*\[!/m.exec(src); return m ? m.index : undefined; },
  tokenizer(src) {
    const m = /^( {0,3}>[^\n]*(?:\n|$))+/.exec(src);
    if (!m) return;
    const lines = m[0].replace(/\n$/, '').split('\n').map((l) => l.replace(/^ {0,3}> ?/, ''));
    const head = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/.exec(lines[0].trim());
    if (!head) return;
    const kind = head[1].toLowerCase();
    const token = {
      type: 'callout', raw: m[0], kind: CALLOUT_ALIASES[kind] || kind, fold: head[2],
      title: head[3] || kind.charAt(0).toUpperCase() + kind.slice(1), tokens: [], titleTokens: [],
    };
    this.lexer.blockTokens(lines.slice(1).join('\n'), token.tokens);
    this.lexer.inline(token.title, token.titleTokens);
    return token;
  },
  renderer(t) {
    const cls = ['callout', t.fold ? 'is-collapsible' : '', t.fold === '-' ? 'is-collapsed' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-callout="${escapeHtml(t.kind)}"><div class="callout-title">${this.parser.parseInline(t.titleTokens)}</div>`
      + `<div class="callout-content">${this.parser.parse(t.tokens)}</div></div>`;
  },
  childTokens: ['tokens', 'titleTokens'],
};

const renderer = {
  heading({ tokens, depth, text }) {
    return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  },
  link({ href, title, tokens }) {
    const inner = this.parser.parseInline(tokens);
    const ext = /^(https?:)?\/\//i.test(href || '');
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return ext
      ? `<a class="external" href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<a href="${escapeHtml(href)}"${t}>${inner}</a>`;
  },
};

const md = new Marked({ gfm: true, breaks: true });
md.use({ extensions: [callout, embed, wikilink, highlight, tag], renderer });

// ---------- helpers ----------

/** Apply fn to the parts of src that are not fenced/inline code. */
function outsideCode(src, fn) {
  return src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, i) => (i % 2 ? part : fn(part))).join('');
}

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text || '');
  if (!m) return { data: {}, body: text || '' };
  let data = {};
  try { data = yamlLoad(m[1]) || {}; } catch (e) { console.warn('[markdown] bad frontmatter', e); }
  return { data: typeof data === 'object' && !Array.isArray(data) ? data : {}, body: text.slice(m[0].length) };
}

export function stringifyFrontmatter(data, body = '') {
  const clean = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  if (!Object.keys(clean).length) return body;
  return `---\n${yamlDump(clean, { lineWidth: 120 })}---\n${body.replace(/^\n+/, '')}`;
}

export function extractLinks(src) {
  const out = [];
  outsideCode(String(src || ''), (part) => {
    for (const m of part.matchAll(/(!?)\[\[([^\]\n]+?)\]\]/g)) out.push({ ...parseLink(m[2]), embed: !!m[1], raw: m[2] });
    return part;
  });
  return out;
}

export function extractTags(src) {
  const tags = new Set();
  outsideCode(String(src || ''), (part) => {
    for (const m of part.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) tags.add(m[1]);
    return part;
  });
  const { data } = parseFrontmatter(src);
  [].concat(data.tags || []).forEach((t) => tags.add(String(t).replace(/^#/, '')));
  return [...tags];
}

/** Toggle the n-th task checkbox in markdown source. */
export function toggleTask(src, index, checked) {
  let i = -1;
  return src.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm, (all, a, _x, b) => {
    i += 1;
    return i === index ? `${a}${checked ? 'x' : ' '}${b}` : all;
  });
}

/** Markdown -> sanitized HTML string. Frontmatter is stripped. */
export function renderMarkdown(src) {
  const { body } = parseFrontmatter(String(src ?? ''));
  const pre = outsideCode(body, (part) => part.replace(/%%[\s\S]*?%%/g, ''));
  const html = md.parse(pre);
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], ADD_TAGS: ['input'] });
}

/** Single line of inline markdown (titles, table cells). */
export function renderInline(src) {
  return DOMPurify.sanitize(md.parseInline(String(src ?? '')), { ADD_ATTR: ['target'] });
}

/** Find a file anywhere in the repo by exact path or by file name (Obsidian-style). */
function findFile(name) {
  const all = store.files('');
  return all.find((f) => f.path === name) || all.find((f) => baseName(f.path).toLowerCase() === baseName(name).toLowerCase());
}

/**
 * Render markdown into an element and wire embeds, foldable callouts and task checkboxes.
 * opts: {onTaskToggle(index, checked), depth}
 */
export function renderInto(el, src, opts = {}) {
  const depth = opts.depth || 0;
  el.classList.add('prose');
  el.innerHTML = renderMarkdown(src);

  el.querySelectorAll('.callout.is-collapsible > .callout-title').forEach((t) => {
    t.setAttribute('role', 'button');
    t.tabIndex = 0;
    const toggle = () => t.parentElement.classList.toggle('is-collapsed');
    t.addEventListener('click', toggle);
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  el.querySelectorAll('[data-embed-image]').forEach(async (span) => {
    const target = span.dataset.embedImage;
    const img = document.createElement('img');
    img.alt = baseName(target);
    if (span.dataset.width) img.width = Number(span.dataset.width);
    if (/^https?:\/\//.test(target)) img.src = target;
    else {
      const f = findFile(target);
      if (!f) { span.textContent = `Missing image: ${target}`; span.classList.add('is-missing'); return; }
      img.src = await store.fileUrl(f.path);
    }
    span.replaceChildren(img);
  });

  el.querySelectorAll('[data-embed]').forEach((span) => {
    const p = parseLink(span.dataset.embed);
    const res = resolveLink(span.dataset.embed);
    const type = linkTypes().find((t) => t.prefix === (p.prefix || res.kind));
    let content = null;
    try { content = type?.embed?.(p.target, p.anchor); } catch (e) { console.error(e); }
    const title = document.createElement('a');
    title.className = 'embed-title';
    title.href = res.href || '#';
    title.textContent = res.label;
    const body = document.createElement('div');
    body.className = 'embed-body';
    if (!content) body.textContent = res.exists ? '' : 'Not found.';
    else if (depth >= 2) body.textContent = '…';
    else if (content instanceof Node) body.append(content);
    else renderInto(body, content.markdown ?? String(content), { depth: depth + 1 });
    span.replaceChildren(title, body);
  });

  const boxes = [...el.querySelectorAll('li > input[type="checkbox"]')];
  boxes.forEach((box, i) => {
    box.closest('li')?.classList.add('task-list-item');
    if (!opts.onTaskToggle) return;
    box.disabled = false;
    box.addEventListener('change', () => opts.onTaskToggle(i, box.checked));
  });
  return el;
}
