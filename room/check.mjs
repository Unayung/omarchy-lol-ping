// Self-check against upstream lolPing 0.5.2's own test vectors (tests/main/roomCrypto.test.ts,
// tests/shared/roomCode.test.ts, tests/main/nostrEvent.test.ts). Run: node room/check.mjs
import assert from 'node:assert/strict';
import {
  checkChar, decodeSigned, deriveRoomKeys, formatRoomCode, makeIdentity, makeRoomCode, MAX_PACKET, open, parseRoomCode, peerIdOf,
  PEER_RE, publicKeyOf, ROOM_ALPHABET, schnorr, seal, sealSigned, serializeEvent, signBody, signEvent, makeKeyPair, verifyBody,
} from './protocol.mjs';

const hex = (b) => Buffer.from(b).toString('hex');

// Key derivation: upstream's known-answer vectors.
const k = await deriveRoomKeys('0000000000');
assert.equal(k.msgKey.toString('hex'), '2b8ef59047332409e1662fe75774f9383fcd16b655fcb3db975f0e80ad2043da');
assert.equal(k.relayTopic, '0381782f350540d4639958bed594ae3b2b1a3d11683146e542edb34db89b6910');
assert.notEqual(hex((await deriveRoomKeys('0000000011')).msgKey), hex(k.msgKey));

// seal / open.
const key = Buffer.alloc(32, 7);
const bye = new TextEncoder().encode('{"t":"bye"}');
const packet = seal(key, bye);
assert.deepEqual(open(key, packet), Buffer.from(bye));
assert.equal(packet[0], 0x01);
assert.equal(packet.length, 1 + 12 + bye.length + 16);
assert.equal(seal(key, bye).equals(packet), false, 'fresh nonce');
for (let i = 0; i < packet.length; i++) {
  const bad = Buffer.from(packet);
  bad[i] ^= 1;
  assert.equal(open(key, bad), null, `flipped byte ${i}`);
}
assert.equal(open(Buffer.alloc(32, 8), packet), null);
assert.equal(open(key, packet.subarray(0, 20)), null);
assert.equal(open(key, Buffer.concat([packet, Buffer.alloc(MAX_PACKET)])), null);
assert.throws(() => seal(key, new Uint8Array(MAX_PACKET)));

// Ed25519 identities and signatures.
const a = makeIdentity(new Uint8Array(32).fill(1));
assert.equal(a.pk.length, 32);
assert.match(peerIdOf(a.pk), PEER_RE);
assert.equal(peerIdOf(makeIdentity(new Uint8Array(32).fill(1)).pk), peerIdOf(a.pk));
const sig = signBody(a, bye);
assert.equal(sig.length, 88);
assert.equal(verifyBody(publicKeyOf(a.pk), bye, sig), true);
assert.equal(verifyBody(publicKeyOf(a.pk), bye, signBody(makeIdentity(new Uint8Array(32).fill(2)), bye)), false);
assert.equal(verifyBody(publicKeyOf(a.pk), bye, '!!!'), false);

// Room codes: format, canonicalisation, typo detection.
const sample = makeRoomCode(Uint8Array.from([7, 20, 4, 19, 3, 2, 17, 29, 26]));
assert.equal(sample.length, 10);
assert.equal(sample[9], checkChar(sample.slice(0, 9)));
assert.equal(makeRoomCode(Uint8Array.from([32, 33, 255, 0, 0, 0, 0, 0, 0])).slice(0, 3), '01Z');
assert.match(formatRoomCode(sample), /^PING-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
assert.deepEqual(parseRoomCode(formatRoomCode(sample)), { ok: true, code: sample });
const canonical = '01ABCDEFG' + checkChar('01ABCDEFG');
const shown = formatRoomCode(canonical);
assert.deepEqual(parseRoomCode(shown.toLowerCase()), { ok: true, code: canonical });
assert.deepEqual(parseRoomCode(shown.replace(/-/g, '')), { ok: true, code: canonical });
assert.deepEqual(parseRoomCode(canonical.toLowerCase()), { ok: true, code: canonical });
assert.deepEqual(parseRoomCode(shown.replace('-0', ' O').replace('1', 'I')), { ok: true, code: canonical });
assert.deepEqual(parseRoomCode(canonical.split('').join(' ')), { ok: true, code: canonical });
for (let i = 0; i < 10; i++) {
  for (const c of ROOM_ALPHABET) {
    if (c === sample[i]) continue;
    assert.deepEqual(parseRoomCode(sample.slice(0, i) + c + sample.slice(i + 1)), { ok: false, error: 'mistyped' });
  }
}
assert.deepEqual(parseRoomCode('hello there'), { ok: false, error: 'invalid' });
assert.deepEqual(parseRoomCode('PING-123'), { ok: false, error: 'invalid' });

// A signed ping message: seal → open → decode → verify, with upstream's 4-decimal rounding.
const id = makeIdentity(new Uint8Array(32).fill(3));
const msg = { peer: peerIdOf(id.pk), seq: 1, ts: Date.now(), t: 'ping', ping: 'danger', d: 1, x: 0.123456, y: 1 };
const plain = open(k.msgKey, sealSigned(k.msgKey, id, msg));
assert.match(new TextDecoder().decode(plain), /^\{"peer":"[0-9a-f]{16}","seq":1,"ts":\d+,"t":"ping","ping":"danger","d":1,"x":0\.1235,"y":1,"sg":"[A-Za-z0-9+/]{86}=="\}$/);
const decoded = decodeSigned(plain);
assert.deepEqual(decoded.msg, { ...msg, x: 0.1235 });
assert.equal(verifyBody(publicKeyOf(id.pk), decoded.body, decoded.sig), true);
assert.equal(decodeSigned(new TextEncoder().encode(JSON.stringify({ ...msg, ping: 'nope' }))), null);
assert.equal(decodeSigned(new TextEncoder().encode(JSON.stringify({ ...msg, x: 1.5 }))), null);
assert.equal(decodeSigned(new TextEncoder().encode(JSON.stringify({ ...msg, d: 17 }))), null);

// Nostr: BIP-340 vector 0 and NIP-01 serialisation, as upstream's nostrEvent tests.
const sk = new Uint8Array(32);
sk[31] = 3;
const zero = new Uint8Array(32);
assert.equal(hex(schnorr.getPublicKey(sk)), 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
assert.equal(hex(schnorr.sign(zero, sk, zero)),
  'e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0');
const pair = makeKeyPair();
assert.equal(serializeEvent(pair.pubkey, 1700000000, 24747, [['x', 'ab']], 'hi'), `[0,"${pair.pubkey}",1700000000,24747,[["x","ab"]],"hi"]`);
const ev = signEvent(pair, 24747, [['x', 'ab']], 'hi', 1700000000);
assert.equal(schnorr.verify(Buffer.from(ev.sig, 'hex'), Buffer.from(ev.id, 'hex'), Buffer.from(ev.pubkey, 'hex')), true);

console.log('room/check.mjs: all checks passed');
