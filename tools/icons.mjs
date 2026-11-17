// Generates the app icons (SVG + PNG) with no dependencies: signed-distance shapes + a tiny PNG encoder.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const A = [0x1b, 0x7a, 0x5f], B = [0x0c, 0x45, 0x35];            // gradient green
const clamp = x => Math.max(0, Math.min(1, x));
const len = (x, y) => Math.hypot(x, y);
const circle = (x, y, cx, cy, r) => len(x - cx, y - cy) - r;
function box(x, y, cx, cy, hx, hy) { const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy; return len(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0); }
function rbox(x, y, r) { return box(x, y, .5, .5, .5 - r, .5 - r) - r; }
// arch (mihrab) and crescent, in a 0..1 square
const arch = (x, y) => Math.min(box(x, y, .5, .63, .2, .17), circle(x, y, .5, .46, .2));
const crescent = (x, y) => Math.max(circle(x, y, .5, .5, .1), -circle(x, y, .548, .472, .086));

function render(size, { maskable = false, badge = false } = {}) {
  const px = new Uint8Array(size * size * 4), aa = 1 / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let x = (i + .5) / size, y = (j + .5) / size;
    const o = (j * size + i) * 4;
    const bgA = badge ? 0 : maskable ? 1 : clamp(.5 - rbox(x, y, .22) / aa);
    if (maskable) { x = .5 + (x - .5) / .8; y = .5 + (y - .5) / .8; }        // keep inside safe zone
    const s = badge ? 1.25 : 1; const X = .5 + (x - .5) / s, Y = .5 + (y - .5) / s;
    const archA = clamp(.5 - arch(X, Y) / (aa / s)), cresA = clamp(.5 - crescent(X, Y) / (aa / s));
    const t = clamp((x + y) / 2);
    let r = A[0] + (B[0] - A[0]) * t, g = A[1] + (B[1] - A[1]) * t, b = A[2] + (B[2] - A[2]) * t;
    if (badge) {
      const a = archA * (1 - cresA);
      px.set([255, 255, 255, Math.round(a * 255)], o); continue;
    }
    // arch: warm white; crescent: gold
    const fa = archA * (1 - cresA), ca = archA * cresA;
    r = r * (1 - fa) + 246 * fa; g = g * (1 - fa) + 243 * fa; b = b * (1 - fa) + 232 * fa;
    r = r * (1 - ca) + 0xc9 * ca; g = g * (1 - ca) + 0xa4 * ca; b = b * (1 - ca) + 0x5c * ca;
    px.set([Math.round(r), Math.round(g), Math.round(b), Math.round(bgA * 255)], o);
  }
  return png(size, px);
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(data.length); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const w = (n, b) => writeFileSync(new URL(n, OUT), b);
w('icon-192.png', render(192));
w('icon-512.png', render(512));
w('maskable-512.png', render(512, { maskable: true }));
w('apple-touch-icon.png', render(180, { maskable: true }));
w('badge-96.png', render(96, { badge: true }));
w('icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b7a5f"/><stop offset="1" stop-color="#0c4535"/></linearGradient><mask id="m"><rect width="100" height="100" fill="#fff"/><circle cx="50" cy="50" r="10" fill="#000"/></mask><mask id="c"><circle cx="50" cy="50" r="10" fill="#fff"/><circle cx="54.8" cy="47.2" r="8.6" fill="#000"/></mask></defs><rect width="100" height="100" rx="22" fill="url(#g)"/><path d="M30 80V46a20 20 0 0 1 40 0v34z" fill="#f6f3e8" mask="url(#m)"/><rect x="38" y="38" width="24" height="24" fill="#c9a45c" mask="url(#c)"/></svg>`);
console.log('icons written');
