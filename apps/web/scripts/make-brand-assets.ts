/**
 * Generates PRISM's favicon set and Open Graph / X share card into apps/web/public.
 * Re-run after changing the logo or the hero crystal:
 *
 *   npx tsx apps/web/scripts/make-brand-assets.ts
 *
 * - favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png (180),
 *   icon-192.png, icon-512.png, site.webmanifest
 * - og.jpg (1200×630, < 250 KB): the real Home crystal (buildCrystal) drawn as
 *   outlined isometric voxels, plus the PRISM wordmark and tagline. JPEG (no alpha)
 *   because WhatsApp/Telegram previews are unreliable with transparent PNGs.
 *
 * Fonts (SIL Open Font License) live in scripts/fonts and are only used here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { buildCrystal, exposedVoxels, type Voxel } from '@prism/core';
import { CORRELATIONS, MY_CRYSTALS, toHoldings } from '../src/data/mock';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../public');
const fonts = ['SpaceGrotesk-Bold.ttf', 'SpaceMono-Regular.ttf', 'SpaceMono-Bold.ttf'].map((f) => join(here, 'fonts', f));
mkdirSync(out, { recursive: true });

const BG = '#101214';
/** The static Bold cut Google Fonts serves names its family "Space Grotesk Light" (variable-font artefact). */
const GROTESK = 'Space Grotesk Light';
const LIME = '#d4f000';
const GOLD = '#f6c143';

export const png = (svg: string, width?: number) =>
  new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Space Mono' },
    shapeRendering: 2, // geometricPrecision for the card; icons pass crispEdges in the SVG
  })
    .render()
    .asPng();

// ---------------------------------------------------------------------------
// Logo mark: the same 7×6 voxel gem as the navbar (lime crown, one gold pixel).
// ---------------------------------------------------------------------------

const GEM = ['..AAA..', '.ABBBA.', 'ABBGBBA', '.CCCCC.', '..CCC..', '...C...'];
const SHADES: Record<string, string> = { A: '#e6ff5c', B: LIME, C: '#8fa300', G: GOLD };

/**
 * Icon SVG at an exact pixel size: integer cell size so every voxel lands on whole
 * pixels (crisp at 16px), dark rounded tile so it reads on light and dark tabs.
 */
export function iconSvg(size: number, opts: { rounded: boolean; fill?: number }): string {
  // `fill`: share of the tile the gem spans (maskable icons keep it inside the 80% safe zone)
  const cell = Math.floor((size * (opts.fill ?? 0.86)) / 7);
  const w = cell * 7;
  const h = cell * 6;
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2) + Math.round(cell * 0.15);
  // a 1px grout between voxels once there is room for it
  const gap = cell >= 6 ? Math.max(1, Math.round(cell * 0.05)) : 0;
  const r = opts.rounded ? Math.round(size * 0.22) : 0;
  const rects = GEM.flatMap((row, y) =>
    [...row].map((ch, x) =>
      ch === '.'
        ? ''
        : `<rect x="${ox + x * cell + gap}" y="${oy + y * cell + gap}" width="${cell - gap * 2}" height="${cell - gap * 2}" fill="${SHADES[ch]}"/>`,
    ),
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" rx="${r}" fill="${BG}"/>${rects}</svg>`;
}

/** Windows/legacy favicon.ico holding PNG-compressed images. */
function ico(images: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// ---------------------------------------------------------------------------
// Share card: the Home crystal as outlined isometric voxels.
// ---------------------------------------------------------------------------

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const shade = (c: string, k: number) =>
  `#${hex(c)
    .map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0'))
    .join('')}`;

/** Rotate a voxel a quarter turn `q` times around the vertical axis (stays on the grid). */
const turn = ([x, y, z]: [number, number, number], q: number): [number, number, number] => {
  for (let i = 0; i < q; i++) [x, z] = [-z, x];
  return [x, y, z];
};

function crystalSvg(cx: number, cy: number, unit: number): string {
  const hero = MY_CRYSTALS[0]!;
  const geo = buildCrystal(toHoldings(hero.weights), hero.history, { correlation: CORRELATIONS, resolution: 10 });
  const shell = exposedVoxels(geo.voxels);

  // face the viewer with the side that shows the most gold
  const facing = (v: Voxel, q: number) => {
    const [x, , z] = turn(v.position, q);
    return x + z > 0;
  };
  let best = 0;
  let bestGold = -1;
  for (let q = 0; q < 4; q++) {
    const gold = shell.filter((v) => v.gold && facing(v, q)).length;
    if (gold > bestGold) {
      bestGold = gold;
      best = q;
    }
  }

  const cells = shell.map((v) => ({ v, p: turn(v.position, best) }));
  const filled = new Set(cells.map(({ p }) => p.join(',')));
  const has = (x: number, y: number, z: number) => filled.has(`${x},${y},${z}`);
  // isometric camera looking from (+x, +y, +z): paint far → near
  cells.sort((a, b) => a.p[0] + a.p[1] + a.p[2] - (b.p[0] + b.p[1] + b.p[2]));

  // a low camera (dimetric, ~17° down) so the gem's pointed top, wide girdle and
  // pointed bottom read clearly; painter's order is unchanged (camera at +x, +y, +z)
  const c30 = Math.cos(Math.PI / 6);
  const DROP = 0.3;
  const P = (x: number, y: number, z: number) =>
    `${(cx + (x - z) * c30 * unit).toFixed(1)},${(cy + (x + z) * DROP * unit - y * unit).toFixed(1)}`;
  const stroke = Math.max(1.2, unit * 0.09).toFixed(2);

  const glow: string[] = [];
  const faces: string[] = [];
  for (const { v, p } of cells) {
    const [x, y, z] = p;
    const base = v.gold ? GOLD : v.color;
    const k = v.gold ? [1.18, 1.0, 0.86] : [1.12, 0.84, 0.66];
    const poly = (pts: string[], fill: string) =>
      `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="#000" stroke-width="${stroke}" stroke-linejoin="round"/>`;
    const f: string[] = [];
    if (!has(x, y + 1, z))
      f.push(poly([P(x - 0.5, y + 0.5, z - 0.5), P(x + 0.5, y + 0.5, z - 0.5), P(x + 0.5, y + 0.5, z + 0.5), P(x - 0.5, y + 0.5, z + 0.5)], shade(base, k[0]!)));
    if (!has(x + 1, y, z))
      f.push(poly([P(x + 0.5, y + 0.5, z - 0.5), P(x + 0.5, y + 0.5, z + 0.5), P(x + 0.5, y - 0.5, z + 0.5), P(x + 0.5, y - 0.5, z - 0.5)], shade(base, k[1]!)));
    if (!has(x, y, z + 1))
      f.push(poly([P(x - 0.5, y + 0.5, z + 0.5), P(x + 0.5, y + 0.5, z + 0.5), P(x + 0.5, y - 0.5, z + 0.5), P(x - 0.5, y - 0.5, z + 0.5)], shade(base, k[2]!)));
    faces.push(...f);
    if (v.gold && f.length) glow.push(`<circle cx="${P(x, y, z).split(',')[0]}" cy="${P(x, y, z).split(',')[1]}" r="${(unit * 0.9).toFixed(1)}" fill="${GOLD}"/>`);
  }
  // warm halo behind the gold seams (a soft glow, outlines stay crisp on top)
  return `<g filter="url(#goldGlow)" opacity="0.55">${glow.join('')}</g>${faces.join('')}`;
}

function ogSvg(): string {
  const W = 1200;
  const H = 630;
  // faint market grid
  const grid = [
    ...Array.from({ length: 11 }, (_, i) => `<line x1="0" y1="${i * 63}" x2="${W}" y2="${i * 63}"/>`),
    ...Array.from({ length: 20 }, (_, i) => `<line x1="${i * 63}" y1="0" x2="${i * 63}" y2="${H}"/>`),
  ].join('');
  const markCell = 9;
  const mark = GEM.flatMap((row, y) =>
    [...row].map((ch, x) =>
      ch === '.' ? '' : `<rect x="${x * markCell}" y="${y * markCell}" width="${markCell}" height="${markCell}" fill="${SHADES[ch]}" stroke="#000" stroke-width="1.6"/>`,
    ),
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="lime" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${LIME}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${LIME}" stop-opacity="0"/>
    </radialGradient>
    <filter id="goldGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <g stroke="${LIME}" stroke-opacity="0.045" stroke-width="1">${grid}</g>
  <ellipse cx="330" cy="520" rx="250" ry="46" fill="url(#lime)"/>
  ${crystalSvg(330, 300, 21)}

  <g transform="translate(640 150)">
    <g transform="translate(0 4)">${mark}</g>
    <text x="84" y="50" font-family="${GROTESK}" font-weight="700" font-size="60" letter-spacing="-1.5" fill="#f2f3f0">PRISM</text>
    <text x="0" y="170" font-family="${GROTESK}" font-weight="700" font-size="64" letter-spacing="-2" fill="#f2f3f0">A stock basket</text>
    <text x="0" y="240" font-family="${GROTESK}" font-weight="700" font-size="64" letter-spacing="-2" fill="#f2f3f0">you can hold</text>
    <text x="0" y="300" font-family="Space Mono" font-weight="400" font-size="17" letter-spacing="2.5" fill="#9aa2a9">TOKENIZED STOCKS + ETH = ONE CRYSTAL</text>
    <text x="0" y="334" font-family="Space Mono" font-weight="400" font-size="17" letter-spacing="2.5" fill="${GOLD}">GOLD SEAMS = DRAWDOWNS SURVIVED</text>
    <g transform="translate(0 380)">
      <rect width="330" height="52" rx="26" fill="${LIME}"/>
      <text x="165" y="33" text-anchor="middle" font-family="Space Mono" font-weight="700" font-size="18" letter-spacing="1.5" fill="${BG}">prism-crystal.vercel.app</text>
    </g>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------

const write = (name: string, data: string | Buffer) => {
  writeFileSync(join(out, name), data);
  console.log('wrote', name, typeof data === 'string' ? `${data.length} chars` : `${data.length} bytes`);
};

// tab icons: the gem nearly fills the tile — 2px voxels at 16px, 4px at 32px
write('favicon.svg', iconSvg(32, { rounded: true, fill: 0.9 }));
write(
  'favicon.ico',
  ico([16, 32, 48].map((size) => ({ size, data: png(iconSvg(size, { rounded: true, fill: 0.9 })) }))),
);
write('apple-touch-icon.png', png(iconSvg(180, { rounded: false, fill: 0.74 }))); // iOS rounds it itself
write('icon-192.png', png(iconSvg(192, { rounded: false, fill: 0.66 })));
write('icon-512.png', png(iconSvg(512, { rounded: false, fill: 0.66 })));
write(
  'site.webmanifest',
  JSON.stringify(
    {
      name: 'PRISM — a stock basket you can hold',
      short_name: 'PRISM',
      start_url: '/',
      display: 'standalone',
      background_color: BG,
      theme_color: BG,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    null,
    2,
  ) + '\n',
);
// share card as an opaque JPEG (preview bots handle it more reliably than RGBA PNG)
const card = new Resvg(ogSvg(), {
  fitTo: { mode: 'original' },
  font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Space Mono' },
}).render();
const og = jpeg.encode({ data: Buffer.from(card.pixels), width: card.width, height: card.height }, 88).data;
if (og.length > 250_000) throw new Error(`og.jpg is ${og.length} bytes — keep it under 250 KB`);
write('og.jpg', og);
