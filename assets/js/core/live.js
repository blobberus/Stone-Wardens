// Live updates (docs/dm-party.md): a change to a shared document (a character sheet) reaches the screens watching it
// within about a second, long before its commit lands on GitHub.
//
// Every player shares one GitHub token, good for a few hundred commits an hour, so a sheet is committed at most every
// 15 s while someone edits it. On top of that, each local write of a shared path is published at once through public
// MQTT brokers (the ones Combat Ring uses) as a retained message per document, `sw1/<room>/o/<key>`, so a screen that
// starts watching gets the latest copy of each at once. Payloads are gzip'd and AES-GCM sealed with a key derived from
// the GitHub token (HKDF), so only people with the site password can read them and nobody else can forge one. Every
// client publishes; only a screen that watches (the DM's party view) subscribes.
// A live copy is a hint, not the record: readers take it only while it is newer than the stored doc (`updated`), and
// GitHub stays the truth. Sandbox (?sandbox): a BroadcastChannel between tabs, retained messages in localStorage.
import { MqttClient, topicMatches } from './mqtt.js';
import { sealBytes, openBytes } from './dm-crypto.js';
import { utf8, b64encode, b64decode } from './util.js';
import { store } from './store.js';
import { getSetting } from './settings.js';

const PREFIX = 'sw1';
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const DELAY = 120; // ms after the last write of a path before it goes out (data.js already debounces typing by 300 ms)
const BIG = 96 * 1024; // some brokers drop larger retained messages

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

const S = {
  secret: null, local: false, room: null, roomP: null, transports: null,
  shares: [], docs: new Map(), watchers: new Set(), statusFns: new Set(), timers: new Map(),
  cid: rid(), clock: 0, out: Promise.resolve(),
};

// ---------- setup ----------

/** Called once the backend is known: the GitHub token (or 'sandbox' with {local: true}) keys the room. */
export function configureLive({ secret, local = false }) {
  S.secret = secret || null;
  S.local = !!local;
}

/** Publish local writes of the paths this test accepts (characters/data.js shares the sheets). */
export function shareLive(test) { S.shares.push(test); }
const shared = (path) => S.shares.some((t) => { try { return t(path); } catch { return false; } });

/** The live copy of a doc another screen published: {data, updated, by, at} or null. */
export const liveDoc = (path) => S.docs.get(path) || null;

/** 'off' (never connected) | 'connecting' | 'online' (at least one broker) | 'offline', with counts. */
export function liveStatus() {
  if (!S.transports) return { state: 'off', online: 0, total: 0 };
  const states = S.transports.map((t) => t.client.state);
  const online = states.filter((s) => s === 'online').length;
  return { state: online ? 'online' : states.includes('connecting') ? 'connecting' : 'offline', online, total: states.length };
}
export const onLiveStatus = (fn) => { S.statusFns.add(fn); return () => S.statusFns.delete(fn); };

/**
 * Watch the live copies: fn(path, entry) for each one newer than what this screen had. Connects and subscribes;
 * returns an unwatch function (the last one unsubscribes).
 */
export function watchLive(fn) {
  S.watchers.add(fn);
  if (S.watchers.size === 1) connect().then((ok) => { if (ok && S.watchers.size) for (const t of S.transports) t.client.subscribe(filter()); });
  return () => {
    S.watchers.delete(fn);
    if (!S.watchers.size && S.transports && S.room) for (const t of S.transports) t.client.unsubscribe(filter());
  };
}
const filter = () => `${PREFIX}/${S.room.id}/o/#`;

// ---------- room key and transports ----------

/** A room's AES-GCM key and public id (the MQTT topic) from the shared secret (HKDF-SHA256). */
export async function roomKeys(secret, label = 'live') {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', utf8.encode(secret), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = utf8.encode('stone-wardens/v1');
  const idBits = new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(`${label}:id`) }, base, 128));
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(`${label}:key`) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, id: [...idBits].map((x) => x.toString(16).padStart(2, '0')).join('') };
}

/** Derive the room and open the transports (once). Resolves false when there is no secret (not logged in). */
function connect() {
  if (!S.secret) return Promise.resolve(false);
  if (!S.roomP) {
    S.roomP = roomKeys(S.secret).then((room) => {
      S.room = room;
      const Transport = S.local ? LocalTransport : MqttClient;
      S.transports = (S.local ? ['local'] : BROKERS).map((url, idx) => {
        const tr = { idx, chain: Promise.resolve(), client: null };
        tr.client = new Transport(url, {
          clientId: `sw-${S.cid}-${idx}`,
          onMessage: (topic, bytes) => { tr.chain = tr.chain.then(() => receive(topic, bytes)).catch((e) => console.warn('[live]', e)); },
          onStatus: () => { const st = liveStatus(); for (const f of S.statusFns) { try { f(st); } catch (e) { console.error(e); } } },
        });
        tr.client.connect();
        return tr;
      });
      return true;
    }).catch((e) => { console.warn('[live] no live updates:', e); S.roomP = null; return false; });
  }
  return S.roomP;
}

// ---------- publishing ----------

store.on((ev) => {
  if (ev.type !== 'put' || !ev.path || !S.secret || !shared(ev.path)) return;
  clearTimeout(S.timers.get(ev.path));
  S.timers.set(ev.path, setTimeout(() => { S.timers.delete(ev.path); publish(ev.path); }, DELAY));
});

function stamp() {
  S.clock = Math.max(Date.now(), S.clock + 1);
  return [S.clock, S.cid];
}

/** Is version a newer than b? Versions are [ms, clientId] (a hybrid logical clock, as in Combat Ring). */
const newer = (a, b) => !b || (!!a && (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]));

function publish(path) {
  const data = store.get(path);
  if (!data || typeof data !== 'object') return;
  const env = { k: keyOf(path), t: stamp(), by: getSetting('playerName') || '', d: { path, updated: data.updated || null, data } };
  S.out = S.out.then(async () => {
    if (!(await connect())) return;
    const bytes = await pack(env);
    if (bytes.length > BIG) console.warn(`[live] ${path} is ${Math.round(bytes.length / 1024)} KB; some brokers keep only smaller messages`);
    for (const t of S.transports) t.client.publish(`${PREFIX}/${S.room.id}/o/${env.k}`, bytes, { retain: true });
  }).catch((e) => console.warn('[live] publish failed', e));
}

// Topic level from a path ('/', '#', '+' are not allowed inside one).
const keyOf = (path) => encodeURIComponent(path);

/** env -> sealed bytes: [1 = gzip | 0 = plain] + JSON, then AES-GCM. */
async function pack(env) {
  const json = utf8.encode(JSON.stringify(env));
  const z = await gzip(json);
  const body = new Uint8Array(1 + (z || json).length);
  body[0] = z ? 1 : 0;
  body.set(z || json, 1);
  return sealBytes(S.room.key, body);
}

async function unpack(bytes) {
  const body = await openBytes(S.room.key, bytes);
  const json = body[0] === 1 ? await gunzip(body.subarray(1)) : body.subarray(1);
  return JSON.parse(utf8.decode(json));
}

async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// ---------- receiving ----------

const versions = new Map(); // path -> newest version seen (each broker delivers its own copy)

async function receive(topic, bytes) {
  if (!S.room || !bytes?.length || !S.watchers.size) return;
  const parts = topic.split('/');
  if (parts[0] !== PREFIX || parts[1] !== S.room.id || parts[2] !== 'o') return;
  let env;
  try { env = await unpack(bytes); } catch { return; } // not ours, or tampered with
  const path = env?.d?.path;
  if (!path || env.k !== parts.slice(3).join('/') || env.k !== keyOf(path) || !Array.isArray(env.t) || !shared(path)) return;
  if (env.t[1] === S.cid) return; // our own write (this screen's store has it already)
  if (!newer(env.t, versions.get(path))) return;
  versions.set(path, env.t);
  if (env.t[0] > S.clock && env.t[0] < Date.now() + 864e5) S.clock = env.t[0];
  const entry = { data: env.d.data, updated: env.d.updated || null, by: env.by || '', at: Date.now() };
  S.docs.set(path, entry);
  for (const fn of S.watchers) { try { fn(path, entry); } catch (e) { console.error('[live] watcher failed', e); } }
  store.emit({ type: 'live', path }); // open views of it redraw (readers pick the newer copy, characters/data.js)
}

// ---------- sandbox transport (one browser: tabs talk through a BroadcastChannel) ----------

const RKEY = 'sw:sandbox:live';
class LocalTransport {
  constructor(url, { onMessage, onStatus }) {
    this.url = 'this browser';
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.state = 'offline';
    this.subs = new Set();
    this.ch = new BroadcastChannel('sw-sandbox-live');
    this.ch.onmessage = (ev) => this.deliver(ev.data.topic, ev.data.data);
  }

  connect() {
    this.state = 'connecting';
    setTimeout(() => {
      this.state = 'online';
      this.onStatus('online');
      for (const f of this.subs) this.replay(f);
    }, 30);
    return this;
  }

  retained() { try { return JSON.parse(localStorage.getItem(RKEY) || '{}'); } catch { return {}; } }

  replay(f) { for (const [t, b] of Object.entries(this.retained())) if (topicMatches(f, t)) this.onMessage(t, b64decode(b), true); }

  subscribe(f) {
    if (this.subs.has(f)) return;
    this.subs.add(f);
    if (this.state === 'online') setTimeout(() => this.replay(f), 0);
  }

  unsubscribe(f) { this.subs.delete(f); }

  publish(topic, bytes, { retain = false } = {}) {
    if (retain) {
      const r = this.retained();
      r[topic] = b64encode(bytes);
      try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (e) { console.warn('[live] sandbox storage full', e); }
    }
    this.ch.postMessage({ topic, data: bytes });
    return true;
  }

  deliver(topic, data) {
    for (const f of this.subs) if (topicMatches(f, topic)) { this.onMessage(topic, data, false); return; }
  }

  close() { this.ch.close(); this.state = 'offline'; }
}

export const _test = { pack, unpack, keyOf, newer, S };
