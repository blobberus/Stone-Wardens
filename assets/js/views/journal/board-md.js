// A family tree or timeline as markdown, for embeds (![[Kings of Vael]], ![[Kings of Vael#Siege of Greywater]]):
// the introduction, then the items in order (a timeline's events and eras of rule by date; a family's people).
import { boardData, kindOf, itemAnchor, tagsOf } from './kinds.js';
import { calendar, fmtDate, fmtRange, dateKey, cmpKey, normDate } from './calendar.js';
import { symbolLabel } from './symbols.js';

const tagLine = (tags) => (tagsOf(tags).length ? `\n${tagsOf(tags).map((t) => `#${t}`).join(' ')}` : '');
const quoteText = (s) => String(s || '').trim();

function eventMd(e, cal) {
  const sym = e.symbol ? ` · ${symbolLabel(e.symbol)}` : '';
  return `**${fmtDate(e, { cal })}** — ${e.title || 'Untitled event'}${sym}${e.text ? `\n${quoteText(e.text)}` : ''}${tagLine(e.tags)}`;
}
function spanMd(s, cal) {
  return `**${fmtRange(s.from, s.to, { cal })}** — ${s.title || 'Untitled era'}${s.text ? `\n${quoteText(s.text)}` : ''}${tagLine(s.tags)}`;
}
function personMd(p, d, cal) {
  const life = fmtRange(p.born, p.died, { cal });
  const bits = [p.title, life].filter(Boolean).join(', ');
  const byId = new Map(d.people.map((x) => [x.id, x]));
  const name = (id) => byId.get(id)?.name || 'someone';
  const partners = [];
  const kids = [];
  for (const u of d.unions) {
    const ps = Array.isArray(u.partners) ? u.partners : [];
    if (!ps.includes(p.id)) continue;
    ps.filter((x) => x !== p.id).forEach((x) => partners.push(name(x)));
    (Array.isArray(u.children) ? u.children : []).forEach((x) => kids.push(name(x)));
  }
  const rel = [partners.length ? `Partner of ${partners.join(', ')}` : '', kids.length ? `Parent of ${kids.join(', ')}` : ''].filter(Boolean).join('. ');
  return `**${p.name || 'Unnamed'}**${bits ? ` (${bits})` : ''}${rel ? `\n${rel}.` : ''}${p.text ? `\n${quoteText(p.text)}` : ''}${tagLine(p.tags)}`;
}

export function boardMarkdown(note, anchor = null) {
  const kind = kindOf(note.fm);
  const d = boardData(note.fm);
  const cal = calendar();
  if (anchor) {
    const want = itemAnchor(anchor);
    const hit = (t) => itemAnchor(t || '') === want;
    if (kind === 'timeline') {
      const e = d.events.find((x) => hit(x.title));
      if (e) return eventMd(e, cal);
      const s = d.spans.find((x) => hit(x.title));
      if (s) return spanMd(s, cal);
    } else {
      const p = d.people.find((x) => hit(x.name));
      if (p) return personMd(p, d, cal);
    }
    return `*Nothing called “${anchor}” on this ${kind === 'timeline' ? 'timeline' : 'family tree'}.*`;
  }
  const parts = [];
  if (note.body.trim()) parts.push(note.body.trim());
  if (kind === 'timeline') {
    const rows = [
      ...d.events.filter((e) => normDate(e)).map((e) => ({ key: dateKey(e, cal), md: eventMd(e, cal) })),
      ...d.spans.filter((s) => normDate(s.from)).map((s) => ({ key: dateKey(s.from, cal), md: spanMd(s, cal) })),
    ].sort((a, b) => cmpKey(a.key, b.key));
    parts.push(rows.length ? rows.map((r) => `- ${r.md.replace(/\n/g, '\n  ')}`).join('\n') : '*No events on this timeline yet.*');
  } else {
    parts.push(d.people.length ? d.people.map((p) => `- ${personMd(p, d, cal).replace(/\n/g, '\n  ')}`).join('\n') : '*No one in this family tree yet.*');
  }
  return parts.join('\n\n');
}
