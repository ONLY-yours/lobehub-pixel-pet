'use strict';
// Generates build/icon.png (1024x1024): the three starter eggs on a rounded card.
// Pure Node (zlib), no image dependencies. electron-builder converts it to .icns on macOS.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const S = require('../src/renderer/sprites');
const { SPECIES } = require('../src/core/species');

const SIZE = 1024;
const px = Buffer.alloc(SIZE * SIZE * 4); // transparent

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const set = (x, y, rgb) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
};

// rounded card with a dark pixel border
const R = 230;
const B = 18;
const inRound = (x, y, inset) => {
  const lo = inset, hi = SIZE - 1 - inset;
  if (x < lo || y < lo || x > hi || y > hi) return false;
  const cx = x < lo + R ? lo + R : x > hi - R ? hi - R : x;
  const cy = y < lo + R ? lo + R : y > hi - R ? hi - R : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= (R - 0) ** 2;
};
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  if (inRound(x, y, 0)) set(x, y, inRound(x, y, B) ? hex('#f4efe6') : hex('#2b2233'));
}

// three eggs, cropped to the egg's bounding box so they fill the card
const grid0 = S.egg(0);
let minX = 99, maxX = -1, minY = 99, maxY = -1;
grid0.forEach((row, j) => row.forEach((k, i) => { if (k !== '.') { minX = Math.min(minX, i); maxX = Math.max(maxX, i); minY = Math.min(minY, j); maxY = Math.max(maxY, j); } }));
const bw = maxX - minX + 1, bh = maxY - minY + 1;
const scale = 17, gap = 44;
const order = ['embit', 'bubbo', 'sprig'];
const total = order.length * bw * scale + (order.length - 1) * gap;
let ox = Math.round((SIZE - total) / 2);
const oy = Math.round((SIZE - bh * scale) / 2);
for (const id of order) {
  const pal = S.EGG_PAL(SPECIES[id].egg);
  grid0.forEach((row, j) => row.forEach((k, i) => {
    if (k === '.') return;
    const col = pal[k] || S.COMMON[k];
    if (!col) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) set(ox + (i - minX) * scale + dx, oy + (j - minY) * scale + dy, hex(col));
  }));
  ox += bw * scale + gap;
}

// PNG encode
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) { raw[y * (SIZE * 4 + 1)] = 0; px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
