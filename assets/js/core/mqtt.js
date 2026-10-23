// Minimal MQTT 3.1.1 client over WebSocket (no dependencies; runs in the browser and in Node 22+). A copy of Combat
// Ring's core/mqtt.js (the sister battle-table site); keep the two in step. Used by core/live.js.
// Just what live updates need: QoS 0 publish (optionally retained), subscribe, keepalive, auto-reconnect.
// The keepalive is long (60 s, a ping every 30 s) because background tabs only get a timer about once a minute.
// A retained message with an empty payload clears that topic on the broker.

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s) {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function remainingLength(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    out.push(byte);
  } while (n > 0);
  return out;
}

function packet(first, body) {
  const head = [first, ...remainingLength(body.length)];
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Does an MQTT topic filter (with + and #) match a topic? */
export function topicMatches(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export class MqttClient {
  /**
   * url: wss://host:port/path. opts: {clientId, keepalive (s), onMessage(topic, bytes, retained), onStatus(state)}
   * state: 'connecting' | 'online' | 'offline'
   */
  constructor(url, { clientId, keepalive = 60, onMessage, onStatus } = {}) {
    this.url = url;
    this.clientId = clientId || `sw-${Math.random().toString(36).slice(2, 12)}`;
    this.keepalive = keepalive;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.subs = new Set();
    this.queue = []; // packets published while offline (sent on reconnect, newest per retained topic only)
    this.state = 'offline';
    this.buf = new Uint8Array(0);
    this.packetId = 1;
    this.closed = false;
    this.backoff = 1000;
    this.ws = null;
    this.pingTimer = 0;
    this.lastIn = 0;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    try { this.onStatus(s); } catch (e) { console.error('[mqtt] status listener', e); }
  }

  connect() {
    this.closed = false;
    this.open();
    return this;
  }

  open() {
    if (this.closed) return;
    this.setState('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch (e) {
      this.retry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.buf = new Uint8Array(0);
    ws.onopen = () => {
      const flags = 0x02; // clean session
      const body = [...str('MQTT'), 4, flags, this.keepalive >> 8, this.keepalive & 255, ...str(this.clientId)];
      ws.send(packet(0x10, body));
    };
    ws.onmessage = (ev) => {
      this.lastIn = Date.now();
      const data = new Uint8Array(ev.data instanceof ArrayBuffer ? ev.data : ev.data.buffer || ev.data);
      this.buf = this.buf.length ? concat([this.buf, data]) : data;
      this.drain();
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      this.setState('offline');
      this.retry();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
  }

  retry() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15000);
    this.retryTimer = setTimeout(() => this.open(), wait);
  }

  drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1, len = 0, i = 1, byte;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const first = this.buf[0];
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this.handle(first, body);
    }
  }

  handle(first, body) {
    const type = first >> 4;
    if (type === 2) { // CONNACK
      if (body[1] !== 0) { console.warn('[mqtt] connection refused', body[1]); this.ws?.close(); return; }
      this.backoff = 1000;
      this.setState('online');
      clearInterval(this.pingTimer);
      this.lastIn = Date.now();
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastIn > this.keepalive * 2000) { this.ws?.close(); return; }
        this.send(new Uint8Array([0xc0, 0]));
      }, (this.keepalive * 1000) / 2);
      if (this.subs.size) this.sendSubscribe([...this.subs]);
      const q = this.queue;
      this.queue = [];
      for (const p of q) this.send(p.bytes);
    } else if (type === 3) { // PUBLISH
      const qos = (first >> 1) & 3;
      const retained = !!(first & 1);
      const tlen = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      let o = 2 + tlen;
      if (qos > 0) {
        const id = (body[o] << 8) | body[o + 1];
        o += 2;
        this.send(new Uint8Array([0x40, 2, id >> 8, id & 255])); // PUBACK
      }
      try { this.onMessage(topic, body.slice(o), retained); } catch (e) { console.error('[mqtt] message listener', e); }
    }
    // SUBACK (9), PUBACK (4), PINGRESP (13): nothing to do
  }

  send(bytes) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(bytes); return true; }
    return false;
  }

  nextId() {
    this.packetId = (this.packetId % 65535) + 1;
    return this.packetId;
  }

  sendSubscribe(filters) {
    const id = this.nextId();
    const body = [id >> 8, id & 255];
    for (const f of filters) body.push(...str(f), 0);
    this.send(packet(0x82, body));
  }

  subscribe(filter) {
    if (this.subs.has(filter)) return;
    this.subs.add(filter);
    if (this.state === 'online') this.sendSubscribe([filter]);
  }

  unsubscribe(filter) {
    if (!this.subs.delete(filter) || this.state !== 'online') return;
    const id = this.nextId();
    this.send(packet(0xa2, [id >> 8, id & 255, ...str(filter)]));
  }

  /** Publish bytes (Uint8Array) or text. retain: the broker keeps the last one for new subscribers. */
  publish(topic, payload, { retain = false } = {}) {
    const data = typeof payload === 'string' ? enc.encode(payload) : payload || new Uint8Array(0);
    const t = str(topic);
    const body = new Uint8Array(t.length + data.length);
    body.set(t, 0);
    body.set(data, t.length);
    const bytes = packet(0x30 | (retain ? 1 : 0), body);
    if (this.send(bytes)) return true;
    // Offline: keep retained state (latest per topic) to send on reconnect; drop transient messages.
    if (retain) {
      this.queue = this.queue.filter((p) => p.topic !== topic);
      this.queue.push({ topic, bytes });
    }
    return false;
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    if (this.ws) {
      this.send(new Uint8Array([0xe0, 0]));
      try { this.ws.close(); } catch { /* ignore */ }
    }
    this.ws = null;
    this.setState('offline');
  }
}
