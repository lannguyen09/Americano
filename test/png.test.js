'use strict';
const assert = require('assert');
const zlib = require('zlib');
const P = require('../tools/png.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

test('crc32 matches the PNG reference value', () => {
  assert.strictEqual(P.crc32(Buffer.from('IEND', 'latin1')), 0xae426082);
});

test('encode → decode round trip (RGBA)', () => {
  const data = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) & 0xff);
  const img = P.decode(P.encode({ width: 3, height: 2, data }));
  assert.deepStrictEqual([img.width, img.height], [3, 2]);
  assert.deepStrictEqual(Array.from(img.data), Array.from(data));
});

test('decode palette PNG with transparency and filters', () => {
  const chunk = (type, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), d]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(P.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 3;
  const raw = Buffer.from([0, 0, 1, /* row 2, filter Up: +0, +1 */ 2, 1, 0]);
  const buf = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 255])), chunk('tRNS', Buffer.from([128])),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const img = P.decode(buf);
  assert.deepStrictEqual(Array.from(img.data), [255, 0, 0, 128, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
});

test('icons: requested size, opaque, logo centred on the background', () => {
  const logo = { width: 2, height: 2, data: new Uint8Array(16).fill(255) }; // white square
  const icon = P.iconFromImage(logo, 64, '#000000');
  assert.deepStrictEqual([icon.width, icon.height], [64, 64]);
  const px = (x, y) => Array.from(icon.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
  assert.deepStrictEqual(px(0, 0), [0, 0, 0, 255], 'corner = background');
  assert.deepStrictEqual(px(32, 32), [255, 255, 255, 255], 'centre = logo');
  const ring = P.ringIcon(64, '#000000', '#ffffff');
  assert.ok(ring.data.every((v, i) => i % 4 !== 3 || v === 255), 'opaque');
  assert.deepStrictEqual(Array.from(ring.data.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 3)), [0, 0, 0], 'ring hole');
});

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll png tests passed');
