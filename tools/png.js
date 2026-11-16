'use strict';
// Minimal PNG tools for the build (Node built-ins only): decode 8-bit non-interlaced PNGs,
// scale onto a square background, draw a fallback ring icon, encode RGBA PNG.
const zlib = require('zlib');

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// → {width, height, data: Uint8Array RGBA}
function decode(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let pos = 8, w, h, depth, ctype, interlace, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') palette = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || interlace || !ch) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${ctype}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[row - stride + x] : 0, c = x >= ch && y ? px[row - stride + x - ch] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = (raw[src + x] + p) & 0xff;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, o = i * 4;
    if (ctype === 6) { data.set(px.subarray(s, s + 4), o); continue; }
    if (ctype === 2) { data.set(px.subarray(s, s + 3), o); data[o + 3] = 255; continue; }
    if (ctype === 0 || ctype === 4) { data[o] = data[o + 1] = data[o + 2] = px[s]; data[o + 3] = ctype === 4 ? px[s + 1] : 255; continue; }
    const k = px[s]; // palette
    data[o] = palette[k * 3]; data[o + 1] = palette[k * 3 + 1]; data[o + 2] = palette[k * 3 + 2];
    data[o + 3] = trns && k < trns.length ? trns[k] : 255;
  }
  return { width: w, height: h, data };
}

function encode({ width, height, data }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const chunk = (type, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), d]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hexRgb = hex => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.replace(/./g, c => c + c) : h.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
};

// size×size icon: opaque bg, coverage(x, y) ∈ [0,1] of fg colour or sample(x, y) → [r,g,b,a]; 4×4 supersampling.
function render(size, bg, sample) {
  const out = new Uint8Array(size * size * 4), S = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = sample((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
      const a = c[3] / 255;
      r += c[0] * a + bg[0] * (1 - a); g += c[1] * a + bg[1] * (1 - a); b += c[2] * a + bg[2] * (1 - a);
    }
    const o = (y * size + x) * 4;
    out[o] = Math.round(r / (S * S)); out[o + 1] = Math.round(g / (S * S)); out[o + 2] = Math.round(b / (S * S)); out[o + 3] = 255;
  }
  return { width: size, height: size, data: out };
}

// Logo scaled to fit (with padding, as maskable-safe) on an opaque background (iOS shows transparency as black).
function iconFromImage(img, size, bgHex, pad = 0.12) {
  const bg = hexRgb(bgHex);
  const inner = 1 - 2 * pad, scale = Math.min(inner / img.width, inner / img.height);
  const w = img.width * scale, h = img.height * scale, ox = (1 - w) / 2, oy = (1 - h) / 2;
  return render(size, bg, (u, v) => {
    const x = Math.floor((u - ox) / scale), y = Math.floor((v - oy) / scale);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [0, 0, 0, 0];
    const o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  });
}

// Fallback when the theme has no PNG ring logo: a ring in fg on bg.
function ringIcon(size, bgHex, fgHex) {
  const bg = hexRgb(bgHex), fg = hexRgb(fgHex);
  return render(size, bg, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5);
    return d > 0.2 && d < 0.34 ? [...fg, 255] : [0, 0, 0, 0];
  });
}

module.exports = { decode, encode, iconFromImage, ringIcon, crc32 };
