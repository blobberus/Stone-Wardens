// Encryption for DM mode (core/dm.js). Pure WebCrypto, no DOM: runs in the browser and in Node (tools/test_dm.mjs).
//
// The DM password never leaves the device and is never stored. It derives a key (PBKDF2-SHA256, 600k iterations,
// random salt, as vault.json does) that wraps a random 256-bit data key; the data key encrypts every hidden item with
// AES-GCM (a fresh 96-bit IV each time). Changing the password re-wraps the same data key, so nothing else changes.
import { b64encode, b64decode, utf8 } from './util.js';

export const DM_ITERATIONS = 600000;
const subtle = () => globalThis.crypto.subtle;
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function passwordKey(password, salt, iterations) {
  const base = await subtle().importKey('raw', utf8.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrap(password, raw, iterations = DM_ITERATIONS) {
  const salt = random(16);
  const iv = random(12);
  const key = await passwordKey(password, salt, iterations);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, raw));
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: b64encode(salt) },
    cipher: { name: 'AES-GCM', iv: b64encode(iv) },
    data: b64encode(data),
    created: new Date().toISOString(),
  };
}

/** A new DM vault (for content/dm/vault.json) and its data key. -> {vault, raw: Uint8Array(32)} */
export async function createDmVault(password, { iterations = DM_ITERATIONS } = {}) {
  const raw = random(32);
  return { vault: await wrap(password, raw, iterations), raw };
}

/** The same data key under a new password. */
export const rewrapDmVault = (raw, password, { iterations = DM_ITERATIONS } = {}) => wrap(password, raw, iterations);

/** The data key from a vault, or throws Error('bad-password'). */
export async function openDmVault(vault, password) {
  if (!vault?.kdf?.salt || !vault?.cipher?.iv || !vault?.data) throw new Error('bad-vault');
  const key = await passwordKey(password, b64decode(vault.kdf.salt), Number(vault.kdf.iterations) || DM_ITERATIONS);
  try {
    const raw = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b64decode(vault.cipher.iv) }, key, b64decode(vault.data)));
    if (raw.length !== 32) throw new Error('bad-key');
    return raw;
  } catch {
    throw new Error('bad-password');
  }
}

/** The AES-GCM key for hidden items (not extractable: the raw bytes stay with the caller only). */
export const importDataKey = (raw) => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** Encrypt a JSON value -> {v, iv, data} (all base64). */
export async function sealJson(key, value) {
  const iv = random(12);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(JSON.stringify(value))));
  return { v: 1, iv: b64encode(iv), data: b64encode(data) };
}

/** Decrypt sealJson's output; throws on a wrong key or tampering. */
export async function openJson(key, env) {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: b64decode(env.iv) }, key, b64decode(env.data));
  return JSON.parse(utf8.decode(new Uint8Array(plain)));
}

/** Encrypt bytes -> Uint8Array(12-byte IV + ciphertext). */
export async function sealBytes(key, bytes) {
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

/** Decrypt sealBytes's output. */
export async function openBytes(key, sealed) {
  const b = sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12)));
}

/** SHA-256 of bytes or text, hex. */
export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input;
  const d = new Uint8Array(await subtle().digest('SHA-256', bytes));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Random id for envelope file names (says nothing about the item). */
export const randomId = (n = 10) => [...random(n)].map((x) => x.toString(16).padStart(2, '0')).join('');
