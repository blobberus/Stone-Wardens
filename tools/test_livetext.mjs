// Node test for the live markdown editor's text model (assets/js/core/live-text.js): heading levels per line and
// reading text back out of the blocks the browser leaves behind. Run: node tools/test_livetext.mjs   (no deps)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(path.join(ROOT, 'assets/js/core/live-text.js')).href);

let passed = 0;
const failures = [];
const eq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name} -> ${JSON.stringify({ actual, expected })}`);
};

// ---------- lineLevels ----------

eq('levels', L.lineLevels(['# A', '## B', '### C', '#### D', '##### E', '###### F']), [1, 2, 3, 4, 5, 6]);
eq('needs a space after the #s', L.lineLevels(['#tag', '##', '#', '####### seven', 'text # not']), [0, 0, 0, 0, 0]);
eq('a mark alone is a heading being typed', L.lineLevels(['# ', '##\tTab']), [1, 2]);
eq('up to three spaces before', L.lineLevels(['   # three', '    # four']), [1, 0]);
eq('nothing inside fenced code', L.lineLevels(['```', '# comment', '```', '# Title', '~~~js', '## x', '```', '## y', '~~~', '## z']), [0, 0, 0, 1, 0, 0, 0, 0, 0, 2]);
eq('an unclosed fence runs to the end', L.lineLevels(['```', '# a', '# b']), [0, 0, 0]);
eq('empty', L.lineLevels(['']), [0]);

// ---------- readLines (on a tiny stand-in for the DOM) ----------

function node(name, kids = []) {
  const n = { nodeType: 1, nodeName: name, childNodes: [], parentNode: null };
  for (const k of kids) append(n, typeof k === 'string' ? text(k) : k);
  Object.defineProperty(n, 'textContent', { get: () => n.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join('') });
  n.querySelector = (sel) => {
    const find = (x) => { for (const c of x.childNodes) { if (c.nodeName === sel.toUpperCase()) return c; const f = c.nodeType === 1 && find(c); if (f) return f; } return null; };
    return find(n);
  };
  return n;
}
function text(data) { return { nodeType: 3, nodeName: '#text', data, parentNode: null }; }
function append(parent, child) {
  child.parentNode = parent;
  parent.childNodes.push(child);
}
// nextSibling over the arrays
const sib = (n) => { const k = n.parentNode?.childNodes; return k ? k[k.indexOf(n) + 1] || null : null; };
function wire(n) {
  Object.defineProperty(n, 'nextSibling', { get: () => sib(n), configurable: true });
  if (n.nodeType === 1) n.childNodes.forEach(wire);
  return n;
}
const div = (...k) => node('DIV', k);
const br = () => node('BR');
const span = (...k) => node('SPAN', k);
const root = (...k) => wire(node('DIV', k));
const lines = (r, pts) => L.readLines(r, pts);

eq('one block per line', lines(root(div('a'), div(br()), div('b'))).lines, ['a', '', 'b']);
eq('a <br> inside a block splits it', lines(root(div('a', br(), 'b'))).lines, ['a', 'b']);
eq('a trailing <br> holds the block open', lines(root(div('a', br()), div('b'))).lines, ['a', 'b']);
eq('two <br>s at the end are an empty line', lines(root(div('a', br(), br()))).lines, ['a', '']);
eq('heading mark span', lines(root(div(span('# '), 'Title'), div('x'))).lines, ['# Title', 'x']);
eq('stray text before blocks', lines(root('top', div('a'))).lines, ['top', 'a']);
eq('nested blocks', lines(root(div(div('a'), div('b')))).lines, ['a', 'b']);
eq('an empty block is an empty line', lines(root(div('a'), div(), div('b'))).lines, ['a', '', 'b']);
eq('newlines in text', lines(root(div('a\nb'), div('c'))).lines, ['a', 'b', 'c']);
eq('nothing at all', lines(root()).lines, ['']);
eq('span with a <br> at the end of a block', lines(root(div(span('a', br())), div('b'))).lines, ['a', 'b']);
{
  const t = text('Title');
  const r = root(div('ab'), div(span('# '), t));
  eq('offset in a text node', lines(r, [[t, 2]]).at, [3 + 2 + 2]); // "ab\n" + "# " + 2
  const d = r.childNodes[1];
  eq('offset between blocks', lines(r, [[r, 1]]).at, [3]);
  eq('offset at a block end', lines(r, [[d, 2]]).at, [3 + 7]);
  eq('offset past the end clamps', lines(r, [[r, 2]]).at, [10]);
  eq('a point elsewhere', lines(r, [[text('x'), 0]]).at, [null]);
}
{
  const r = root(div('a'), div(br()), div('b'));
  eq('offset in an empty line', lines(r, [[r.childNodes[1], 0]]).at, [2]);
}

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
