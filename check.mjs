// node check.mjs — asserts the slice picker matches League's layout (0 = N, clockwise).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const g = new Function(readFileSync(new URL('./wheel.js', import.meta.url), 'utf8') + '; return { pickSlice, sector };')();
const r = 150;
const dirs = [[0, -r], [r, -r], [r, 0], [r, r], [0, r], [-r, r], [-r, 0], [-r, -r]]; // N NE E SE S SW W NW
dirs.forEach(([dx, dy], i) => assert.equal(g.pickSlice(dx, dy, 86), i, `direction ${i}`));
assert.equal(g.pickSlice(30, -30, 86), -1, 'dead zone');
assert.equal(g.pickSlice(-1, -r, 86), 0, 'just left of north is still north');
assert.match(g.sector(86, 188, -112.5, -67.5), /^M[\d.,-]+ L.* A188,188 0 0 1 .*Z$/);
console.log('ok');
