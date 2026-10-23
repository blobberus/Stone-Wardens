// Character printouts: lays out a print-model.js model on US Letter pages with jsPDF (vendor/jspdf, loaded by print.js).
// Printer-friendly: black ink on white, thin gray rules and pale-gray table heads; the character's highlight color only
// tints headings and their rules (darkened until it reads on white). gray: true turns every color to its gray.
// Standard PDF fonts only (Times for headings, Helvetica for the rest), so text goes through pdfText (WinAnsi).
//   Page 1: name block with the portrait | core boxes (AC … darkvision) | the six abilities | skills beside passive
//   scores, (Detailed: the current state,) proficiencies | attacks | spellcasting | (Detailed: feature uses, inventory,
//   coins) | features & traits in two columns | (Detailed: details). Tables and lists continue on new pages.
import { ordinal } from './print-model.js';

const PAGE = { w: 612, h: 792, m: 36 };
const X0 = PAGE.m;
const X1 = PAGE.w - PAGE.m;
const CW = X1 - X0;
const TOP = PAGE.m;
const BOTTOM = PAGE.h - 44;

// WinAnsi (the standard fonts' encoding): Latin-1 plus these; anything else is replaced or dropped
const WIN_ANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const SWAP = { '−': '-', '≈': '~', '→': '->', '←': '<-', '↳': '>', '✓': 'v', '★': '*', '​': '', ' ': ' ', ' ': ' ', ' ': ' ' };

/** Text the standard PDF fonts can show (WinAnsi): common symbols swapped, the rest dropped. */
export function pdfText(s) {
  let out = '';
  for (const ch of String(s ?? '').normalize('NFC')) {
    if (ch in SWAP) out += SWAP[ch];
    else if (ch === '\n' || ch === '\t') out += ' ';
    else if ((ch >= ' ' && ch <= '~') || (ch >= ' ' && ch <= 'ÿ') || WIN_ANSI.has(ch)) out += ch;
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += base.length === 1 && base <= 'ÿ' ? base : '';
    }
  }
  return out;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const toGray = (c) => { const l = Math.round(lum(c)); return [l, l, l]; };

/** The highlight color, darkened until it has strong contrast on white paper. */
function inkAccent(hex) {
  let c = /^#[0-9a-f]{6}$/i.test(hex || '') ? rgb(hex) : [122, 31, 31];
  for (let i = 0; i < 12 && lum(c) > 95; i++) c = c.map((v) => Math.round(v * 0.85));
  return c;
}

function palette(accent, gray) {
  const p = {
    ink: [26, 26, 26], muted: [92, 92, 92], faint: [150, 150, 150], rule: [190, 190, 190], soft: [222, 222, 222],
    head: [240, 240, 240], zebra: [248, 248, 248], white: [255, 255, 255], accent: inkAccent(accent),
  };
  if (gray) for (const k of Object.keys(p)) p[k] = toGray(p[k]);
  return p;
}

/**
 * The jsPDF document of a print model. opts.portrait: a JPEG data URL (square) or null; opts.accent: the character's
 * highlight color; opts.gray: grayscale (the portrait is grayed by print.js).
 */
export function renderSheet(JsPDF, m, { portrait = null, accent = '#7a1f1f', gray = false } = {}) {
  const doc = new JsPDF({ unit: 'pt', format: 'letter', compress: true });
  const C = palette(accent, gray);
  let y = TOP;

  // ---------- primitives ----------
  const font = (size, style = 'normal', family = 'helvetica') => { doc.setFont(family, style); doc.setFontSize(size); };
  const ink = (c) => doc.setTextColor(...c);
  const stroke = (c, w = 0.6) => { doc.setDrawColor(...c); doc.setLineWidth(w); };
  const fill = (c) => doc.setFillColor(...c);
  const width = (s) => doc.getTextWidth(pdfText(s));
  const text = (s, x, yy, opts = {}) => { const v = pdfText(s); if (v) doc.text(v, x, yy, opts); };
  /** One line cut to fit maxW (with "..."). */
  const fit = (s, maxW) => {
    let v = pdfText(s);
    if (doc.getTextWidth(v) <= maxW) return v;
    while (v.length > 1 && doc.getTextWidth(`${v}...`) > maxW) v = v.slice(0, -1);
    return `${v.trimEnd()}...`;
  };
  const wrap = (s, w) => (pdfText(s) ? doc.splitTextToSize(pdfText(s), w) : []);
  const upper = (s) => String(s || '').toUpperCase();

  function newPage() {
    doc.addPage();
    y = TOP;
    font(8, 'bold');
    ink(C.muted);
    text(`${m.name} · ${m.title} (continued)`, X0, y + 6);
    stroke(C.soft, 0.5);
    doc.line(X0, y + 11, X1, y + 11);
    y += 24;
  }
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };

  /** Section heading in the highlight color with a thin rule; keeps `keep` points of content with it. */
  function heading(title, { sub = '', keep = 40 } = {}) {
    ensure(18 + keep);
    y += 6;
    font(10, 'bold', 'times');
    ink(C.accent);
    text(upper(title), X0, y + 7, { charSpace: 0.8 });
    if (sub) { font(7.5); ink(C.muted); text(fit(sub, CW * 0.6), X1, y + 7, { align: 'right' }); }
    stroke(C.accent, 0.7);
    doc.line(X0, y + 10.5, X1, y + 10.5);
    y += 17;
  }

  /** A small column heading (two-column region). */
  function subHeading(title, x, yy, w) {
    font(7.5, 'bold');
    ink(C.accent);
    text(upper(title), x, yy + 6, { charSpace: 0.6 });
    stroke(C.soft, 0.5);
    doc.line(x, yy + 9, x + w, yy + 9);
    return yy + 15;
  }

  /** Proficiency mark: none (ring), proficient (dot), expertise (dot in a ring), half (small dot in a ring). */
  function mark(level, cx, cy, r = 2.6) {
    stroke(C.ink, 0.6);
    fill(C.ink);
    if (level === 'proficient') doc.circle(cx, cy, r, 'FD');
    else if (level === 'expertise') { doc.circle(cx, cy, r + 1.2, 'S'); doc.circle(cx, cy, r - 0.6, 'F'); }
    else if (level === 'half') { doc.circle(cx, cy, r, 'S'); doc.circle(cx, cy, r * 0.45, 'F'); }
    else { stroke(C.faint, 0.6); doc.circle(cx, cy, r, 'S'); }
  }

  /** Check box (inventory equip / attune, prepared spells): true ticked, false empty, null nothing. */
  function box(on, x, yy, s = 6.5) {
    if (on == null) return;
    stroke(on ? C.ink : C.faint, 0.6);
    doc.rect(x, yy, s, s, 'S');
    if (on) { stroke(C.ink, 1); doc.line(x + 1.4, yy + s * 0.55, x + s * 0.42, yy + s - 1.4); doc.line(x + s * 0.42, yy + s - 1.4, x + s - 1.2, yy + 1.3); }
  }

  /** Measured blocks of feature groups for a column of width w: a group title, then one block per feature. */
  function featureBlocks(groups, w) {
    const blocks = [];
    for (const g of groups) {
      blocks.push({ h: 13, title: g.title });
      for (const it of g.items) {
        font(8, 'bold');
        const nameW = doc.getTextWidth(pdfText(it.name));
        font(7.2);
        const one = !it.note || nameW + 6 + doc.getTextWidth(pdfText(it.note)) <= w;
        const noteLines = it.note && !one ? wrap(it.note, w - 8) : [];
        font(8, 'bold');
        const nameLines = wrap(it.name, w);
        blocks.push({ h: nameLines.length * 10 + noteLines.length * 8.8 + 2, it, one, nameLines, noteLines });
      }
    }
    return blocks;
  }
  function drawFeature(b, x, yy) {
    if (b.title) {
      font(6.8, 'bold');
      ink(C.muted);
      text(upper(b.title), x, yy + 8, { charSpace: 0.4 });
      return;
    }
    font(8, 'bold');
    ink(C.ink);
    b.nameLines.forEach((l, li) => text(l, x, yy + 8 + li * 10));
    if (b.one && b.it.note) {
      const nx = x + doc.getTextWidth(b.nameLines[0]) + 6;
      font(7.2);
      ink(C.muted);
      text(b.it.note, nx, yy + 8);
    }
    font(7.2);
    ink(C.muted);
    b.noteLines.forEach((l, li) => text(l, x + 8, yy + 8 + b.nameLines.length * 10 + li * 8.8 - 1.5));
  }
  let featRest = m.features; // features still to print after the two-column region
  let featStarted = false;

  // ---------- page 1: name block ----------
  const PH = 76;
  stroke(C.rule, 0.8);
  if (portrait) {
    try { doc.addImage(portrait, 'JPEG', X0, y, PH, PH); } catch { /* unreadable image: crest below */ portrait = null; }
  }
  if (!portrait) {
    fill(C.zebra);
    doc.rect(X0, y, PH, PH, 'F');
    font(24, 'bold', 'times');
    ink(C.faint);
    const init = String(m.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    text(init, X0 + PH / 2, y + PH / 2 + 8, { align: 'center' });
  }
  doc.rect(X0, y, PH, PH, 'S');
  const RW = 176; // right block: what this sheet is
  const tx = X0 + PH + 12;
  const nameW = X1 - RW - 14 - tx;
  font(22, 'bold', 'times');
  ink(C.ink);
  const nameLines = wrap(m.name, nameW).slice(0, 2);
  let ny = y + 20;
  for (const l of nameLines) { text(l, tx, ny); ny += 22; }
  font(9.5);
  ink(C.ink);
  ny -= 6;
  for (const l of wrap(m.line, nameW).slice(0, 3)) { text(l, tx, ny); ny += 11.5; }
  if (m.meta) { font(8.5); ink(C.muted); text(fit(m.meta, nameW), tx, ny); }
  // right block
  let ry = y + 7;
  font(8, 'bold');
  ink(C.accent);
  text(upper(m.title), X1, ry, { align: 'right', charSpace: 1.2 });
  ry += 11;
  font(7.5);
  ink(C.muted);
  const note = m.full ? `The whole sheet as it stands on ${m.date}: hit points, spell slots, feature uses, inventory and coins included.`
    : 'The stats that rarely change. Hit points, spell slots, feature uses, inventory and coins live in the Paper Companion view on the site.';
  for (const l of wrap(note, RW)) { text(l, X1, ry, { align: 'right' }); ry += 9; }
  if (m.link) {
    ry += 2;
    font(7, 'bold');
    ink(C.ink);
    const bare = m.link.replace(/^https?:\/\//, '');
    const cut = bare.indexOf('#');
    const lines = doc.getTextWidth(pdfText(bare)) <= RW || cut < 0 ? [fit(bare, RW)] : [fit(bare.slice(0, cut), RW), fit(bare.slice(cut), RW)];
    const lw = Math.max(...lines.map((l) => doc.getTextWidth(l)));
    lines.forEach((l, i) => text(l, X1, ry + i * 8.5, { align: 'right' }));
    doc.link(X1 - lw, ry - 7, lw, 8.5 * lines.length + 1, { url: m.link });
  }
  y += PH + 9;
  stroke(C.accent, 1.1);
  doc.line(X0, y, X1, y);
  y += 9;

  // ---------- core boxes ----------
  function boxes(items, { h = 48, valueSize = 14, gap = 6 } = {}) {
    const n = items.length;
    const bw = (CW - gap * (n - 1)) / n;
    ensure(h);
    items.forEach((b, i) => {
      const x = X0 + i * (bw + gap);
      stroke(C.rule, 0.6);
      doc.roundedRect(x, y, bw, h, 3, 3, 'S');
      font(5.8, 'bold');
      ink(C.muted);
      const lab = wrap(upper(b.label), bw - 6).slice(0, 2);
      lab.forEach((l, li) => text(l, x + bw / 2, y + 8 + li * 6.4, { align: 'center', charSpace: 0.2 }));
      font(valueSize, 'bold');
      ink(C.ink);
      let vs = valueSize;
      while (vs > 7 && doc.getTextWidth(pdfText(b.value)) > bw - 6) { vs -= 0.5; font(vs, 'bold'); }
      text(b.value, x + bw / 2, y + h / 2 + (lab.length > 1 ? 7 : 5), { align: 'center' });
      if (b.sub) { font(5.8); ink(C.muted); text(fit(b.sub, bw - 6), x + bw / 2, y + h - 5, { align: 'center' }); }
    });
    y += h + 8;
  }
  boxes(m.core);

  // ---------- abilities ----------
  {
    const n = m.abilities.length;
    const gap = 8;
    const bw = (CW - gap * (n - 1)) / n;
    const h = 66;
    m.abilities.forEach((a, i) => {
      const x = X0 + i * (bw + gap);
      stroke(C.rule, 0.6);
      doc.roundedRect(x, y, bw, h, 3, 3, 'S');
      font(6.8, 'bold');
      ink(C.accent);
      text(upper(a.full), x + bw / 2, y + 10, { align: 'center', charSpace: 0.6 });
      font(20, 'bold', 'times');
      ink(C.ink);
      text(a.mod, x + bw / 2, y + 32, { align: 'center' });
      stroke(C.rule, 0.6);
      doc.roundedRect(x + bw / 2 - 13, y + 37, 26, 12, 6, 6, 'S');
      font(8, 'bold');
      text(String(a.score), x + bw / 2, y + 45.6, { align: 'center' });
      stroke(C.soft, 0.5);
      doc.line(x + 6, y + 53, x + bw - 6, y + 53);
      mark(a.saveProf ? 'proficient' : 'none', x + 10, y + 59.5, 2.3);
      font(7);
      ink(C.muted);
      text('SAVE', x + 16, y + 62, { charSpace: 0.3 });
      font(8.5, 'bold');
      ink(C.ink);
      text(a.save, x + bw - 8, y + 62, { align: 'right' });
    });
    y += h + 10;
  }

  // ---------- skills | (state,) passives, proficiencies ----------
  {
    const LW = 228;
    const RX = X0 + LW + 16;
    const RWd = X1 - RX;
    const y0 = y;
    // left: skills
    let ly = subHeading('Skills', X0, y0, LW);
    const rowH = 11.6;
    for (const sk of m.skills) {
      mark(sk.level, X0 + 4, ly + 4.2);
      font(6.3, 'bold');
      ink(C.muted);
      text(sk.ability, X0 + 11, ly + 6.4);
      font(8.2);
      ink(C.ink);
      text(fit(sk.name, LW - 62), X0 + 30, ly + 6.6);
      font(8.2, 'bold');
      text(sk.bonus, X0 + LW - 2, ly + 6.6, { align: 'right' });
      stroke(C.soft, 0.4);
      doc.line(X0 + 30, ly + 9.2, X0 + LW, ly + 9.2);
      ly += rowH;
    }
    font(6.2);
    ink(C.muted);
    mark('proficient', X0 + 4, ly + 4.5, 2.2); text('Proficient', X0 + 10, ly + 6.6);
    mark('expertise', X0 + 52, ly + 4.5, 2.2); text('Expertise', X0 + 59, ly + 6.6);
    if (m.skills.some((x) => x.level === 'half')) { mark('half', X0 + 100, ly + 4.5, 2.2); text('Half', X0 + 106, ly + 6.6); }
    ly += 12;

    // right column
    let r = y0;
    const defs = (rows, labelW = 60, size = 7.8) => {
      for (const [label, value] of rows) {
        font(size);
        const lines = wrap(value || '—', RWd - labelW);
        font(size, 'bold');
        ink(C.muted);
        text(label, RX, r + 6.5);
        font(size);
        ink(C.ink);
        lines.forEach((l, li) => text(l, RX + labelW, r + 6.5 + li * (size + 2)));
        r += Math.max(1, lines.length) * (size + 2) + 2.5;
      }
    };
    if (m.state) {
      const st = m.state;
      r = subHeading('Right now', RX, r, RWd);
      const hd = st.hitDice.map((x) => `${x.left} of ${x.total} d${x.die}`).join(', ') || '—';
      defs([
        ['Hit points', `${st.hp.current} of ${st.hp.max}${st.hp.temp ? `, +${st.hp.temp} temporary` : ''}`],
        ['Hit dice left', hd],
        ['Death saves', `${st.deathSaves.success} success${st.deathSaves.success === 1 ? '' : 'es'}, ${st.deathSaves.fail} failure${st.deathSaves.fail === 1 ? '' : 's'}`],
        ['Conditions', st.conditions.join(', ') || 'None'],
        ['Exhaustion', st.exhaustion ? `Level ${st.exhaustion}: −${st.exhaustion * 2} to D20 Tests, −${st.exhaustion * 5} ft Speed` : 'None'],
        ['Inspiration', st.inspiration ? 'Heroic Inspiration' : 'None'],
        ['Experience', `${st.xp.now.toLocaleString('en-US')} XP${st.xp.next ? ` (next level at ${Number(st.xp.next).toLocaleString('en-US')})` : ''}`],
      ], 64);
      r += 4;
    }
    r = subHeading('Passive scores', RX, r, RWd);
    {
      const gap = 6;
      const bw = (RWd - gap * 2) / 3;
      m.passives.forEach((p, i) => {
        const x = RX + i * (bw + gap);
        stroke(C.rule, 0.6);
        doc.roundedRect(x, r, bw, 24, 3, 3, 'S');
        font(5.8, 'bold');
        ink(C.muted);
        text(upper(p.label), x + bw / 2, r + 8, { align: 'center', charSpace: 0.2 });
        font(11, 'bold');
        ink(C.ink);
        text(p.value, x + bw / 2, r + 19.5, { align: 'center' });
      });
      r += 30;
    }
    r = subHeading('Proficiencies & senses', RX, r, RWd);
    defs(m.profs);
    // Features & traits begin here when there is room beside the skills; the rest follows the spellcasting
    const first = m.features.length ? featureBlocks([m.features[0]], RWd) : [];
    if (first.length > 1 && r + 19 + first[0].h + first[1].h <= ly) {
      let cy = subHeading('Features & traits', RX, r + 4, RWd);
      const rest = [];
      let full = false;
      for (const g of m.features) {
        if (full) { rest.push(g); continue; }
        const blocks = featureBlocks([g], RWd);
        if (cy + blocks[0].h + (blocks[1]?.h || 0) > ly) { full = true; rest.push(g); continue; }
        drawFeature(blocks[0], RX, cy);
        cy += blocks[0].h;
        let n = 0;
        for (const b of blocks.slice(1)) { if (cy + b.h > ly) break; drawFeature(b, RX, cy); cy += b.h; n += 1; }
        if (n < g.items.length) { full = true; rest.push({ title: `${g.title} (continued)`, items: g.items.slice(n) }); }
      }
      featStarted = true;
      featRest = rest;
      r = cy;
    }
    y = Math.max(ly, r) + 6;
  }

  // ---------- tables ----------
  /**
   * cols: [{label, w (points; one column without w takes the rest), align: 'left'|'center'|'right', bold, muted, mark,
   *   pad (left padding, default 3)}]
   * rows: arrays of strings (a `mark` column holds true / false / null: a check box).
   */
  function table(cols, rows, { size = 7.8 } = {}) {
    const fixed = cols.reduce((n, c) => n + (c.w || 0), 0);
    const flex = cols.filter((c) => !c.w).length;
    const ws = cols.map((c) => c.w || (CW - fixed) / Math.max(1, flex));
    const lh = size + 2;
    const head = () => {
      fill(C.head);
      doc.rect(X0, y, CW, 12, 'F');
      font(6, 'bold');
      ink(C.muted);
      let x = X0;
      cols.forEach((c, i) => {
        const tx2 = c.align === 'center' ? x + ws[i] / 2 : c.align === 'right' ? x + ws[i] - 3 : x + (c.pad || 3);
        text(upper(c.label), tx2, y + 8.2, { align: c.align || 'left', charSpace: 0.3 });
        x += ws[i];
      });
      y += 12;
    };
    ensure(12 + lh + 6);
    head();
    rows.forEach((row, ri) => {
      const cells = row.map((v, i) => {
        if (cols[i].mark) return null;
        font(size, cols[i].bold ? 'bold' : 'normal');
        return wrap(v == null || v === '' ? '—' : String(v), ws[i] - 3 - (cols[i].pad || 3));
      });
      const n = Math.max(1, ...cells.map((l) => (l ? l.length : 1)));
      const h = n * lh + 4;
      if (y + h > BOTTOM) { newPage(); head(); }
      if (ri % 2 === 1) { fill(C.zebra); doc.rect(X0, y, CW, h, 'F'); }
      let x = X0;
      cols.forEach((c, i) => {
        if (c.mark) box(row[i], x + ws[i] / 2 - 3.2, y + 2.8);
        else {
          font(size, c.bold ? 'bold' : 'normal');
          ink(c.muted || row[i] == null || row[i] === '' ? C.muted : C.ink);
          const tx2 = c.align === 'center' ? x + ws[i] / 2 : c.align === 'right' ? x + ws[i] - 3 : x + (c.pad || 3);
          cells[i].forEach((l, li) => text(l, tx2, y + size + 1 + li * lh, { align: c.align || 'left' }));
        }
        x += ws[i];
      });
      y += h;
    });
    stroke(C.rule, 0.5);
    doc.line(X0, y, X1, y);
    y += 8;
  }

  /** "Label  names, names, …" lines (spell names by level). */
  function labeled(rows, { labelW = 62, size = 8 } = {}) {
    for (const [label, value] of rows) {
      font(size);
      const lines = wrap(value || '—', CW - labelW);
      const h = lines.length * (size + 2.2) + 3;
      ensure(h);
      font(size, 'bold');
      ink(C.muted);
      text(label, X0, y + size);
      font(size);
      ink(C.ink);
      lines.forEach((l, li) => text(l, X0 + labelW, y + size + li * (size + 2.2)));
      y += h;
    }
  }

  // ---------- attacks ----------
  if (m.attacks.length) {
    heading('Attacks');
    table([{ label: 'Attack', w: 116, bold: true }, { label: 'Hit', w: 32, align: 'center', bold: true }, { label: 'Damage', w: 130 },
      { label: 'Range', w: 84 }, { label: 'Mastery', w: 48 }, { label: 'Properties & notes', muted: true }],
    m.attacks.map((a) => [a.name, a.hit, a.damage, a.range, a.mastery, [a.notes, a.proficient ? '' : 'not proficient'].filter(Boolean).join(', ')]));
  }

  // ---------- spellcasting ----------
  if (m.casting) {
    const k = m.casting;
    heading('Spellcasting');
    for (const sc of k.casters) {
      ensure(12);
      font(8.5, 'bold');
      ink(C.ink);
      text(sc.name, X0, y + 8);
      const nw = width(sc.name) + 8;
      font(8.5);
      text(fit([sc.ability, sc.dc != null ? `Save DC ${sc.dc}` : '', `Spell attack ${sc.attack}`, sc.counts].filter(Boolean).join('  ·  '), CW - nw), X0 + nw, y + 8);
      y += 12;
    }
    if (k.slots.length || k.pact) {
      const parts = k.slots.map((x) => (m.full ? `${ordinal(x.level)}: ${x.left} of ${x.max}` : `${ordinal(x.level)}: ${x.max}`));
      if (k.pact) parts.push(m.full ? `Pact (${ordinal(k.pact.level)}): ${k.pact.left} of ${k.pact.max}` : `Pact (${ordinal(k.pact.level)}): ${k.pact.max}`);
      labeled([[m.full ? 'Slots left' : 'Spell slots', parts.join('   ·   ')]]);
    }
    y += 2;
    if (m.full && k.spells.length) {
      table([{ label: 'Prep', w: 26, mark: true }, { label: 'Spell', w: 132, bold: true }, { label: 'Level', w: 38 }, { label: 'Time', w: 44 },
        { label: 'Range', w: 52 }, { label: 'Hit / DC', w: 58 }, { label: 'Effect' }],
      k.spells.map((x) => [x.level === 0 ? null : x.ready, `${x.name}${x.concentration ? ' (C)' : ''}${x.ritual ? ' (R)' : ''}${x.always ? ' (always)' : ''}`,
        x.level ? ordinal(x.level) : 'Cantrip', x.time, x.range, x.hit, x.effect]));
      ensure(10);
      font(6.5);
      ink(C.muted);
      text('(C) concentration   (R) ritual   Prep: prepared today (cantrips are always ready)', X0, y);
      y += 8;
    } else if (k.lines.length) {
      labeled(k.lines.map((l) => [l.label, l.names]));
      ensure(10);
      font(6.5);
      ink(C.muted);
      text('(C) concentration   (R) ritual', X0, y + 4);
      y += 10;
    }
  }

  // ---------- Detailed sheet: feature uses, inventory, coins ----------
  if (m.full && m.resources?.length) {
    heading('Feature uses');
    table([{ label: 'Feature', bold: true }, { label: 'Uses left', w: 90, align: 'center' }, { label: 'Recharge', w: 110 }],
      m.resources.map((r) => [r.label, `${r.left} of ${r.max}`, r.recharge]));
  }
  if (m.full && m.inventory) {
    const inv = m.inventory;
    heading('Inventory', { sub: `Carried ${inv.carried} lb${inv.capacity ? ` of ${inv.capacity} lb` : ''} · Attuned ${inv.attuned} of 3` });
    if (inv.rows.length) {
      table([{ label: 'Eq.', w: 24, mark: true }, { label: 'Att.', w: 24, mark: true }, { label: 'Item', w: 124, bold: true }, { label: 'Type', w: 78, muted: true },
        { label: 'Qty', w: 28, align: 'center' }, { label: 'Weight', w: 40, align: 'right' }, { label: 'Stats & notes', pad: 10 }],
      inv.rows.map((x) => [x.equipped, x.attuned, x.name, x.kind, String(x.qty), x.weight ? `${x.weight} lb` : '', [x.stats, x.notes].filter(Boolean).join(' · ')]));
    } else {
      ensure(12); font(8); ink(C.muted); text('The pack is empty.', X0, y + 8); y += 14;
    }
  }
  if (m.full && m.coins) {
    heading('Coins', { sub: `About ${m.coinsGp} gp in all`, keep: 40 });
    boxes(m.coins.map((x) => ({ label: x.name, value: String(x.value) })), { h: 34, valueSize: 12, gap: 8 });
  }

  // ---------- features & traits (the rest, when they began beside the skills): two balanced columns ----------
  if (featRest.length) {
    heading(featStarted ? 'Features & traits (continued)' : 'Features & traits');
    const gap = 18;
    const w = (CW - gap) / 2;
    const blocks = featureBlocks(featRest, w);
    let i = 0;
    while (i < blocks.length) {
      ensure(30);
      const room = BOTTOM - y;
      const total = blocks.slice(i).reduce((n, b) => n + b.h, 0);
      // balance on the last page, else fill the left column, then the right one
      const target = total / 2 <= room ? total / 2 : room;
      const colY = y;
      let maxY = y;
      for (let c = 0; c < 2 && i < blocks.length; c++) {
        let cy = colY;
        let used = 0;
        while (i < blocks.length) {
          const b = blocks[i];
          const next = blocks[i + 1];
          const need = b.h + (b.title && next ? next.h : 0); // a group title stays with its first feature
          if (cy + need > BOTTOM) break;
          if (c === 0 && used > 0 && used + b.h / 2 > target) break;
          drawFeature(b, X0 + c * (w + gap), cy);
          cy += b.h;
          used += b.h;
          i += 1;
        }
        maxY = Math.max(maxY, cy);
      }
      y = maxY + 4;
      if (i < blocks.length) newPage();
    }
  }

  // ---------- Detailed sheet: details ----------
  if (m.full && m.details?.length) {
    heading('Details', { keep: 30 });
    const half = Math.ceil(m.details.length / 2);
    const colW = (CW - 18) / 2;
    const y0 = y;
    let maxY = y;
    [m.details.slice(0, half), m.details.slice(half)].forEach((list, ci) => {
      let cy = y0;
      for (const [label, value] of list) {
        font(7.8, 'bold');
        ink(C.muted);
        text(label, X0 + ci * (colW + 18), cy + 7);
        font(7.8);
        ink(C.ink);
        text(fit(value, colW - 70), X0 + ci * (colW + 18) + 70, cy + 7);
        cy += 11;
      }
      maxY = Math.max(maxY, cy);
    });
    y = maxY;
  }

  // ---------- footers ----------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(C.soft, 0.5);
    doc.line(X0, PAGE.h - 30, X1, PAGE.h - 30);
    font(6.8);
    ink(C.muted);
    text(fit(`${m.footer} · Stone Wardens`, CW - 80), X0, PAGE.h - 20);
    text(`Page ${p} of ${pages}`, X1, PAGE.h - 20, { align: 'right' });
  }
  doc.setProperties({ title: `${m.name} · ${m.title}`, subject: 'D&D character sheet', author: m.player || '', creator: 'The Stone Wardens campaign site' });
  return doc;
}
