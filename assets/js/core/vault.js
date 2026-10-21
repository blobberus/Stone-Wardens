// Password vault: the site password decrypts vault.json -> GitHub token.
// The password itself is never stored anywhere; only PBKDF2-derived AES-GCM ciphertext lives in the repo.
import { b64encode, b64decode, utf8 } from './util.js';

const ITERATIONS = 600000;
const SESSION_KEY = 'sw:auth';

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Build a vault object (used by setup.html). secret = {token}. repo = {owner, repo, branch}. */
export async function createVault(password, secret, repo) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(JSON.stringify(secret))));
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64encode(salt) },
    cipher: { name: 'AES-GCM', iv: b64encode(iv) },
    data: b64encode(data),
    repo,
    created: new Date().toISOString(),
  };
}

/** Returns the decrypted secret, or throws Error('bad-password'). */
export async function openVault(vault, password) {
  const key = await deriveKey(password, b64decode(vault.kdf.salt), vault.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(vault.cipher.iv) }, key, b64decode(vault.data));
    return JSON.parse(utf8.decode(new Uint8Array(plain)));
  } catch {
    throw new Error('bad-password');
  }
}

export async function fetchVault() {
  const res = await fetch(`vault.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

/** Session persistence of the unlocked auth ({token, owner, repo, branch}). */
export function saveAuth(auth, remember) {
  const s = JSON.stringify(auth);
  sessionStorage.setItem(SESSION_KEY, s);
  if (remember) localStorage.setItem(SESSION_KEY, s);
}

export function loadAuth() {
  const s = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

export function clearAuth() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

/** Guess owner/repo from a GitHub Pages URL (owner.github.io/repo/). */
export function guessRepo() {
  const host = location.hostname;
  const m = host.match(/^([^.]+)\.github\.io$/i);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  if (m) return { owner: m[1], repo: seg || `${m[1]}.github.io`, branch: 'main' };
  return { owner: 'blobberus', repo: 'Stone-Wardens', branch: 'main' };
}
