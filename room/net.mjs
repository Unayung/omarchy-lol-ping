// Room transports, ported from darrenprx/lolPing v0.5.2 (MIT, commit 2b8cdcb): src/main/lanTransport.ts,
// relayConnection.ts, relayPool.ts, relayTransport.ts, relays.ts. They move sealed packets only; RoomManager decides.
// Events: 'packet' (peerKey, Uint8Array), 'status' ('off' | 'starting' | 'ok' | 'unavailable'), 'linkUp'.
import { createSocket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { networkInterfaces } from 'node:os';
import {
  DEFAULT_FLOOD_LIMITS, eventMessage, FloodGuard, makeKeyPair, MAX_PACKET, parseRelayMessage, reqMessage, ROOM_EVENT_KIND, signEvent,
} from './protocol.mjs';

// ---- lanTransport.ts ----

export const LAN_PORT = 47474;
const INTERFACES_MS = 5000;
const LAN_DRAIN_MS = 250;

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const ip = i.address.split('.').map(Number);
      const mask = i.netmask.split('.').map(Number);
      out.add(ip.map((b, n) => (b & mask[n]) | (~mask[n] & 255)).join('.'));
    }
  }
  return [...out];
}

/** UDP on the local network: presence is broadcast, everything else goes to the address a peer's packets came from. */
export class LanTransport extends EventEmitter {
  kind = 'lan';
  shared = false;
  status = 'off';

  /** opts: { port, seeds: [{ host, port }] } — seeds get every broadcast as unicast too (tests on one machine). */
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.port = opts.port ?? LAN_PORT;
    this.sock = null;
    this.closing = Promise.resolve();
    this.running = false;
    this.targets = [];
    this.refresh = null;
    this.flood = new FloodGuard(Date.now, DEFAULT_FLOOD_LIMITS);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.targets = broadcastAddresses();
    this.refresh = setInterval(() => { this.targets = broadcastAddresses(); }, INTERFACES_MS);
    this.open();
  }

  stop() {
    this.running = false;
    if (this.refresh) clearInterval(this.refresh);
    this.refresh = null;
    this.close();
    this.setStatus('off');
  }

  whenClosed() {
    return this.closing;
  }

  sendTo(peer, packet) {
    const m = /^lan:(.+):(\d+)$/.exec(peer);
    if (m) this.send(packet, Number(m[2]), m[1]);
  }

  broadcast(packet) {
    for (const host of this.targets) this.send(packet, this.port, host);
    for (const s of this.opts.seeds ?? []) this.send(packet, s.port, s.host);
  }

  send(packet, port, host) {
    const sock = this.sock;
    if (this.status !== 'ok' || !sock) return;
    sock.pending++;
    sock.socket.send(packet, port, host, () => {
      if (--sock.pending === 0) sock.drained?.();
    });
  }

  open() {
    this.setStatus('starting');
    const socket = createSocket({ type: 'udp4' });
    const sock = { socket, pending: 0, drained: null };
    this.sock = sock;
    socket.on('message', (msg, rinfo) => {
      if (msg.length > MAX_PACKET) return;
      if (!this.flood.allow(rinfo.address)) return;
      this.emit('packet', `lan:${rinfo.address}:${rinfo.port}`, msg);
    });
    socket.on('error', (err) => {
      if (this.sock !== sock) return;
      process.stderr.write(`[lan] ${err.message}\n`);
      this.close();
      this.setStatus('unavailable');
    });
    void this.closing.then(() => {
      if (this.sock !== sock) return;
      socket.bind(this.port, '0.0.0.0', () => {
        if (this.sock !== sock) return;
        socket.setBroadcast(true);
        this.setStatus('ok');
      });
    });
  }

  close() {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    const previous = this.closing;
    const closed = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          sock.socket.close(() => resolve());
        } catch {
          resolve();
        }
      };
      const timer = setTimeout(finish, LAN_DRAIN_MS);
      if (sock.pending === 0) finish();
      else sock.drained = finish;
    });
    this.closing = Promise.all([previous, closed]).then(() => undefined);
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this.emit('status', s);
  }
}

// ---- relays.ts ----

export const RELAYS = Object.freeze([
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://relay.agentry.com',
  'wss://relay.routstr.com',
  'wss://nostr.rblb.it',
]);

// ---- relayConnection.ts ----

const SUB_ID = 'lolping';
const SINCE_S = 600;
const CONNECT_MS = 10_000;
const HEALTH_MS = 25_000;
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_RESET_MS = 60_000;
const JITTER = 0.2;
const COOL_MS = 30_000;
const MAX_MESSAGE = 64 * 1024;
const MAX_PER_SECOND = 400;
const RETIRE_PREFIXES = ['blocked:', 'restricted:', 'auth-required:', 'pow:', 'invalid:'];

/** One relay. Events: 'event', 'echo', 'live', 'ok' (eventId, ok, message), 'state'. */
class RelayConnection extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.url = opts.url;
    this.state = 'down';
    this.sock = null;
    this.stopped = true;
    this.draining = false;
    this.timer = null;
    this.attempts = 0;
    this.echoed = false;
    this.healthySince = null;
    this.closedOnce = false;
    this.windowStart = 0;
    this.windowCount = 0;
  }

  get healthy() {
    return (this.state === 'live' || this.state === 'cooling') && this.echoed;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.draining = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimer();
    this.closeSocket();
    this.state = 'down';
  }

  publish(json) {
    if (this.state !== 'live' || !this.sock) return false;
    try {
      this.sock.send(json);
      return true;
    } catch {
      return false;
    }
  }

  drain() {
    if (this.stopped) return;
    if (this.state !== 'live') return this.stop();
    this.draining = true;
  }

  connect() {
    this.clearTimer();
    this.closeSocket();
    this.echoed = false;
    this.healthySince = null;
    this.closedOnce = false;
    let sock;
    try {
      sock = new WebSocket(this.url);
    } catch {
      this.retire();
      return;
    }
    this.sock = sock;
    sock.onopen = () => {
      if (sock !== this.sock) return;
      this.subscribe();
      this.setState('live');
      this.armHealth();
      if (!this.stopped) this.emit('live');
    };
    sock.onmessage = (ev) => {
      if (sock === this.sock) this.onMessage(ev.data);
    };
    sock.onclose = sock.onerror = () => {
      if (sock === this.sock) this.down();
    };
    this.setState('connecting');
    this.timer = setTimeout(() => this.down(), CONNECT_MS);
  }

  subscribe() {
    this.sock?.send(reqMessage(SUB_ID, this.opts.topic, Math.floor(Date.now() / 1000) - SINCE_S));
  }

  onMessage(data) {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (++this.windowCount > MAX_PER_SECOND) return this.retire();
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return this.retire();
    const m = parseRelayMessage(data);
    if (!m) return;
    if (m.type === 'EVENT') {
      const e = m.event;
      if (m.subId !== SUB_ID || e.kind !== ROOM_EVENT_KIND || !e.tags.some((t) => t[0] === 'x' && t[1] === this.opts.topic)) return;
      if (e.pubkey === this.opts.pubkey) this.onEcho();
      else this.emit('event', e);
    } else if (m.type === 'OK') {
      this.emit('ok', m.eventId, m.ok, m.message);
      if (m.ok) return;
      if (m.message.startsWith('rate-limited:')) this.cool();
      else if (RETIRE_PREFIXES.some((p) => m.message.startsWith(p))) this.retire();
    } else if (m.type === 'CLOSED' && m.subId === SUB_ID) {
      if (this.closedOnce) return this.retire();
      this.closedOnce = true;
      this.subscribe();
    }
  }

  onEcho() {
    if (this.state !== 'live' && this.state !== 'cooling') return;
    if (!this.echoed) {
      this.echoed = true;
      this.healthySince = Date.now();
    }
    this.emit('echo');
    if (this.state === 'live') this.armHealth();
  }

  cool() {
    if (this.state !== 'live') return;
    if (this.draining) return this.stop();
    this.clearTimer();
    this.setState('cooling');
    this.timer = setTimeout(() => {
      this.setState('live');
      this.armHealth();
    }, COOL_MS);
  }

  armHealth() {
    this.clearTimer();
    this.timer = setTimeout(() => this.down(), HEALTH_MS);
  }

  down() {
    if (this.stopped || this.state === 'retired') return;
    if (this.draining) return this.stop();
    if (this.healthySince !== null && Date.now() - this.healthySince >= BACKOFF_RESET_MS) this.attempts = 0;
    this.clearTimer();
    this.closeSocket();
    this.echoed = false;
    this.healthySince = null;
    this.setState('down');
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempts++);
    this.timer = setTimeout(() => this.connect(), delay * (1 + (Math.random() * 2 - 1) * JITTER));
  }

  retire() {
    this.clearTimer();
    this.closeSocket();
    this.echoed = false;
    this.setState('retired');
  }

  closeSocket() {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try {
      sock.close();
    } catch {
      // already closed
    }
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setState(s) {
    if (s === this.state) return;
    this.state = s;
    if (!this.stopped) this.emit('state', s);
  }
}

// ---- relayPool.ts ----

const UNAVAILABLE_MS = 15_000;
const DEDUPE = 512;
const BUDGET_PER_SECOND = 200;

class RelayPool extends EventEmitter {
  constructor(opts) {
    super();
    this.status = 'off';
    this.everLive = new Set();
    this.failed = new Set();
    this.stopped = true;
    this.timer = null;
    this.seen = new Set();
    this.ring = [];
    this.windowStart = 0;
    this.windowCount = 0;
    this.conns = opts.urls.map((url) => {
      const c = new RelayConnection({ url, topic: opts.topic, pubkey: opts.pubkey });
      c.on('event', (e) => this.onEvent(e));
      c.on('echo', () => this.refresh());
      c.on('state', (s) => {
        if ((s === 'down' || s === 'retired') && !this.everLive.has(c)) this.failed.add(c);
        if (s === 'retired') process.stderr.write(`[relay] ${url} retired\n`);
        this.refresh();
      });
      c.on('live', () => {
        this.everLive.add(c);
        this.emit('linkUp', url);
      });
      c.on('ok', (id, ok) => this.emit('ok', id, ok));
      return c;
    });
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus('starting');
    this.timer = setTimeout(() => {
      if (this.status === 'starting') this.setStatus('unavailable');
    }, UNAVAILABLE_MS);
    for (const c of this.conns) c.start();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const c of this.conns) c.stop();
    this.status = 'off';
  }

  publish(e) {
    const json = eventMessage(e);
    return this.conns.filter((c) => c.publish(json)).length;
  }

  drain() {
    for (const c of this.conns) c.drain();
    return this.conns.filter((c) => c.state === 'live').length;
  }

  onEvent(e) {
    if (this.stopped || this.seen.has(e.id)) return;
    this.seen.add(e.id);
    this.ring.push(e.id);
    if (this.ring.length > DEDUPE) this.seen.delete(this.ring.shift());
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (++this.windowCount > BUDGET_PER_SECOND) return;
    this.emit('event', e);
  }

  refresh() {
    if (this.stopped) return;
    if (this.conns.some((c) => c.healthy)) this.setStatus('ok');
    else if (this.status === 'ok') this.setStatus('unavailable');
    else if (this.status === 'starting' && this.failed.size === this.conns.length) this.setStatus('unavailable');
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this.emit('status', s);
  }
}

// ---- relayTransport.ts ----

const MAX_CONTENT = 1600;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const RELAY_DRAIN_MS = 500;

/** Each packet is one ephemeral kind-24747 event tagged with the room topic, signed with a key made fresh per join. */
export class RelayTransport extends EventEmitter {
  kind = 'internet';
  shared = true;
  status = 'off';

  constructor(opts = {}) {
    super();
    this.urls = opts.urls ?? RELAYS;
    this.pool = null;
    this.pair = null;
    this.topic = '';
    this.lastSent = null;
    this.closing = Promise.resolve();
  }

  start(keys) {
    if (this.pool) return;
    const pair = makeKeyPair();
    const pool = new RelayPool({ urls: this.urls, topic: keys.relayTopic, pubkey: pair.pubkey });
    this.pool = pool;
    this.pair = pair;
    this.topic = keys.relayTopic;
    this.lastSent = null;
    pool.on('event', (e) => {
      if (this.pool === pool) this.onEvent(e);
    });
    pool.on('status', (s) => {
      if (this.pool === pool) this.setStatus(s);
    });
    pool.on('linkUp', () => {
      if (this.pool === pool) this.emit('linkUp');
    });
    pool.on('ok', (id) => {
      if (this.pool === pool && id === this.lastSent) this.lastSent = null;
    });
    pool.start();
  }

  stop() {
    const pool = this.pool;
    if (!pool) return;
    this.pool = this.pair = null;
    const pending = this.lastSent;
    this.lastSent = null;
    this.setStatus('off');
    const closed = new Promise((resolve) => {
      if (!pending || pool.drain() === 0) {
        pool.stop();
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        pool.off('ok', onOk);
        pool.stop();
        resolve();
      };
      const onOk = (id) => {
        if (id === pending) finish();
      };
      const timer = setTimeout(finish, RELAY_DRAIN_MS);
      pool.on('ok', onOk);
    });
    const previous = this.closing;
    this.closing = Promise.all([previous, closed]).then(() => undefined);
  }

  whenClosed() {
    return this.closing;
  }

  sendTo(_peer, packet) {
    this.broadcast(packet);
  }

  broadcast(packet) {
    if (!this.pool || !this.pair) return;
    const content = Buffer.from(packet.buffer, packet.byteOffset, packet.length).toString('base64');
    const e = signEvent(this.pair, ROOM_EVENT_KIND, [['x', this.topic]], content, Math.floor(Date.now() / 1000));
    this.lastSent = this.pool.publish(e) > 0 ? e.id : null;
  }

  onEvent(e) {
    if (e.content.length > MAX_CONTENT || !BASE64.test(e.content)) return;
    this.emit('packet', `net:${e.pubkey}`, Buffer.from(e.content, 'base64'));
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this.emit('status', s);
  }
}
