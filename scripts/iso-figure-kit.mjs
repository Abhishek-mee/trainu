// A small two-point isometric drawing kit for the panel figure.
// This is a build-time helper only; the app ships the generated SVG.

const COS = 0.8660254038;
const SIN = 0.5;

export const C = {
  deskTop: '#212228',
  deskFront: '#191a1f',
  deskRight: '#131419',
  deskEdge: '#464851',
  deskGrain: '#383a42',
  mat: '#111116',
  matEdge: '#3b3d45',
  shellTop: '#292a30',
  shellFront: '#1e1f25',
  shellRight: '#16171c',
  shellEdge: '#565964',
  keyTop: '#32343b',
  keyFront: '#23242a',
  keyEdge: '#474952',
  well: '#0d0d11',
  glass: '#06060a',
  bezel: '#09090d',
  brass: '#777b88',
  brassHi: '#d7dae0',
  brassLo: '#464851',
  cable: '#121217',
  cableHi: '#42444d',
  accent: '#ffffff',
  accentHi: '#eef0f3',
  cream: '#f5f6f7',
  muted: '#858a98',
};

export function figure() {
  const shapes = [];
  const tracked = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  function track(x, y) {
    if (x < tracked.minX) tracked.minX = x;
    if (y < tracked.minY) tracked.minY = y;
    if (x > tracked.maxX) tracked.maxX = x;
    if (y > tracked.maxY) tracked.maxY = y;
  }

  function raw(x, y, z) {
    return [(x - y) * COS, (x + y) * SIN - z];
  }

  function at(x, y, z) {
    const [px, py] = raw(x, y, z);
    track(px, py);
    return [px, py];
  }

  function f(value) {
    return String(Math.round(value * 10) / 10);
  }

  function pos(x, y, z) {
    return `${f(raw(x, y, z)[0])} ${f(raw(x, y, z)[1])}`;
  }

  function poly(points, fill, attrs = '') {
    const projected = points.map(([x, y, z]) => at(x, y, z));
    const d = projected.map(([x, y], index) => `${index ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + ' Z';
    shapes.push(`<path d="${d}" fill="${fill}"${attrs ? ` ${attrs}` : ''}/>`);
    return d;
  }

  function line(a, b, stroke, width = 0.7, attrs = '') {
    const [x1, y1] = at(...a);
    const [x2, y2] = at(...b);
    shapes.push(`<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"${attrs ? ` ${attrs}` : ''}/>`);
  }

  function box(x, y, z, w, d, h, tones) {
    const front = tones.front ?? C.shellFront;
    const right = tones.right ?? C.shellRight;
    const top = tones.top ?? C.shellTop;
    poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], front);
    poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], right);
    poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], top);
    if (tones.edge) {
      line([x, y + d, z + h], [x + w, y + d, z + h], tones.edge, 0.55, 'opacity=".55"');
      line([x + w, y + d, z + h], [x + w, y + d, z], tones.edge, 0.45, 'opacity=".3"');
    }
  }

  function slab(points, z, thickness, tones) {
    const visible = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      if (dy - dx > 0.0001) visible.push([a, b, dy >= dx]);
    }
    for (const [a, b, isFront] of visible) {
      poly([[a[0], a[1], z], [b[0], b[1], z], [b[0], b[1], z - thickness], [a[0], a[1], z - thickness]],
        isFront ? (tones.front ?? C.deskFront) : (tones.right ?? C.deskRight));
    }
    const top = poly(points.map(([x, y]) => [x, y, z]), tones.top, tones.topAttrs ?? '');
    if (tones.edge) {
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        line([a[0], a[1], z], [b[0], b[1], z], tones.edge, 0.55, 'opacity=".35"');
      }
    }
    return top;
  }

  function outline(points, z, stroke, width = 0.7, attrs = '') {
    const projected = points.map(([x, y]) => at(x, y, z));
    const d = projected.map(([x, y], index) => `${index ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ');
    shapes.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"${attrs ? ` ${attrs}` : ''}/>`);
  }

  function disc(cx, cy, z, r, fill, attrs = '') {
    const [X, Y] = at(cx, cy, z);
    for (let i = 0; i < 8; i += 1) {
      at(cx + r * Math.cos((i * Math.PI) / 4), cy + r * Math.sin((i * Math.PI) / 4), z);
    }
    const rx = r * 1.2247448714;
    const ry = r * 0.7071067812;
    shapes.push(`<ellipse cx="${f(X)}" cy="${f(Y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}"${attrs ? ` ${attrs}` : ''}/>`);
    return [X, Y, rx, ry];
  }

  function band(cx, cy, z0, z1, r, fill, attrs = '') {
    const [X1, Y1] = at(cx, cy, z1);
    const [X0, Y0] = at(cx, cy, z0);
    for (let i = 0; i < 8; i += 1) {
      const px = cx + r * Math.cos((i * Math.PI) / 4);
      const py = cy + r * Math.sin((i * Math.PI) / 4);
      at(px, py, z0);
      at(px, py, z1);
    }
    const rx = r * 1.2247448714;
    const ry = r * 0.7071067812;
    const d = `M${f(X1 - rx)} ${f(Y1)}A${f(rx)} ${f(ry)} 0 0 0 ${f(X1 + rx)} ${f(Y1)}L${f(X0 + rx)} ${f(Y0)}A${f(rx)} ${f(ry)} 0 0 1 ${f(X0 - rx)} ${f(Y0)}Z`;
    shapes.push(`<path d="${d}" fill="${fill}"${attrs ? ` ${attrs}` : ''}/>`);
  }

  function bezierD(start, segments) {
    let d = `M${pos(...start)}`;
    for (const segment of segments) {
      d += `C${pos(...segment.c1)} ${pos(...segment.c2)} ${pos(...segment.end)}`;
    }
    return d;
  }

  function bezier(start, segments, stroke, width, attrs = '') {
    const d = bezierD(start, segments);
    shapes.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${attrs ? ` ${attrs}` : ''}/>`);
    return d;
  }

  function plane(x, y, zTop, inner) {
    const [tx, ty] = at(x, y, zTop);
    return `<g transform="matrix(${COS} 0.5 0 1 ${f(tx)} ${f(ty)})">${inner}</g>`;
  }

  function push(html) {
    shapes.push(html);
  }

  function render({ pad = 26, defs = '', backdrop = '' } = {}) {
    const width = tracked.maxX - tracked.minX + pad * 2;
    const height = tracked.maxY - tracked.minY + pad * 2;
    const tx = pad - tracked.minX;
    const ty = pad - tracked.minY;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" role="img">
<title>Private film library on a laptop, linked to one phone</title>
<desc>An isometric screening desk. A laptop holds a library of films behind a lock; a single white title travels down a cable to the phone, which shows one film. Film cans and a padlock sit on the desk.</desc>
<defs>${defs}</defs>
${backdrop}
<g transform="translate(${f(tx)} ${f(ty)})">
${shapes.join('\n')}
</g>
</svg>
`;
  }

  return { at, raw, pos, poly, line, box, slab, outline, disc, band, bezier, bezierD, plane, render, C, push };
}
