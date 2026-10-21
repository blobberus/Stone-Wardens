// Minimal promise wrapper around IndexedDB key/value stores.

const dbs = new Map();

function openDb(name, stores) {
  if (!dbs.has(name)) {
    dbs.set(name, new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => stores.forEach((s) => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }
  return dbs.get(name);
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** kv('sw-cache', 'blobs') -> {get, set, del, keys, entries, clear} */
export function kv(dbName, store) {
  const db = () => openDb(dbName, [store]);
  return {
    get: async (k) => tx(await db(), store, 'readonly', (s) => s.get(k)),
    set: async (k, v) => tx(await db(), store, 'readwrite', (s) => s.put(v, k)),
    del: async (k) => tx(await db(), store, 'readwrite', (s) => s.delete(k)),
    keys: async () => tx(await db(), store, 'readonly', (s) => s.getAllKeys()),
    values: async () => tx(await db(), store, 'readonly', (s) => s.getAll()),
    clear: async () => tx(await db(), store, 'readwrite', (s) => s.clear()),
  };
}

/** Never let a broken/blocked IndexedDB (private mode etc.) break the app. */
export function safe(store) {
  const wrap = (fn, fallback) => async (...a) => { try { return await fn(...a); } catch { return fallback; } };
  return {
    get: wrap(store.get, undefined), set: wrap(store.set), del: wrap(store.del),
    keys: wrap(store.keys, []), values: wrap(store.values, []), clear: wrap(store.clear),
  };
}
