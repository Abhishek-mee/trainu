#!/usr/bin/env node
/**
 * Generate Trainu's PNG app icons without any dependencies.
 * Usage: node scripts/make-icons.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = path.join(ROOT, 'public', 'icons');
const SUPERSAMPLE = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuffer, data]);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  body.copy(output, 4);
  output.writeUInt32BE(crc32(body), 8 + data.length);
  return output;
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function blend(pixels, offset, red, green, blue, alpha) {
  if (alpha <= 0) return;
  const inverse = 1 - alpha;
  pixels[offset] = Math.round(pixels[offset] * inverse + red * alpha);
  pixels[offset + 1] = Math.round(pixels[offset + 1] * inverse + green * alpha);
  pixels[offset + 2] = Math.round(pixels[offset + 2] * inverse + blue * alpha);
  pixels[offset + 3] = 255;
}

function insideTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function radial(pixels, offset, x, y, centerX, centerY, radius, red, green, blue, strength) {
  const distance = Math.hypot(x - centerX, y - centerY) / radius;
  if (distance >= 1) return;
  const falloff = (1 - distance) ** 2 * strength;
  blend(pixels, offset, red, green, blue, falloff);
}

function render(size, { maskable = false } = {}) {
  const large = size * SUPERSAMPLE;
  const canvas = new Uint8Array(large * large * 4);

  // Background: pure black with a faint red halo behind the play mark.
  for (let y = 0; y < large; y += 1) {
    const vy = (y + 0.5) / large;
    for (let x = 0; x < large; x += 1) {
      const vx = (x + 0.5) / large;
      const offset = (y * large + x) * 4;
      canvas[offset] = 0;
      canvas[offset + 1] = 0;
      canvas[offset + 2] = 0;
      canvas[offset + 3] = 255;
      radial(canvas, offset, vx, vy, 0.46, 0.4, 0.72, 229, 9, 20, 0.18);
    }
  }

  const scale = maskable ? 0.86 : 1;
  const centerX = 0.5;
  const centerY = 0.5;
  const point = (x, y) => [centerX + (x - centerX) * scale, centerY + (y - centerY) * scale];
  const top = point(0.355, 0.265);
  const bottom = point(0.355, 0.735);
  const tip = point(0.75, 0.5);

  // A soft drop shadow, then the red play mark itself.
  for (let y = 0; y < large; y += 1) {
    const vy = (y + 0.5) / large;
    for (let x = 0; x < large; x += 1) {
      const vx = (x + 0.5) / large;
      const offset = (y * large + x) * 4;
      if (insideTriangle(vx, vy - 0.012, top[0], top[1], bottom[0], bottom[1], tip[0], tip[1])) {
        blend(canvas, offset, 0, 0, 0, 0.4);
      }
      if (insideTriangle(vx, vy, top[0], top[1], bottom[0], bottom[1], tip[0], tip[1])) {
        const t = Math.min(1, Math.max(0, (vx - top[0]) / (tip[0] - top[0])));
        const red = mix(255, 178, t);
        const green = mix(43, 7, t);
        const blue = mix(43, 16, t);
        canvas[offset] = Math.round(red);
        canvas[offset + 1] = Math.round(green);
        canvas[offset + 2] = Math.round(blue);
        canvas[offset + 3] = 255;
      }
    }
  }

  // Box-filter down to the final icon.
  const output = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const source = ((y * SUPERSAMPLE + sy) * large + (x * SUPERSAMPLE + sx)) * 4;
          red += canvas[source];
          green += canvas[source + 1];
          blue += canvas[source + 2];
          alpha += canvas[source + 3];
        }
      }
      const target = (y * size + x) * 4;
      output[target] = Math.round(red / samples);
      output[target + 1] = Math.round(green / samples);
      output[target + 2] = Math.round(blue / samples);
      output[target + 3] = Math.round(alpha / samples);
    }
  }

  return encodePng(size, size, output);
}

const ICONS = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['icon-180.png', 180, false],
];

await fs.mkdir(OUT_DIR, { recursive: true });
for (const [name, size, maskable] of ICONS) {
  const png = render(size, { maskable });
  await fs.writeFile(path.join(OUT_DIR, name), png);
  process.stdout.write(`Wrote public/icons/${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)\n`);
}
