// Node test for DM-mode encryption (assets/js/core/dm-crypto.js).
// node tools/test_dm.mjs   (no deps; uses Node's WebCrypto)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = await import(pathToFileURL(path.join(ROOT, 'assets/js/core/dm-crypto.js')).href);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const rejects = async (p) => { try { await p; return null; } catch (e) { return e.message || String(e); } };
const section = (t) => console.log(`- ${t}`);
const fast = { iterations: 1000 }; // the real vault uses 600 000

section('vault');
{
  const { vault, raw } = await C.createDmVault('correct horse', fast);
  check('raw key is 32 bytes', raw.length === 32);
  check('vault has no plain key', !JSON.stringify(vault).includes(Buffer.from(raw).toString('base64')));
  check('default iterations', C.DM_ITERATIONS === 600000);
  const back = await C.openDmVault(vault, 'correct horse');
  check('right password opens it', Buffer.from(back).equals(Buffer.from(raw)));
  check('wrong password', (await rejects(C.openDmVault(vault, 'Correct horse'))) === 'bad-password');
  check('empty password', (await rejects(C.openDmVault(vault, ''))) === 'bad-password');
  check('broken vault', (await rejects(C.openDmVault({ v: 1 }, 'x'))) === 'bad-vault');
  const again = await C.rewrapDmVault(raw, 'new pass', fast);
  check('re-wrapped: new password opens the same key', Buffer.from(await C.openDmVault(again, 'new pass')).equals(Buffer.from(raw)));
  check('re-wrapped: old password no longer works', (await rejects(C.openDmVault(again, 'correct horse'))) === 'bad-password');
  check('fresh salt', again.kdf.salt !== vault.kdf.salt);
}

section('sealing');
{
  const { raw } = await C.createDmVault('pw', fast);
  const key = await C.importDataKey(raw);
  const other = await C.importDataKey((await C.createDmVault('pw2', fast)).raw);
  const meta = { path: 'content/quests/the-traitor-ab12.json', text: '{"title":"The Traitor"}' };
  const env = await C.sealJson(key, meta);
  check('envelope hides the content', !JSON.stringify(env).includes('Traitor') && !JSON.stringify(env).includes('quests'));
  check('envelope opens', JSON.stringify(await C.openJson(key, env)) === JSON.stringify(meta));
  check('wrong key fails', !!(await rejects(C.openJson(other, env))));
  const tampered = { ...env, data: env.data.slice(0, -4) + (env.data.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') };
  check('tampering fails', !!(await rejects(C.openJson(key, tampered))));
  const env2 = await C.sealJson(key, meta);
  check('fresh IV each time', env2.iv !== env.iv && env2.data !== env.data);
  const bytes = new Uint8Array(70000).map((_, i) => i % 251);
  const sealed = await C.sealBytes(key, bytes);
  check('sealed bytes are IV + ciphertext + tag', sealed.length === bytes.length + 12 + 16);
  check('bytes open', Buffer.from(await C.openBytes(key, sealed)).equals(Buffer.from(bytes)));
  check('bytes: wrong key fails', !!(await rejects(C.openBytes(other, sealed))));
}

section('helpers');
{
  check('sha256 of text', (await C.sha256Hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  check('sha256 of bytes = of text', (await C.sha256Hex(new TextEncoder().encode('abc'))) === (await C.sha256Hex('abc')));
  const ids = new Set(Array.from({ length: 200 }, () => C.randomId()));
  check('random ids: 20 hex chars, unique', ids.size === 200 && [...ids].every((x) => /^[0-9a-f]{20}$/.test(x)));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
