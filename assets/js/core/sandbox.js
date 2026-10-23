// Local-only backend with the same interface as GitHubBackend (IndexedDB). Used for ?sandbox and local dev.
import { kv, safe } from './idb.js';
import { gitBlobSha } from './util.js';

const files = safe(kv('sw-sandbox', 'files')); // path -> {sha, bytes}

export class SandboxBackend {
  constructor() { this.mode = 'sandbox'; }

  async tree() {
    const all = (await files.values()) || [];
    return {
      head: { commit: 'sandbox', tree: 'sandbox' },
      files: all.map((f) => ({ path: f.path, sha: f.sha, size: f.bytes.length })),
    };
  }

  /** Other tabs may have committed: always worth a (cheap, local) pull. */
  async headChanged() { return true; }

  async readBytes(sha) {
    const all = (await files.values()) || [];
    const f = all.find((x) => x.sha === sha);
    if (!f) throw new Error(`sandbox: missing blob ${sha}`);
    return f.bytes;
  }

  async commit(changes) {
    for (const c of changes) {
      if (c.delete) { await files.del(c.path); continue; }
      const bytes = c.bytes || new TextEncoder().encode(c.text);
      await files.set(c.path, { path: c.path, bytes, sha: await gitBlobSha(bytes) });
    }
    return this.tree();
  }
}
