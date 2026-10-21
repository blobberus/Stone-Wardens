// GitHub REST client for reading the repo tree/blobs and writing batch commits.
import { b64encode } from './util.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class GitHubBackend {
  constructor({ token, owner, repo, branch = 'main' }) {
    Object.assign(this, { token, owner, repo, branch });
    this.mode = 'github';
  }

  async request(method, path, body, { accept = 'application/vnd.github+json', as = 'json' } = {}) {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
      if (res.status === 401) msg = 'The saved GitHub token was rejected (expired or revoked). Ask the repo owner to run setup again.';
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') msg = 'GitHub rate limit reached — try again in a few minutes.';
      throw new GitHubError(res.status, msg);
    }
    if (as === 'bytes') return new Uint8Array(await res.arrayBuffer());
    if (as === 'none' || res.status === 204) return null;
    return res.json();
  }

  async head() {
    const ref = await this.request('GET', `/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const commit = await this.request('GET', `/git/commits/${ref.object.sha}`);
    return { commit: ref.object.sha, tree: commit.tree.sha };
  }

  /** Full recursive listing of blobs: [{path, sha, size}] plus the head it came from. */
  async tree() {
    const head = await this.head();
    const t = await this.request('GET', `/git/trees/${head.tree}?recursive=1`);
    if (t.truncated) console.warn('[store] repo tree truncated by GitHub API');
    const files = t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha, size: e.size }));
    return { head, files };
  }

  readBytes(sha) {
    return this.request('GET', `/git/blobs/${sha}`, null, { accept: 'application/vnd.github.raw+json', as: 'bytes' });
  }

  async createBlob(bytes) {
    const r = await this.request('POST', '/git/blobs', { content: b64encode(bytes), encoding: 'base64' });
    return r.sha;
  }

  /**
   * Commit a batch of changes in one commit.
   * changes: [{path, text}] | [{path, bytes}] | [{path, delete: true}]
   */
  async commit(changes, message) {
    // Binary blobs are uploaded once up front; they don't depend on the base tree.
    const prepared = [];
    for (const c of changes) {
      if (c.bytes) prepared.push({ path: c.path, sha: await this.createBlob(c.bytes) });
      else prepared.push(c);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const { head, files } = await this.tree();
      const existing = new Set(files.map((f) => f.path));
      const entries = [];
      for (const c of prepared) {
        if (c.delete) {
          if (existing.has(c.path)) entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
        } else if (c.sha) entries.push({ path: c.path, mode: '100644', type: 'blob', sha: c.sha });
        else entries.push({ path: c.path, mode: '100644', type: 'blob', content: c.text });
      }
      if (!entries.length) return { head, files };
      const tree = await this.request('POST', '/git/trees', { base_tree: head.tree, tree: entries });
      const commit = await this.request('POST', '/git/commits', { message, tree: tree.sha, parents: [head.commit] });
      try {
        await this.request('PATCH', `/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: commit.sha, force: false });
      } catch (e) {
        if (e.status === 422 || e.status === 409) continue; // someone else pushed first: rebuild on the new head
        throw e;
      }
      // Read back the tree we just created (avoids ref replication lag right after the update).
      const t = await this.request('GET', `/git/trees/${tree.sha}?recursive=1`);
      return {
        head: { commit: commit.sha, tree: tree.sha },
        files: t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha, size: e.size })),
      };
    }
    throw new GitHubError(409, 'Could not save: the repository kept changing. Please try again.');
  }
}
