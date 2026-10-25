#!/usr/bin/env node
/**
 * Build the isometric "screening desk" figure used on the laptop panel.
 * Usage: node scripts/make-signal-figure.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { figure, C } from './iso-figure-kit.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'public', 'iso-local-link.svg');
const F = figure();
const { poly, line, box, slab, outline, disc, band, bezier, bezierD, plane, push } = F;

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

const defsExtra = `
<filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="11"/></filter>
<filter id="tight" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2"/></filter>
<filter id="glow" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="4.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="cylDark" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#2f3037"/><stop offset=".42" stop-color="#1b1c22"/><stop offset="1" stop-color="#0b0b0f"/>
</linearGradient>
<linearGradient id="cylBrass" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#d7dae0"/><stop offset=".45" stop-color="#6e717d"/><stop offset="1" stop-color="#34363d"/>
</linearGradient>
<linearGradient id="lapGlass" x1="0" y1="0" x2=".9" y2="1">
  <stop offset="0" stop-color="#111116"/><stop offset=".55" stop-color="#08080c"/><stop offset="1" stop-color="#040407"/>
</linearGradient>
<linearGradient id="phoneSky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#292a31"/><stop offset=".45" stop-color="#555862"/><stop offset=".72" stop-color="#9297a6"/><stop offset="1" stop-color="#e8eaee"/>
</linearGradient>
<linearGradient id="phoneWater" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#6a6d79"/><stop offset=".35" stop-color="#33343c"/><stop offset="1" stop-color="#0e0f13"/>
</linearGradient>
<linearGradient id="phoneScrim" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#040407" stop-opacity="0"/><stop offset=".55" stop-color="#040407" stop-opacity=".72"/><stop offset="1" stop-color="#040407" stop-opacity=".96"/>
</linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#f5f6f7" stop-opacity=".075"/><stop offset=".45" stop-color="#f5f6f7" stop-opacity="0"/>
</linearGradient>
<radialGradient id="ember" cx="50%" cy="50%" r="50%">
  <stop offset="0" stop-color="#ffffff" stop-opacity=".26"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
</radialGradient>
<clipPath id="deskClip"><path d="" id="deskClipPath"/></clipPath>
`;

/* ------------------------------------------------------------------ */
/* Desk                                                                */
/* ------------------------------------------------------------------ */

const DESK = [
  [-288, -200], [288, -200], [300, -188], [300, 188],
  [288, 200], [-288, 200], [-300, 188], [-300, -188],
];

poly(DESK.map(([x, y]) => [x + 9, y + 14, -18]), '#000000', 'opacity=".5" filter="url(#soft)"');
disc(0, 0, -29, 300, 'url(#ember)', 'opacity=".55"');
const deskTop = slab(DESK, 0, 18, {
  top: C.deskTop,
  front: C.deskFront,
  right: C.deskRight,
  edge: C.deskEdge,
});

// Stitching inset and grain live on the desktop only.
const INSET = [
  [-278, -190], [278, -190], [289, -179], [289, 179],
  [278, 190], [-278, 190], [-289, 179], [-289, -179],
];
outline(INSET, 0.15, '#5e616c', 0.7, 'opacity=".18"');

const grain = [];
for (let i = 0; i < 7; i += 1) {
  const y = -160 + i * 46;
  const d = bezierD([-282, y, 0.2], [
    { c1: [-120, y - 10, 0.2], c2: [60, y + 9, 0.2], end: [282, y + 2, 0.2] },
  ]);
  grain.push(`<path d="${d}" fill="none" stroke="${C.deskGrain}" stroke-width="${i % 3 === 0 ? 1.1 : 0.7}" opacity="${i % 3 === 0 ? '.5' : '.32'}"/>`);
}
push(`<g clip-path="url(#deskClip)">${grain.join('')}</g>`);

for (const [x, y] of [[-268, -172], [268, -172], [268, 172], [-268, 172]]) {
  disc(x, y, 0.25, 2.6, '#15151a');
  disc(x, y, 0.35, 2.1, '#6a6d79');
  line([x - 1.3, y, 0.45], [x + 1.3, y, 0.45], '#1e1f24', 0.55);
}

/* ------------------------------------------------------------------ */
/* Film cans                                                           */
/* ------------------------------------------------------------------ */

function filmCan(cx, cy, radius, height) {
  disc(cx + 6, cy + 10, 0.3, radius * 1.05, '#000000', 'opacity=".4" filter="url(#tight)"');
  band(cx, cy, 0.4, height, radius, 'url(#cylDark)');
  band(cx, cy, height, height + 3, radius + 1.5, 'url(#cylBrass)');
  disc(cx, cy, height + 3, radius + 1.5, '#25262d', `stroke="${C.brassLo}" stroke-width=".7" stroke-opacity=".8"`);
  disc(cx, cy, height + 3.2, radius - 4.5, 'none', 'stroke="#5d606b" stroke-width=".7" stroke-opacity=".55"');
  disc(cx, cy, height + 3.4, radius - 9, 'none', 'stroke="#454750" stroke-width=".5" stroke-opacity=".4"');
  band(cx, cy, height + 3, height + 5.5, 6.5, '#595b66');
  disc(cx, cy, height + 5.5, 6.5, '#717582', 'stroke="#d7dae0" stroke-width=".5" stroke-opacity=".5"');
  disc(cx, cy, height + 5.7, 2.2, '#1a1b20');
  // Latch on the near rim.
  box(cx - 3.5, cy + radius - 1, height + 1.5, 7, 4, 3.2, {
    top: '#878c9a', front: '#555862', right: '#3d3f48', edge: C.brassHi,
  });
}

filmCan(-228, 92, 27, 20);
filmCan(-176, 130, 23, 16);

/* ------------------------------------------------------------------ */
/* Padlock                                                             */
/* ------------------------------------------------------------------ */

function drawPadlock() {
  disc(-100, 150, 0.3, 27, '#000000', 'opacity=".42" filter="url(#tight)"');
  const shackle = [
    { c1: [-111, 148, 42], c2: [-111, 148, 51], end: [-99, 148, 51] },
    { c1: [-87, 148, 51], c2: [-87, 148, 42], end: [-87, 148, 21] },
  ];
  bezier([-111, 148, 21], shackle, '#4e515a', 7);
  bezier([-111.3, 147.6, 21], shackle, '#d7dae0', 2.2, 'opacity=".5"');
  bezier([-111.6, 147.2, 21], shackle, '#d5dcf1', 0.7, 'opacity=".35"');
  box(-119, 138, 1, 38, 20, 20, {
    top: '#969bab', front: '#626571', right: '#41434b', edge: C.brassHi,
  });
  // Etched face plate with a keyhole.
  poly([[-112, 158.1, 4], [-88, 158.1, 4], [-88, 158.1, 17], [-112, 158.1, 17]], '#585b66', `stroke="${C.brassHi}" stroke-width=".45" stroke-opacity=".55"`);
  push(plane(-100, 158.25, 15.4, `
    <circle cx="0" cy="2.6" r="2.8" fill="#131418"/>
    <path d="M-1.3 4.4h2.6l1.5 4.6h-5.6z" fill="#131418"/>
    <circle cx="0" cy="2.6" r="2.8" fill="none" stroke="#d5dcf1" stroke-width=".35" stroke-opacity=".35"/>
  `));
  push(plane(-114, 158.25, 16, `<circle cx="4" cy="2.5" r="1" fill="#1c1d23" opacity=".8"/><circle cx="24" cy="2.5" r="1" fill="#1c1d23" opacity=".8"/>`));
}

/* ------------------------------------------------------------------ */
/* Desk plaque                                                         */
/* ------------------------------------------------------------------ */

box(112, 199, -13, 108, 3, 8, {
  top: '#8c91a0', front: '#545661', right: '#36383f', edge: C.brassHi,
});
push(plane(166, 202.4, -5.6, `<text x="0" y="6.6" text-anchor="middle" font-family="Consolas, monospace" font-size="6.6" font-weight="700" letter-spacing="2" fill="#1a1b20">TRAINU</text>`));

/* ------------------------------------------------------------------ */
/* Laptop                                                              */
/* ------------------------------------------------------------------ */

const MAT = [
  [-172, -146], [172, -146], [178, -140], [178, 116],
  [172, 122], [-172, 122], [-178, 116], [-178, -140],
];
poly(MAT.map(([x, y]) => [x + 4, y + 7, 2.6]), '#000000', 'opacity=".45" filter="url(#tight)"');
slab(MAT, 2.5, 2.5, {
  top: '#101015', front: '#0b0b0f', right: '#08080c', edge: '#454850',
});
outline([[-164, -138], [164, -138], [169, -133], [169, 108], [164, 113], [-164, 113], [-169, 108], [-169, -133]], 2.7, '#5e616c', 0.6, 'opacity=".22" stroke-dasharray="3 3"');

const BASE = [
  [-144, -120], [144, -120], [150, -114], [150, 94],
  [144, 100], [-144, 100], [-150, 94], [-150, -114],
];
slab(BASE, 18.5, 16, {
  top: C.shellTop, front: C.shellFront, right: C.shellRight, edge: C.shellEdge,
});

// Keyboard recess, keys, trackpad, speaker holes.
poly([[-130, -110, 18.52], [130, -110, 18.52], [130, -24, 18.52], [-130, -24, 18.52]], C.well);
outline([[-130, -110], [130, -110], [130, -24], [-130, -24]], 18.56, '#454750', 0.6, 'opacity=".35"');

for (let row = 0; row < 4; row += 1) {
  const y = -105 + row * 16.5;
  for (let col = 0; col < 12; col += 1) {
    const x = -119 + col * 20.2;
    box(x, y, 18.55, 17, 12, 1.35, {
      top: C.keyTop, front: C.keyFront, right: C.keyFront, edge: C.keyEdge,
    });
  }
}
box(-58, -38, 18.55, 116, 11, 1.5, {
  top: C.keyTop, front: C.keyFront, right: C.keyFront, edge: C.keyEdge,
});
line([-112, -43.5, 20.1], [112, -43.5, 20.1], '#191a1f', 0.5, 'opacity=".55"');

poly([[-40, -8, 18.58], [40, -8, 18.58], [40, 34, 18.58], [-40, 34, 18.58]], '#141419');
poly([[-36, -4, 18.7], [36, -4, 18.7], [36, 30, 18.7], [-36, 30, 18.7]], '#0c0c10', `stroke="#494b54" stroke-width=".5" stroke-opacity=".45"`);

for (const side of [-1, 1]) {
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      disc(side * (103 + col * 8), -16 + row * 15, 18.62, 0.85, '#0e0e12');
    }
  }
}

// Debossed mark on the palm rest.
push(plane(-132, 76, 18.64, `
  <rect x="0" y="0" width="4.2" height="4.2" fill="#ffffff" opacity=".9"/>
  <text x="8" y="3.4" font-family="Consolas, monospace" font-size="4.4" font-weight="700" letter-spacing="1.7" fill="#626671">TRAINU</text>
  <text x="8" y="8.2" font-family="Consolas, monospace" font-size="2.4" letter-spacing=".8" fill="#4b4d57">PRIVATE SCREENING</text>
`));

// Front seam, power lamp and right-side ports.
line([-140, 100.15, 15.4], [140, 100.15, 15.4], C.shellEdge, 0.6, 'opacity=".3"');
push(plane(124, 100.3, 14.8, '<circle cx="2" cy="1.5" r="1.1" fill="#ffffff"/>'));
const portFace = (y0, y1, z0, z1, fill) => poly(
  [[150.15, y0, z1], [150.15, y1, z1], [150.15, y1, z0], [150.15, y0, z0]], fill,
);
portFace(-62, -51, 9, 14, '#07070b');
portFace(-61, -52, 10, 13, '#1a1b20');
portFace(-42, -27, 9, 14, '#07070b');
portFace(-41, -28, 10, 13, '#202127');
for (let i = 0; i < 4; i += 1) portFace(-16 + i * 5, -13 + i * 5, 11, 14, '#101015');

// Hinge, lid and screen.
box(-106, -126, 12, 212, 11, 9, {
  top: '#2d2e35', front: '#1c1d23', right: '#121217', edge: C.shellEdge,
});
box(-114, -128, 11, 9, 15, 11, {
  top: C.brass, front: C.brassLo, right: '#2a2c32', edge: C.brassHi,
});
box(105, -128, 11, 9, 15, 11, {
  top: C.brass, front: C.brassLo, right: '#2a2c32', edge: C.brassHi,
});
box(-144, -132, 18.5, 288, 12, 161.5, {
  top: '#1c1d23', front: '#212228', right: '#121217', edge: C.shellEdge,
});
poly([[-138, -119.8, 26], [138, -119.8, 26], [138, -119.8, 173], [-138, -119.8, 173]], C.bezel);
poly([[-132, -119.65, 33], [132, -119.65, 33], [132, -119.65, 166], [-132, -119.65, 166]], C.glass, `stroke="#3b3d45" stroke-width=".5" stroke-opacity=".55"`);
push(plane(-3, -119.5, 172.5, '<circle cx="3" cy="1.4" r="1.2" fill="#08080c" stroke="#474952" stroke-width=".35"/><circle cx="2.6" cy="1.1" r=".35" fill="#808492"/>'));
push(plane(-29, -119.5, 31.8, '<text x="0" y="3.4" font-family="Consolas, monospace" font-size="4.2" font-weight="700" letter-spacing="1.5" fill="#6f737f">TRAINU</text>'));

const tileFills = ['#1e1f25', '#1a1b20', '#22242a', '#1d1e23', '#212228', '#1a1b20', '#1e1f25', '#1c1d22'];
const tileArt = [
  '<circle cx="35" cy="15" r="7" fill="#8b8f9e" opacity=".5"/><path d="M0 29h52v13H0z" fill="#0d0d11" opacity=".55"/>',
  '<path d="M0 30l18-13 14 9 11-7 9 6v17H0z" fill="#3c3e46" opacity=".65"/>',
  '<rect x="8" y="8" width="36" height="20" fill="#2a2b32"/><path d="M13 22l7-7 6 5 5-4 8 8z" fill="#777b88" opacity=".55"/>',
  '<circle cx="18" cy="16" r="8" fill="#454750" opacity=".7"/><rect x="31" y="7" width="12" height="24" fill="#2b2c32" opacity=".7"/>',
  '<path d="M0 28c10-7 20-7 30 0s14 6 22 2v12H0z" fill="#3c3e46" opacity=".7"/>',
  '<rect x="9" y="6" width="34" height="23" fill="#31333a"/><circle cx="26" cy="17" r="5" fill="#d7dae0" opacity=".35"/>',
  '<path d="M0 31l16-16 10 8 9-6 17 14v11H0z" fill="#474952" opacity=".55"/><circle cx="37" cy="12" r="5" fill="#afb4c6" opacity=".7"/>',
  '<rect x="7" y="8" width="38" height="25" fill="#2b2c33"/><path d="M12 13h28M12 19h18M12 25h24" stroke="#f5f6f7" stroke-opacity=".2" stroke-width="1.5"/>',
];
const tiles = [];
for (let index = 0; index < 8; index += 1) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const x = 22 + col * 59;
  const y = 22 + row * 48;
  const active = index === 6;
  tiles.push(`<g transform="translate(${x} ${y})">
    <rect width="52" height="42" rx="1.5" fill="${active ? '#1e1f25' : tileFills[index]}" stroke="${active ? C.accent : '#3b3d45'}" stroke-opacity="${active ? '1' : '.55'}" stroke-width="${active ? '1.4' : '.6'}"/>
    <g clip-path="url(#tileClip)">${tileArt[index]}</g>
    <rect x="0" y="33" width="52" height="9" fill="#06060a" opacity=".55"/>
    <rect x="4" y="37" width="${active ? 20 : 14 + index}" height="1.4" rx=".7" fill="${active ? C.accentHi : '#808492'}" opacity=".65"/>
    ${active ? '<path d="M23 16l9 5-9 5z" fill="#eef0f3"/>' : ''}
  </g>`);
}

const navIcons = [0, 1, 2].map((index) => `
  <g transform="translate(4 ${22 + index * 15})">
    <rect width="6" height="5" rx="1" fill="${index === 0 ? C.accent : '#6f737f'}" opacity="${index === 0 ? '.9' : '.34'}"/>
    <rect x="8" y="1.5" width="12" height="1.2" rx=".6" fill="#6f737f" opacity=".35"/>
  </g>`).join('');

const laptopScreen = `
  <rect width="264" height="133" fill="#06060a"/>
  <rect width="264" height="133" fill="url(#lapGlass)"/>
  <rect width="264" height="14" fill="#0a0a0e"/>
  <text x="7" y="9.7" font-family="Consolas, monospace" font-size="5.4" font-weight="700" letter-spacing="1.5" fill="#b3b8cb">LIBRARY</text>
  <g transform="translate(247 3.5)">
    <rect x="0" y="2" width="7" height="5.6" rx="1" fill="none" stroke="#d7dae0" stroke-width=".7"/>
    <path d="M1.6 2V1.1a1.9 1.9 0 0 1 3.8 0V2" fill="none" stroke="#d7dae0" stroke-width=".7"/>
  </g>
  <rect y="14" width="14" height="119" fill="#09090d"/>
  ${navIcons}
  <line x1="14" y1="14" x2="14" y2="133" stroke="#2f3138" stroke-opacity=".45" stroke-width=".5"/>
  ${tiles.join('')}
  <text x="22" y="130" font-family="Consolas, monospace" font-size="4" letter-spacing=".8" fill="#666a75">ON THIS LAPTOP</text>
  <text x="252" y="130" text-anchor="end" font-family="Consolas, monospace" font-size="4" letter-spacing=".8" fill="#666a75">LOCAL ONLY</text>
  <path d="M0 0H150L0 133Z" fill="url(#sheen)" opacity=".55"/>
`;

push(plane(-132, -119.5, 166, `<g clip-path="url(#laptopScreenClip)">${laptopScreen}</g>`));
drawPadlock();

const phoneScreenLocal = `
  <rect width="64" height="134" fill="#06060a"/>
  <rect x="1" y="1" width="62" height="132" fill="url(#phoneSky)"/>
  <circle cx="45" cy="34" r="11.5" fill="#f5f6f7" opacity=".92"/>
  <circle cx="45" cy="34" r="16" fill="#d7dae0" opacity=".16"/>
  <path d="M1 68c11-8 18-4 26 1s14 5 22-2 12-5 13-3v24H1z" fill="#303239"/>
  <path d="M1 81c12-5 22-3 32 3s19 5 29 0v11H1z" fill="#1f2026"/>
  <rect y="92" width="64" height="42" fill="url(#phoneWater)"/>
  <path d="M1 99c11 3 19-1 30 2s21 5 32 1v4c-11 4-21 0-32-1s-19 1-30-2z" fill="#a4aabb" opacity=".25"/>
  <rect y="86" width="64" height="48" fill="url(#phoneScrim)"/>
  <circle cx="32" cy="64" r="12" fill="#07070b" opacity=".55" stroke="#f5f6f7" stroke-opacity=".5" stroke-width=".8"/>
  <path d="M28.4 58.6v11.4l9.6-5.7z" fill="#f5f6f7"/>
  <text x="5" y="102" font-family="Inter, Segoe UI, sans-serif" font-size="8.4" fill="#f5f6f7">Monsoon</text>
  <text x="5" y="111" font-family="Inter, Segoe UI, sans-serif" font-size="8.4" fill="#f5f6f7">Letters</text>
  <text x="5" y="117.4" font-family="Consolas, monospace" font-size="3.6" letter-spacing=".2" fill="#9da2b2">12:04 / 2:01:33</text>
  <rect x="5" y="121" width="54" height="1.9" rx=".95" fill="#f5f6f7" opacity=".18"/>
  <rect x="5" y="121" width="18" height="1.9" rx=".95" fill="${C.accent}"/>
  <rect x="23" y="2" width="18" height="4" rx="2" fill="#040407"/>
  <rect x="24.5" y="126" width="15" height="1.4" rx=".7" fill="#f5f6f7" opacity=".45"/>
  <path d="M0 0H43L0 134Z" fill="url(#sheen)" opacity=".5"/>
`;

/* ------------------------------------------------------------------ */
/* Phone on its stand                                                  */
/* ------------------------------------------------------------------ */

const STAND = [
  [172, 18], [258, 18], [264, 24], [264, 126],
  [258, 132], [172, 132], [166, 126], [166, 24],
];
poly(STAND.map(([x, y]) => [x + 4, y + 7, 10.2]), '#000000', 'opacity=".45" filter="url(#tight)"');
slab(STAND, 10, 10, {
  top: '#202127', front: '#191a1f', right: '#121217', edge: C.shellEdge,
});
outline([[177, 23], [253, 23], [258, 28], [258, 121], [253, 126], [177, 126], [171, 121], [171, 28]], 10.2, '#676b77', 0.55, 'opacity=".35"');
for (const [x, y] of [[177, 29], [253, 29], [177, 110], [253, 110]]) {
  disc(x, y, 10.3, 1.6, '#676b77');
  line([x - 0.8, y, 10.45], [x + 0.8, y, 10.45], '#1c1d23', 0.4);
}

box(180, 24, 10, 70, 12, 32, {
  top: '#27282e', front: '#1a1b20', right: '#121217', edge: C.shellEdge,
});
poly([[182, 36.15, 13], [248, 36.15, 13], [248, 36.15, 40], [182, 36.15, 40]], '#111116');
for (const [x, width] of [[168, 24], [238, 24]]) {
  box(x, 50, 10, width, 12, 13, {
    top: '#2a2c32', front: '#1b1c22', right: '#131318', edge: C.shellEdge,
  });
  line([x + 3, 62.15, 20.5], [x + width - 3, 62.15, 20.5], C.brassHi, 0.5, 'opacity=".4"');
}

box(178, 36, 10, 74, 12, 156, {
  top: '#2f3037', front: '#212228', right: '#15151a', edge: C.shellEdge,
});
poly([[183, 48.15, 24], [247, 48.15, 24], [247, 48.15, 158], [183, 48.15, 158]], '#0a0a0e');
push(plane(183, 48.3, 158, `<g clip-path="url(#phoneScreenClip)">${phoneScreenLocal}</g>`));
box(252.2, 40, 146, 1.4, 5, 14, {
  top: C.brass, front: C.brassLo, right: '#2a2c32', edge: C.brassHi,
});
for (const z of [126, 140]) {
  box(176.6, 40, z, 1.4, 5, 10, {
    top: C.brass, front: C.brassLo, right: '#2a2c32', edge: C.brassHi,
  });
}

/* ------------------------------------------------------------------ */
/* The local link                                                      */
/* ------------------------------------------------------------------ */

const cableSegments = [
  { c1: [170, -50, 12], c2: [178, -40, 6], end: [190, -18, 3.2] },
  { c1: [202, 4, 3.2], c2: [214, 30, 3.2], end: [226, 58, 3.2] },
  { c1: [238, 86, 3.2], c2: [242, 112, 3.2], end: [244, 132, 3.2] },
  { c1: [246, 148, 3.2], c2: [256, 154, 3.2], end: [262, 146, 3.4] },
  { c1: [268, 138, 3.8], c2: [264, 130, 6], end: [254, 124, 10.6] },
  { c1: [244, 118, 11], c2: [230, 112, 11], end: [220, 96, 11] },
  { c1: [214, 84, 11], c2: [216, 58, 11], end: [216, 44, 12] },
];
const cablePath = bezierD([156, -50, 12], cableSegments);
push(`<path d="${cablePath}" transform="translate(5 8)" fill="none" stroke="#000000" stroke-width="5.4" stroke-linecap="round" opacity=".45" filter="url(#tight)"/>`);
push(`<path d="${cablePath}" fill="none" stroke="${C.cable}" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>`);
push(`<path d="${cablePath}" fill="none" stroke="${C.cableHi}" stroke-width="1.15" stroke-linecap="round" opacity=".6"/>`);
push(`<path d="${cablePath}" fill="none" stroke="#676b77" stroke-width=".5" stroke-linecap="round" opacity=".22" stroke-dasharray="1.4 7"/>`);

// Connector shells cover the cable ends.
box(148, -56, 8, 13, 12, 8, {
  top: C.brass, front: '#202127', right: '#121217', edge: C.brassHi,
});
box(158, -53, 9.5, 7, 6, 5, {
  top: '#393b43', front: '#1b1c22', right: '#101015', edge: C.shellEdge,
});
box(211.5, 42, 10, 9, 9, 6, {
  top: C.brass, front: '#202127', right: '#121217', edge: C.brassHi,
});
box(212.5, 50, 11, 7, 7, 4, {
  top: '#393b43', front: '#1b1c22', right: '#101015', edge: C.shellEdge,
});

// One amber frame travelling along the cable.
const SEG = { p0: [226, 58, 3.2], c1: [238, 86, 3.2], c2: [242, 112, 3.2], p1: [244, 132, 3.2] };
function cubicPoint(t) {
  const u = 1 - t;
  return [0, 1, 2].map((axis) => (
    u * u * u * SEG.p0[axis]
    + 3 * u * u * t * SEG.c1[axis]
    + 3 * u * t * t * SEG.c2[axis]
    + t * t * t * SEG.p1[axis]
  ));
}
function cubicTangent(t) {
  const u = 1 - t;
  return [0, 1, 2].map((axis) => (
    3 * u * u * (SEG.c1[axis] - SEG.p0[axis])
    + 6 * u * t * (SEG.c2[axis] - SEG.c1[axis])
    + 3 * t * t * (SEG.p1[axis] - SEG.c2[axis])
  ));
}
function screenPoint(world) {
  return F.raw(world[0], world[1], world[2]);
}
const frameAt = 0.46;
const frameWorld = cubicPoint(frameAt);
const frameScreen = screenPoint(frameWorld);
const tangentScreen = screenPoint(cubicTangent(frameAt).map((v, i) => frameWorld[i] + v));
const angle = (Math.atan2(tangentScreen[1] - frameScreen[1], tangentScreen[0] - frameScreen[0]) * 180) / Math.PI;

for (const [t, radius, opacity] of [[0.3, 2.4, 0.24], [0.2, 1.7, 0.12]]) {
  const point = screenPoint(cubicPoint(t));
  push(`<circle cx="${point[0]}" cy="${point[1]}" r="${radius}" fill="${C.accent}" opacity="${opacity}"/>`);
}
push(`<g transform="translate(${Math.round(frameScreen[0] * 10) / 10} ${Math.round(frameScreen[1] * 10) / 10}) rotate(${Math.round(angle * 10) / 10})">
  <circle cx="0" cy="0" r="15" fill="url(#ember)" filter="url(#glow)" opacity=".9"/>
  <rect x="-8.5" y="-5.5" width="17" height="11" rx="2.4" fill="${C.accent}" stroke="${C.accentHi}" stroke-width=".8"/>
  <rect x="-6" y="-3.2" width="1.8" height="1.8" rx=".4" fill="#e5ecff" opacity=".85"/>
  <rect x="-6" y="1.4" width="1.8" height="1.8" rx=".4" fill="#e5ecff" opacity=".85"/>
  <path d="M-1.6-3.2 4.4 0l-6 3.2z" fill="#111216"/>
</g>`);

/* ------------------------------------------------------------------ */

const defs = defsExtra
  .replace('<path d="" id="deskClipPath"/>', `<path d="${deskTop}" id="deskClipPath"/>`)
  .replace('</defs>', `
<clipPath id="tileClip"><rect width="52" height="42" rx="1.5"/></clipPath>
<clipPath id="phoneScreenClip"><rect width="64" height="134" rx="2.5"/></clipPath>
<clipPath id="laptopScreenClip"><rect width="264" height="133"/></clipPath>
</defs>`);

await fs.mkdir(path.dirname(OUT), { recursive: true });
const svg = F.render({ pad: 34, defs });
await fs.writeFile(OUT, svg);
process.stdout.write(`Wrote ${path.relative(ROOT, OUT)} (${(svg.length / 1024).toFixed(1)} KB)\n`);


