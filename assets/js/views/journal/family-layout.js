// The family tree's model and layout, without the page (family.js draws it; tools/test_boards.mjs tests it):
// people and unions cleaned of dangling ids, generations, partner chains and the positions of every card.
import { calendar, normDate, fmtDate } from './calendar.js';

export const W = 184; // card width
export const PG = 40; // between partners (the marriage line)
export const BG = 36; // between families in a row
export const VG = 76; // between generations (room for the lines)
export const PAD = 28;
export const STATUS = [
  { value: 'married', label: 'Married' },
  { value: 'partners', label: 'Partners' },
  { value: 'separated', label: 'Separated' },
];

export const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
const ids = (v) => (Array.isArray(v) ? v.map(String) : []);

/** People and unions with dangling ids, duplicates and self-links dropped. */
export function normalize(d) {
  const people = d.people.map((p, i) => ({ ...p, id: String(p.id || `p${i + 1}`) }));
  const known = new Set(people.map((p) => p.id));
  const childOf = new Map();
  const unions = [];
  d.unions.forEach((u, i) => {
    const partners = [...new Set(ids(u.partners).filter((x) => known.has(x)))].slice(0, 2);
    const children = [...new Set(ids(u.children).filter((x) => known.has(x) && !partners.includes(x) && !childOf.has(x)))];
    if (!partners.length && !children.length) return;
    if (partners.length < 2 && !children.length) return; // a partnership needs two
    const nu = { ...u, id: String(u.id || `u${i + 1}`), partners, children, status: STATUS.some((s) => s.value === u.status) ? u.status : 'married' };
    children.forEach((c) => childOf.set(c, nu));
    unions.push(nu);
  });
  return { people, unions, childOf };
}

/** What is saved (no empty fields; status only when not married). */
export function compact(people, unions) {
  return clean({
    people: people.map((p) => clean({ id: p.id, name: p.name, title: p.title, born: p.born, died: p.died, color: p.color, text: p.text, tags: p.tags })),
    unions: unions.filter((u) => u.partners.length + u.children.length > 1 || u.children.length)
      .map((u) => clean({ id: u.id, partners: u.partners, children: u.children, status: u.status === 'married' ? null : u.status })),
  });
}

/** "80 – 162 AFF", "b. 80 AFF", "d. 162 AFF". */
export function lifeLine(p, cal = calendar()) {
  const b = normDate(p.born);
  const d = normDate(p.died);
  if (b && d) return b.age === d.age ? `${b.year} – ${fmtDate(d, { cal, month: false })}` : `${fmtDate(b, { cal, month: false })} – ${fmtDate(d, { cal, month: false })}`;
  if (b) return `b. ${fmtDate(b, { cal, month: false })}`;
  if (d) return `d. ${fmtDate(d, { cal, month: false })}`;
  return '';
}

// ---------- layout ----------

/** Generations: partners share one, children sit one below their parents (cycles are cut). -> Map id -> row */
export function generations(people, unions) {
  const gen = new Map(people.map((p) => [p.id, 0]));
  for (let pass = 0; pass < people.length + 4; pass++) {
    let changed = false;
    for (const u of unions) {
      let g;
      if (u.partners.length) {
        g = Math.max(...u.partners.map((x) => gen.get(x)));
        for (const x of u.partners) if (gen.get(x) !== g) { gen.set(x, g); changed = true; }
      } else g = Math.max(...u.children.map((x) => gen.get(x))) - 1; // unknown parents: the siblings share a row
      for (const c of u.children) if (gen.get(c) < g + 1) { gen.set(c, g + 1); changed = true; }
    }
    if (!changed) break;
  }
  // a parent with no parents of their own sits right above their children, not at the top
  for (let pass = 0; pass < 3; pass++) {
    for (const u of unions) {
      if (!u.children.length || !u.partners.length) continue;
      const want = Math.min(...u.children.map((c) => gen.get(c))) - 1;
      const g = gen.get(u.partners[0]);
      if (want > g && u.partners.every((x) => !unions.some((v) => v.children.includes(x)) && unions.filter((v) => v.partners.includes(x)).length === 1)) {
        u.partners.forEach((x) => gen.set(x, want));
      }
    }
  }
  const min = Math.min(...gen.values());
  for (const [k, v] of gen) gen.set(k, v - min);
  return gen;
}

/** Partner chains in a row (someone with two partners sits between them). -> [[ids]] in data order */
function blocksOf(row, unions, order) {
  const inRow = new Set(row);
  const adj = new Map(row.map((id) => [id, []]));
  for (const u of unions) if (u.partners.length === 2 && u.partners.every((x) => inRow.has(x))) { adj.get(u.partners[0]).push(u.partners[1]); adj.get(u.partners[1]).push(u.partners[0]); }
  const seen = new Set();
  const out = [];
  for (const id of [...row].sort((a, b) => order.get(a) - order.get(b))) {
    if (seen.has(id)) continue;
    const comp = [];
    const stack = [id];
    while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); comp.push(x); adj.get(x).forEach((y) => stack.push(y)); }
    // walk the chain from an end
    const start = comp.find((x) => adj.get(x).length <= 1) || comp[0];
    const chain = [];
    const walked = new Set();
    let cur = start;
    while (cur && !walked.has(cur)) { walked.add(cur); chain.push(cur); cur = adj.get(cur).find((y) => !walked.has(y)); }
    comp.filter((x) => !walked.has(x)).forEach((x) => chain.push(x));
    out.push(chain);
  }
  return out;
}

/**
 * Positions: every family (a partner chain) claims its children's families, top rows first, and each family's
 * descendants get a stretch of their own as wide as they need, so no two cards meet; parents sit centred over
 * their children. A child family two families could claim (a marriage between them) goes to the first, and the
 * other draws a longer line to it. -> {x: Map id -> left, gen, rowTop, rowH, width, height, focus: {x, y, ids}}
 * (focus: the centre and top of the main family's oldest people, where the board opens when it can't show it all)
 */
export function layoutFamily(people, unions, childOf, heightOf) {
  const order = new Map(people.map((p, i) => [p.id, i]));
  const gen = generations(people, unions);
  const nRows = Math.max(0, ...gen.values()) + 1;
  const rows = Array.from({ length: nRows }, () => []);
  for (const p of people) rows[gen.get(p.id)].push(p.id);
  const width = (b) => (b.length ? b.length * W + (b.length - 1) * PG : 0);
  const nodes = rows.flatMap((r, k) => blocksOf(r, unions, order).map((ids) => ({ ids, row: k, kids: [], w: width(ids), first: Math.min(...ids.map((id) => order.get(id))) })));
  const nodeOf = new Map();
  nodes.forEach((n) => n.ids.forEach((id) => nodeOf.set(id, n)));
  for (const u of unions) {
    if (u.partners.length || !u.children.length) continue;
    nodes.push({ ids: [], row: gen.get(u.children[0]) - 1, kids: [], w: 0, union: u, first: Math.min(...u.children.map((c) => order.get(c))) - 0.5 });
  }
  const claimed = new Set();
  const sorted = [...nodes].sort((a, b) => a.row - b.row || a.first - b.first);
  for (const n of sorted) {
    const pos = (u) => u.partners.reduce((s, p) => s + n.ids.indexOf(p), 0) / Math.max(1, u.partners.length);
    const us = n.union ? [n.union] : unions.filter((u) => u.partners.some((p) => n.ids.includes(p))).sort((a, b) => pos(a) - pos(b));
    for (const u of us) {
      for (const c of u.children) {
        const cn = nodeOf.get(c);
        if (!cn || cn === n || claimed.has(cn) || cn.row <= n.row) continue;
        claimed.add(cn);
        n.kids.push(cn);
      }
    }
  }
  const measure = (n) => {
    n.kw = n.kids.reduce((s, k) => s + measure(k), 0) + BG * Math.max(0, n.kids.length - 1);
    n.sw = Math.max(n.w, n.kw);
    return n.sw;
  };
  const x = new Map();
  const place = (n, left) => {
    let cx = left + (n.sw - n.kw) / 2;
    for (const k of n.kids) { place(k, cx); cx += k.sw + BG; }
    let center = left + n.sw / 2;
    if (n.kids.length) center = (n.kids[0].cx + n.kids[n.kids.length - 1].cx) / 2;
    const bl = Math.max(left, Math.min(center - n.w / 2, left + n.sw - n.w));
    n.ids.forEach((id, i) => x.set(id, bl + i * (W + PG)));
    n.cx = n.ids.length ? bl + n.w / 2 : center;
  };
  let left = PAD;
  // separate families side by side in the order their first person was added (the first family stays at the left)
  const roots = sorted.filter((n) => !claimed.has(n)).sort((a, b) => a.first - b.first);
  for (const r of roots) { measure(r); place(r, left); left += r.sw + BG; }
  // the main family: the one with the most room below it (the first of equals); the board opens on its oldest people
  let main = null;
  for (const r of roots) if (r.ids.length && (!main || r.sw > main.sw)) main = r;

  // rows' heights from their tallest card
  const rowTop = [];
  const rowH = [];
  // siblings with unknown parents in the top row: room above them for their bar and question mark
  let y = unions.some((u) => !u.partners.length && u.children.some((c) => gen.get(c) === 0)) ? PAD + VG / 2 + 12 : PAD;
  for (let k = 0; k < nRows; k++) {
    rowTop.push(y);
    const hh = Math.max(56, ...rows[k].map((id) => heightOf(id)));
    rowH.push(hh);
    y += hh + VG;
  }
  const right = Math.max(0, ...[...x.values()].map((v) => v + W));
  const focus = main ? { x: main.cx, y: rowTop[main.row] ?? PAD, ids: [...main.ids] } : { x: PAD, y: PAD, ids: [] };
  return { x, gen, rowTop, rowH, width: right + PAD, height: y - VG + PAD, focus };
}

