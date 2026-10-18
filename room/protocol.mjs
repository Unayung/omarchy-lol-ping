// lolPing room protocol, the parts pings need. Ported from darrenprx/lolPing v0.5.2 (MIT, commit 2b8cdcb):
// src/main/roomCrypto.ts, src/shared/roomCode.ts, src/shared/roomProtocol.ts, src/shared/pings.ts,
// src/main/replayGuard.ts, src/main/rateLimiter.ts, src/main/floodGuard.ts, src/main/nostrEvent.ts.
// Constants are copied as-is: if any of them drift, real lolPing silently ignores us.
import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, hkdfSync, randomBytes, scrypt, sign, verify,
} from 'node:crypto';
import { hashes, schnorr } from './vendor/secp256k1.mjs';

// ---- roomCrypto.ts ----

/** Every room packet: format byte, nonce, AES-256-GCM ciphertext and tag. Larger packets are never sent or read. */
export const MAX_PACKET = 1200;
const FORMAT = 0x01;
const NONCE = 12;
const TAG = 16;
const OVERHEAD = 1 + NONCE + TAG;
const AAD = Buffer.from([FORMAT]);

/** Room code (canonical, 10 chars) → { msgKey, relayTopic }. */
export function deriveRoomKeys(canonical) {
  return new Promise((resolve, reject) => {
    scrypt(canonical, 'lolping/room/v1', 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, master) => {
      if (err) return reject(err);
      const sub = (info) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
      resolve({ msgKey: sub('msg'), relayTopic: sub('sig-room').toString('hex') });
    });
  });
}

export function seal(key, plain) {
  if (plain.length + OVERHEAD > MAX_PACKET) throw new Error('room message too large');
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([AAD, nonce, body, cipher.getAuthTag()]);
}

/** The plaintext, or null for anything that isn't a packet sealed with this key. */
export function open(key, packet) {
  if (packet.length < OVERHEAD || packet.length > MAX_PACKET || packet[0] !== FORMAT) return null;
  const buf = Buffer.from(packet.buffer, packet.byteOffset, packet.length);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 1 + NONCE));
    decipher.setAAD(AAD);
    decipher.setAuthTag(buf.subarray(buf.length - TAG));
    return Buffer.concat([decipher.update(buf.subarray(1 + NONCE, buf.length - TAG)), decipher.final()]);
  } catch {
    return null;
  }
}

// DER wrappers that turn a raw 32-byte Ed25519 seed or public key into what node:crypto imports.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** A per-session Ed25519 identity from a 32-byte seed: { pk: raw public key, key: private KeyObject }. */
export function makeIdentity(seed) {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return { pk: spki.subarray(SPKI_PREFIX.length), key };
}

/** Peer id: first 16 hex chars of SHA-256 of the raw public key. */
export const peerIdOf = (pk) => createHash('sha256').update(pk).digest('hex').slice(0, 16);

export function publicKeyOf(pk) {
  if (pk.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, pk]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

export const signBody = (id, body) => sign(null, body, id.key).toString('base64');

export function verifyBody(pk, body, sig) {
  const raw = Buffer.from(sig, 'base64');
  if (raw.length !== 64) return false;
  try {
    return verify(null, body, pk, raw);
  } catch {
    return false;
  }
}

// ---- roomCode.ts ----

/** Crockford base32: no I, L, O or U. */
export const ROOM_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;
const PREFIX = 'P1NG'; // "PING" after I→1
const MAX_INPUT = 2000;

/** Luhn mod 32 over the 9 random characters. */
export function checkChar(nine) {
  let factor = 2;
  let sum = 0;
  for (let i = nine.length - 1; i >= 0; i--) {
    let addend = factor * ROOM_ALPHABET.indexOf(nine[i]);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return ROOM_ALPHABET[(32 - (sum % 32)) % 32];
}

/** The canonical code (10 characters, no prefix) from 9 random bytes. */
export function makeRoomCode(random9) {
  let nine = '';
  for (let i = 0; i < 9; i++) nine += ROOM_ALPHABET[random9[i] & 31];
  return nine + checkChar(nine);
}

export const formatRoomCode = (canonical) => `PING-${canonical.slice(0, 5)}-${canonical.slice(5)}`;

const valid = (code) => checkChar(code.slice(0, 9)) === code[9];
const isCodeShaped = (c) => c.length === CODE_LENGTH && [...c].every((ch) => ROOM_ALPHABET.includes(ch));
const mapLookalikes = (t) => t.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');

/** Upstream's parser, unchanged: { ok: true, code } or { ok: false, error: 'invalid' | 'mistyped' }. */
export function parseRoomCode(text, opts = {}) {
  const tokens = text.slice(0, MAX_INPUT).split(/[^0-9A-Za-z-]+/)
    .map((raw) => raw.replace(/-/g, ''))
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ text: mapLookalikes(raw), digit: /[0-9]/.test(raw) }));
  let mistyped = false;
  const tryCode = (c, countsAsTypo) => {
    if (!isCodeShaped(c)) return null;
    if (valid(c)) return c;
    if (countsAsTypo) mistyped = true;
    return null;
  };
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].text.startsWith(PREFIX)) continue;
    let joined = '';
    for (let j = i; j < tokens.length; j++) {
      joined += tokens[j].text;
      if (![PREFIX.length, PREFIX.length + 5, PREFIX.length + CODE_LENGTH].includes(joined.length)) break;
      if (joined.length === PREFIX.length + CODE_LENGTH) {
        const code = tryCode(joined.slice(PREFIX.length), true);
        if (code) return { ok: true, code };
        break;
      }
    }
  }
  const whole = tokens.map((t) => t.text).join('');
  const wholeDigit = tokens.some((t) => t.digit);
  if (opts.strict ? tokens.length === 1 && wholeDigit : tokens.length === 1 || wholeDigit) {
    const code = tryCode(whole.startsWith(PREFIX) && whole.length === PREFIX.length + CODE_LENGTH ? whole.slice(PREFIX.length) : whole, true);
    if (code) return { ok: true, code };
  }
  if (!opts.strict) {
    for (const t of tokens) {
      if (!t.digit) continue;
      const code = tryCode(t.text, false);
      if (code) return { ok: true, code };
    }
  }
  return { ok: false, error: mistyped ? 'mistyped' : 'invalid' };
}

// ---- pings.ts / roomColors.ts ----

/** All 12 upstream ping ids (src/shared/pings.ts ALL_PINGS). */
export const PING_IDS = Object.freeze([
  'danger', 'push', 'omw', 'allin', 'assist', 'needvision', 'missing', 'enemyvision', 'generic', 'bait', 'visioncleared', 'missingflip',
]);
export const isPingId = (v) => typeof v === 'string' && PING_IDS.includes(v);
const TAG_COLOR_COUNT = 8;
export const isTagColor = (n) => Number.isInteger(n) && n >= 0 && n < TAG_COLOR_COUNT;

// ---- roomProtocol.ts ----

export const PROTOCOL_VERSION = 1;
export const MAX_NAME = 16;
export const MAX_DISPLAY = 16;
const MAX_APP_VERSION = 64;
const FEATURES_OFF = ['text', 'votes'];
const STATUSES = ['on', 'paused', 'muted'];
/** Message types upstream accepts that this helper only counts as liveness (it never shows them). */
const IGNORED_TYPES = ['emote', 'text', 'alive', 'vote', 'ballot', 'want'];

const UNSAFE_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\u3164\ufeff\uffa0]/g;

export function sanitizeName(raw, fallback = 'Player', max = MAX_NAME) {
  const name = [...raw.replace(UNSAFE_CHARS, '').trim()].slice(0, max).join('').trim();
  return name || fallback;
}

export const PEER_RE = /^[0-9a-f]{16}$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUint = (v) => Number.isSafeInteger(v) && v >= 0;
const isUnit = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const isDisplay = (d) => Number.isInteger(d) && d >= 1 && d <= MAX_DISPLAY;
const PK_RE = /^[A-Za-z0-9+/]{43}=$/;
const SIG_TAIL_RE = /,"sg":"([A-Za-z0-9+/]{86}==)"}$/;

/**
 * Upstream's validateMessage for presence, ping, bye and chunk; the other known types keep only their base fields
 * (we never show them, but they still prove a member is alive, as upstream). Unknown types → null.
 */
export function validateMessage(raw) {
  if (!isObj(raw)) return null;
  const { t, peer, seq, ts } = raw;
  if (typeof peer !== 'string' || !PEER_RE.test(peer) || !isUint(seq) || !isUint(ts)) return null;
  const base = { peer, seq, ts };
  switch (t) {
    case 'presence': {
      const { proto, app, name, color, status, nf, pk } = raw;
      if (!isUint(proto) || typeof app !== 'string' || app.length > MAX_APP_VERSION || typeof name !== 'string') return null;
      if (!isTagColor(color) || !STATUSES.includes(status)) return null;
      return {
        t, ...base, proto, app, name: sanitizeName(name.slice(0, 256)), color, status,
        nf: Array.isArray(nf) ? FEATURES_OFF.filter((f) => nf.includes(f)) : [],
        ...(typeof pk === 'string' && PK_RE.test(pk) ? { pk } : {}),
      };
    }
    case 'ping': {
      const { ping, d, x, y } = raw;
      if (!isPingId(ping) || !isDisplay(d) || !isUnit(x) || !isUnit(y)) return null;
      return { t, ...base, ping, d, x, y };
    }
    case 'bye':
    case 'chunk': // never signed, never shown: dropped by the caller before any guard
      return { t, ...base };
    default:
      return IGNORED_TYPES.includes(t) ? { t, ...base } : null;
  }
}

const round4 = (v) => Math.round(v * 10_000) / 10_000;

export function encodeMessage(m) {
  const out = m.t === 'ping' ? { ...m, x: round4(m.x), y: round4(m.y) } : m;
  return new TextEncoder().encode(JSON.stringify(out));
}

/** `body` (an encoded message) with the signature as its last field. */
export const joinSigned = (body, sig) => `${body.slice(0, -1)},"sg":"${sig}"}`;

export function splitSigned(plain) {
  const m = SIG_TAIL_RE.exec(plain);
  return m ? { body: `${plain.slice(0, m.index)}}`, sig: m[1] } : null;
}

/** { msg, body (the signed bytes, or all of them), sig | null }, or null. */
export function decodeSigned(plain) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    return null;
  }
  const signed = splitSigned(text);
  const body = signed ? new TextEncoder().encode(signed.body) : plain;
  const msg = decodeMessage(body);
  return msg ? { msg, body, sig: signed?.sig ?? null } : null;
}

export function decodeMessage(bytes) {
  try {
    return validateMessage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    return null;
  }
}

/** Seals `msg` (with peer/seq/ts already set), signed unless it is a chunk, exactly like RoomManager.seal. */
export function sealSigned(msgKey, identity, msg) {
  const bytes = encodeMessage(msg);
  if (msg.t === 'chunk') return seal(msgKey, bytes);
  const signed = joinSigned(new TextDecoder().decode(bytes), signBody(identity, bytes));
  return seal(msgKey, new TextEncoder().encode(signed));
}

// ---- replayGuard.ts ----

const WINDOW = 64;
const MAX_SKEW_MS = 10 * 60 * 1000;

export class ReplayGuard {
  constructor(now) {
    this.now = now;
    this.peers = new Map();
    this.gone = new Set();
  }

  /** 'ok' | 'stale' | 'replay' | 'gone' */
  accept(peer, seq, ts) {
    if (this.gone.has(peer)) return 'gone';
    if (Math.abs(ts - this.now()) > MAX_SKEW_MS) return 'stale';
    const p = this.peers.get(peer);
    if (!p) {
      this.peers.set(peer, { max: seq, bits: 1n });
      return 'ok';
    }
    if (seq > p.max) {
      const shift = seq - p.max;
      p.bits = shift >= WINDOW ? 1n : ((p.bits << BigInt(shift)) | 1n) & ((1n << BigInt(WINDOW)) - 1n);
      p.max = seq;
      return 'ok';
    }
    const back = p.max - seq;
    if (back >= WINDOW) return 'replay';
    const bit = 1n << BigInt(back);
    if (p.bits & bit) return 'replay';
    p.bits |= bit;
    return 'ok';
  }

  markGone(peer) {
    this.gone.add(peer);
    this.peers.delete(peer);
  }
}

// ---- rateLimiter.ts / floodGuard.ts ----

export class RateLimiter {
  constructor(now) {
    this.now = now;
    this.buckets = new Map();
  }

  /** `perSecond` 0 means unlimited. */
  allow(key, perSecond, burst = perSecond) {
    if (perSecond <= 0) return true;
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  forget(key) {
    this.buckets.delete(key);
  }

  get size() {
    return this.buckets.size;
  }

  clear() {
    this.buckets.clear();
  }
}

export const DEFAULT_FLOOD_LIMITS = { perIp: 100, total: 800, maxTracked: 1024 };

export class FloodGuard {
  constructor(now, limits = DEFAULT_FLOOD_LIMITS) {
    this.limits = limits;
    this.perIp = new RateLimiter(now);
    this.total = new RateLimiter(now);
  }

  allow(ip) {
    if (this.perIp.size >= this.limits.maxTracked) this.perIp.clear();
    return this.perIp.allow(ip, this.limits.perIp) && this.total.allow('*', this.limits.total);
  }
}

// ---- nostrEvent.ts ----

hashes.sha256 = (msg) => new Uint8Array(createHash('sha256').update(msg).digest());

/** Ephemeral (20000–29999): relays forward these to subscribers and don't store them. */
export const ROOM_EVENT_KIND = 24747;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const toHex = (b) => Buffer.from(b).toString('hex');

export { schnorr };

export function makeKeyPair() {
  const { secretKey, publicKey } = schnorr.keygen();
  return { secretKey, pubkey: toHex(publicKey) };
}

export const serializeEvent = (pubkey, createdAt, kind, tags, content) => JSON.stringify([0, pubkey, createdAt, kind, tags, content]);

export function signEvent(keys, kind, tags, content, createdAt) {
  const id = createHash('sha256').update(serializeEvent(keys.pubkey, createdAt, kind, tags, content)).digest();
  return { id: id.toString('hex'), pubkey: keys.pubkey, created_at: createdAt, kind, tags, content, sig: toHex(schnorr.sign(id, keys.secretKey)) };
}

export const reqMessage = (subId, topic, since) =>
  JSON.stringify(['REQ', subId, { kinds: [ROOM_EVENT_KIND], '#x': [topic], since, limit: 0 }]);
export const eventMessage = (e) => JSON.stringify(['EVENT', e]);

const isTags = (t) => Array.isArray(t) && t.every((tag) => Array.isArray(tag) && tag.every((v) => typeof v === 'string'));

function toEvent(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw;
  if (typeof e.id !== 'string' || !HEX64.test(e.id)) return null;
  if (typeof e.pubkey !== 'string' || !HEX64.test(e.pubkey)) return null;
  if (typeof e.sig !== 'string' || !HEX128.test(e.sig)) return null;
  if (!Number.isSafeInteger(e.created_at) || e.created_at < 0) return null;
  if (!Number.isSafeInteger(e.kind)) return null;
  if (!isTags(e.tags) || typeof e.content !== 'string') return null;
  return { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags.map((tag) => [...tag]), content: e.content, sig: e.sig };
}

export function parseRelayMessage(text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(m) || typeof m[0] !== 'string') return null;
  const optional = (v) => (v === undefined ? '' : typeof v === 'string' ? v : null);
  switch (m[0]) {
    case 'EVENT': {
      const event = toEvent(m[2]);
      return typeof m[1] === 'string' && event ? { type: 'EVENT', subId: m[1], event } : null;
    }
    case 'OK': {
      const message = optional(m[3]);
      return typeof m[1] === 'string' && HEX64.test(m[1]) && typeof m[2] === 'boolean' && message !== null
        ? { type: 'OK', eventId: m[1], ok: m[2], message }
        : null;
    }
    case 'EOSE':
      return typeof m[1] === 'string' ? { type: 'EOSE', subId: m[1] } : null;
    case 'CLOSED': {
      const message = optional(m[2]);
      return typeof m[1] === 'string' && message !== null ? { type: 'CLOSED', subId: m[1], message } : null;
    }
    case 'NOTICE':
      return typeof m[1] === 'string' ? { type: 'NOTICE', message: m[1] } : null;
    default:
      return null;
  }
}
