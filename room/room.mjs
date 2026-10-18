#!/usr/bin/env node
// Headless lolPing room member for the Ping Wheel plugin: pings only. Network logic ported from
// darrenprx/lolPing v0.5.2 src/main/roomManager.ts (MIT, commit 2b8cdcb), minus emotes, text, votes and the panel.
//
//   node room/room.mjs --new-code
//   node room/room.mjs --code <CODE> --name <NAME> --color <0-7> [--lan-only] [--port <udp>] [--seed <host:port>]...
//
// stdin  (JSON lines): {"t":"ping","id":"danger","d":1,"x":0.42,"y":0.17}
// stdout (JSON lines): {"t":"ping",...,"name","color"} | {"t":"members","list":[...]} | {"t":"status","lan","internet"}
// stderr: diagnostics. --port/--seed exist only to run several members on one machine (tests); real lolPing uses 47474.
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { LanTransport, LAN_PORT, RelayTransport } from './net.mjs';
import {
  decodeSigned, deriveRoomKeys, formatRoomCode, isPingId, isTagColor, makeIdentity, makeRoomCode, MAX_DISPLAY, open, parseRoomCode,
  peerIdOf, PROTOCOL_VERSION, publicKeyOf, RateLimiter, ReplayGuard, sanitizeName, sealSigned, verifyBody,
} from './protocol.mjs';

/** What we announce: the version real 0.5.2 apps treat as a current member. */
const APP_VERSION = '0.5.2';
/** We show no room text and take part in no votes, so friends' apps don't send them. */
const FEATURES_OFF = ['text', 'votes'];
/** Upstream's default "incoming ping limit" (settings.incomingPingLimit): pings per second per member. */
const INCOMING_LIMIT = 5;

// roomManager.ts constants.
const MAX_MEMBERS = 16;
const SETTLE_MS = 3000;
const SETTLE_CAP_MS = 15_000;
const TICK_MS = 1000;
const PRESENCE_MS = { lan: 2000, internet: 10_000 };
const ALIVE_MS = { lan: 6000, internet: 25_000 };
const DROP_MS = { lan: 15_000, internet: 30_000 };
const RELAY_PING_RATE = 5;
const RELAY_PING_BURST = 10;
const SHARED_PRESENCE_MS = 1000;
const SLEEP_GAP_MS = 5000;
/** Our own hard stop after stdin EOF / SIGTERM: transports drain within 500 ms, this is the backstop. */
const EXIT_DEADLINE_MS = 1500;

const log = (s) => process.stderr.write(`[room] ${s}\n`);
let stdoutOpen = true;
const out = (obj) => {
  if (stdoutOpen) process.stdout.write(`${JSON.stringify(obj)}\n`);
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));

class Room {
  constructor({ code, name, color, transports }) {
    this.code = code;
    this.name = name;
    this.color = color;
    this.transports = transports;
    this.identity = makeIdentity(randomBytes(32));
    this.self = peerIdOf(this.identity.pk);
    this.seq = 0;
    this.phase = 'joining';
    this.keys = null;
    this.members = new Map();
    this.answered = new Set();
    this.signedGuard = new ReplayGuard(Date.now);
    this.unsignedGuard = new ReplayGuard(Date.now);
    this.boundIds = new Set();
    this.limiter = new RateLimiter(Date.now);
    this.relayCap = new RateLimiter(Date.now);
    this.lastPresence = {};
    this.sharedTimers = new Map();
    this.ticker = null;
    this.settle = null;
    this.settleShort = false;
    this.joinedAt = 0;
    this.lastTick = 0;
    this.wokeAt = 0;
    this.lastMembers = '[]';
    this.lastStatus = '';
    this.onFull = () => {};
    for (const t of transports) {
      t.on('packet', (key, packet) => this.onPacket(t, key, packet));
      t.on('status', (s) => {
        if (s === 'ok' && !t.shared) this.announce(t);
        this.checkSettle();
        this.emitState();
      });
      t.on('linkUp', () => this.announce(t));
    }
  }

  async start() {
    log(`joining ${formatRoomCode(this.code)} as ${this.self}`);
    this.emitState();
    const keys = await deriveRoomKeys(this.code);
    if (this.phase === 'idle') return; // left while deriving keys
    this.keys = keys;
    this.joinedAt = this.lastTick = Date.now();
    this.settle = setTimeout(() => this.settled(), SETTLE_CAP_MS);
    for (const t of this.transports) t.start(this.keys);
    this.announce();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.checkSettle();
    this.emitState();
  }

  /** Bye on every transport (broadcast + LAN unicast to members), then stop them and wait for the bye to drain. */
  async leave() {
    if (this.phase === 'idle') return;
    this.phase = 'idle';
    if (this.keys) {
      const bye = this.seal({ t: 'bye' });
      for (const t of this.transports) this.spread(t, bye);
    }
    for (const t of this.transports) t.stop();
    for (const timer of this.sharedTimers.values()) clearTimeout(timer);
    this.sharedTimers.clear();
    if (this.ticker) clearInterval(this.ticker);
    if (this.settle) clearTimeout(this.settle);
    await Promise.all(this.transports.map((t) => t.whenClosed()));
  }

  sendPing(ping, d, x, y) {
    if (this.phase === 'idle' || !this.keys) return;
    const packet = this.seal({ t: 'ping', ping, d, x, y });
    const sharedRoutes = new Set();
    for (const m of this.members.values()) {
      const route = this.route(m);
      if (!route) continue;
      if (route.transport.shared) sharedRoutes.add(route.transport);
      else route.transport.sendTo(route.key, packet);
    }
    for (const t of sharedRoutes) if (this.relayCap.allow(t.kind, RELAY_PING_RATE, RELAY_PING_BURST)) t.broadcast(packet);
  }

  checkSettle() {
    if (this.phase !== 'joining' || !this.settle || this.settleShort) return;
    if (this.transports.some((t) => t.shared && (t.status === 'off' || t.status === 'starting'))) return;
    this.settleShort = true;
    clearTimeout(this.settle);
    this.settle = setTimeout(() => this.settled(), Math.min(SETTLE_MS, this.joinedAt + SETTLE_CAP_MS - Date.now()));
  }

  settled() {
    this.settle = null;
    if (this.phase !== 'joining') return;
    if (this.members.size >= MAX_MEMBERS) return this.onFull();
    this.phase = 'active';
  }

  tick() {
    const now = Date.now();
    if (now - this.lastTick > SLEEP_GAP_MS) this.wokeAt = now;
    this.lastTick = now;
    for (const m of [...this.members.values()]) {
      const heard = Math.max(...Object.values(m.paths).map((p) => p.seenAt), m.firstSeen, this.wokeAt);
      if (now - heard >= DROP_MS[m.viaInternet ? 'internet' : 'lan']) this.remove(m, 'timed out');
    }
    for (const t of this.transports) {
      if (now - (this.lastPresence[t.kind] ?? 0) >= PRESENCE_MS[t.kind]) this.sendPresence(t);
    }
    this.emitState();
  }

  onPacket(t, key, packet) {
    if (!this.keys || this.phase === 'idle') return;
    const plain = open(this.keys.msgKey, packet);
    const decoded = plain && decodeSigned(plain);
    if (!decoded || decoded.msg.peer === this.self) return;
    const { msg, body, sig } = decoded;
    // Chunks (emote stills) are unsigned and never move a replay window or a liveness clock; we fetch no stills.
    if (msg.t === 'chunk') return;
    let pk = null;
    if (sig) {
      pk = msg.t === 'presence' ? this.provenKey(msg) : this.members.get(msg.peer)?.pk ?? null;
      if (!pk || !verifyBody(pk, body, sig)) return;
    } else if (this.boundIds.has(msg.peer)) {
      return; // unsigned packet claiming an id a signed presence proved: forged
    }
    const guard = sig ? this.signedGuard : this.unsignedGuard;
    if (guard.accept(msg.peer, msg.seq, msg.ts) !== 'ok') return;

    if (msg.t === 'presence') return this.onPresence(t, key, msg, pk);
    const m = this.members.get(msg.peer);
    if (msg.t === 'bye') {
      guard.markGone(msg.peer);
      if (m) this.remove(m, 'left');
      return;
    }
    if (!m) return;
    this.heard(m, t, key);
    if (msg.t !== 'ping' || m.needsUpdate) return; // emotes, text, alive lines, votes, wants: not shown here
    if (!this.limiter.allow(m.peer, INCOMING_LIMIT)) return;
    out({ t: 'ping', id: msg.ping, d: msg.d, x: clamp01(msg.x), y: clamp01(msg.y), name: m.name, color: m.color });
  }

  provenKey(msg) {
    if (!msg.pk) return null;
    const raw = Buffer.from(msg.pk, 'base64');
    return peerIdOf(raw) === msg.peer ? publicKeyOf(raw) : null;
  }

  onPresence(t, key, msg, pk) {
    let m = this.members.get(msg.peer);
    if (!m) {
      if (this.phase === 'active' && this.members.size + 1 >= MAX_MEMBERS) return;
      if (!t.shared && this.membersAt(t.kind, key) >= 2) return;
      m = { peer: msg.peer, firstSeen: Date.now(), viaInternet: false, paths: {}, pk: null };
      this.members.set(m.peer, m);
      log(`member ${msg.peer} "${msg.name}" (app ${msg.app}) via ${t.kind}`);
    }
    if (pk) {
      m.pk = pk;
      this.boundIds.add(m.peer);
    }
    m.name = msg.name;
    m.color = msg.color;
    m.needsUpdate = msg.proto !== PROTOCOL_VERSION;
    this.heard(m, t, key);
    if (!this.answered.has(key)) {
      this.answered.add(key);
      if (t.shared) this.announce(t);
      else t.sendTo(key, this.presencePacket());
    }
    this.emitState();
  }

  heard(m, t, key) {
    m.paths[t.kind] = { key, seenAt: Date.now() };
    if (t.kind === 'internet') m.viaInternet = true;
  }

  remove(m, why) {
    this.members.delete(m.peer);
    this.limiter.forget(m.peer);
    for (const p of Object.values(m.paths)) this.answered.delete(p.key);
    log(`member ${m.peer} "${m.name}" ${why}`);
    this.emitState();
  }

  membersAt(kind, key) {
    return [...this.members.values()].filter((m) => m.paths[kind]?.key === key).length;
  }

  /** LAN while it is alive, else internet, else nothing. */
  route(m) {
    const now = Date.now();
    for (const kind of ['lan', 'internet']) {
      const p = m.paths[kind];
      const transport = this.transports.find((t) => t.kind === kind);
      if (p && transport && now - p.seenAt < ALIVE_MS[kind]) return { transport, key: p.key };
    }
    return null;
  }

  presencePacket() {
    return this.seal({
      t: 'presence', proto: PROTOCOL_VERSION, app: APP_VERSION, name: this.name, color: this.color, status: 'on',
      em: [], pk: this.identity.pk.toString('base64'), nf: [...FEATURES_OFF],
    });
  }

  announce(only) {
    if (!this.keys || this.phase === 'idle') return;
    for (const t of only ? [only] : this.transports) {
      if (!t.shared) {
        this.sendPresence(t);
        continue;
      }
      const wait = (this.lastPresence[t.kind] ?? -Infinity) + SHARED_PRESENCE_MS - Date.now();
      if (wait <= 0) this.sendPresence(t);
      else if (!this.sharedTimers.has(t)) {
        this.sharedTimers.set(t, setTimeout(() => {
          this.sharedTimers.delete(t);
          if (this.keys && this.phase !== 'idle') this.sendPresence(t);
        }, wait));
      }
    }
  }

  sendPresence(t) {
    const timer = this.sharedTimers.get(t);
    if (timer) clearTimeout(timer);
    this.sharedTimers.delete(t);
    this.spread(t, this.presencePacket());
    this.lastPresence[t.kind] = Date.now();
  }

  /** Broadcast, and on LAN also unicast to every member heard there (Wi-Fi broadcast has no retries). */
  spread(t, packet) {
    t.broadcast(packet);
    if (t.shared) return;
    for (const m of this.members.values()) {
      const key = m.paths.lan?.key;
      if (key) t.sendTo(key, packet);
    }
  }

  seal(body) {
    return sealSigned(this.keys.msgKey, this.identity, { peer: this.self, seq: ++this.seq, ts: Date.now(), ...body });
  }

  /** members: others only, `via` = how they are reached now (or were last heard). status: upstream's words. */
  emitState() {
    const list = [...this.members.values()].map((m) => {
      const r = this.route(m);
      const kind = r ? r.transport.kind : (m.paths.lan?.seenAt ?? -1) >= (m.paths.internet?.seenAt ?? -1) ? 'lan' : 'internet';
      return { name: m.name, color: m.color, via: kind === 'lan' ? 'lan' : 'net' };
    });
    const membersJson = JSON.stringify(list);
    if (membersJson !== this.lastMembers) {
      this.lastMembers = membersJson;
      out({ t: 'members', list });
    }
    const status = (kind) => this.transports.find((t) => t.kind === kind)?.status ?? 'off';
    const s = { t: 'status', lan: status('lan'), internet: status('internet') };
    const statusJson = JSON.stringify(s);
    if (statusJson !== this.lastStatus) {
      this.lastStatus = statusJson;
      out(s);
    }
  }
}

function usage(msg) {
  process.stderr.write(`room: ${msg} (usage: room.mjs --new-code | --code <CODE> --name <NAME> --color <0-7> [--lan-only])\n`);
  process.exit(2);
}

async function main() {
  let args;
  try {
    args = parseArgs({
      options: {
        'new-code': { type: 'boolean', default: false },
        code: { type: 'string' },
        name: { type: 'string', default: 'Player' },
        color: { type: 'string', default: '0' },
        'lan-only': { type: 'boolean', default: false },
        port: { type: 'string' },
        seed: { type: 'string', multiple: true },
      },
    }).values;
  } catch (e) {
    usage(e.message);
  }
  if (args['new-code']) {
    process.stdout.write(`${formatRoomCode(makeRoomCode(randomBytes(9)))}\n`);
    return;
  }
  if (args.code === undefined) usage('missing --code');
  const parsed = parseRoomCode(args.code);
  if (!parsed.ok) usage(parsed.error === 'mistyped' ? 'room code has a typo (check character mismatch)' : 'not a room code');
  const color = Number(args.color);
  if (!/^\d+$/.test(args.color) || !isTagColor(color)) usage('--color must be 0-7');
  const port = args.port === undefined ? LAN_PORT : Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) usage('--port must be 1-65535');
  const seeds = (args.seed ?? []).map((s) => {
    const m = /^(.+):(\d+)$/.exec(s);
    if (!m) usage('--seed must be host:port');
    return { host: m[1], port: Number(m[2]) };
  });

  const transports = [new LanTransport({ port, seeds })];
  if (!args['lan-only']) transports.push(new RelayTransport());
  const room = new Room({ code: parsed.code, name: sanitizeName(args.name), color, transports });

  let leaving = false;
  const quit = (why, code = 0) => {
    if (leaving) return;
    leaving = true;
    log(`leaving (${why})`);
    setTimeout(() => process.exit(code), EXIT_DEADLINE_MS).unref();
    room.leave().then(() => process.exit(code), () => process.exit(code));
  };
  room.onFull = () => {
    log('room is full (16 members)');
    quit('room full', 3);
  };
  process.on('SIGTERM', () => quit('SIGTERM'));
  process.on('SIGINT', () => quit('SIGINT'));
  process.stdout.on('error', () => {
    stdoutOpen = false;
    quit('stdout closed');
  });

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (leaving || line.length > 4096) return;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof m !== 'object' || m === null || m.t !== 'ping' || !isPingId(m.id)) return;
    if (!Number.isInteger(m.d) || m.d < 1 || m.d > MAX_DISPLAY) return;
    if (typeof m.x !== 'number' || typeof m.y !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    room.sendPing(m.id, m.d, clamp01(m.x), clamp01(m.y));
  });
  rl.on('close', () => quit('stdin closed'));

  await room.start();
}

main().catch((e) => {
  process.stderr.write(`room: ${e?.stack ?? e}\n`);
  process.exit(1);
});
