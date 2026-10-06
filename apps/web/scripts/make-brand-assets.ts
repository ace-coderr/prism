/**
 * Generates PRISM's brand images into apps/web/public. Re-run after changing the logo or
 * the crystal look:
 *
 *   npm run brand -w @prism/web                  (everything)
 *   npm run brand -w @prism/web -- brand/x       (only files whose path contains "brand/x")
 *
 * - favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png (180),
 *   icon-192.png, icon-512.png, site.webmanifest
 * - og.jpg (1200×630, < 250 KB): a voxel crystal drawn as outlined isometric voxels, plus
 *   the PRISM wordmark and tagline. JPEG (no alpha) because WhatsApp/Telegram previews are
 *   unreliable with transparent PNGs.
 * - brand/x/prism-x-avatar.png (400×400): the voxel gem for the X profile picture. X shows
 *   it as a circle, so everything sits well inside the centre circle; reads at 48px.
 * - brand/x/prism-x-banner.png (1500×500): the X header. Text and crystal stay clear of the
 *   bottom-left 450×200 (where the profile picture sits) and of the top / bottom edges
 *   some screens crop.
 * - brand/privy-logo.png (360×180): the PRISM logo for Privy's login modal and login emails.
 *
 * The crystals are drawn by the real renderer (buildCrystal: per-asset shades, seams
 * between holdings, gold seams) from the explainer video's illustrative basket
 * (apps/video/src/timeline.ts), so every run gives the same images and they match the video.
 *
 * Fonts (SIL Open Font License) live in scripts/fonts and are only used here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { buildCrystal, exposedVoxels, regionBorders, type Voxel } from '@prism/core';
import { DROP, HOLDINGS } from '../../video/src/timeline';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../public');
const fonts = ['SpaceGrotesk-Bold.ttf', 'SpaceMono-Regular.ttf', 'SpaceMono-Bold.ttf'].map((f) => join(here, 'fonts', f));
const only = process.argv[2];

const BG = '#101214';
/** The static Bold cut Google Fonts serves names its family "Space Grotesk Light" (variable-font artefact). */
const GROTESK = 'Space Grotesk Light';
const LIME = '#d4f000';
const GOLD = '#f6c143';
const INK = '#f2f3f0';
const MIST = '#9aa2a9';

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
// A crystal as outlined isometric voxels (per-asset shades, seams, glowing gold).
// ---------------------------------------------------------------------------

type V3 = [number, number, number];
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const shade = (c: string, k: number) =>
  `#${hex(c)
    .map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0'))
    .join('')}`;

/** Rotate a point or vector a quarter turn `q` times around the vertical axis (stays on the grid). */
const turn = (p: readonly number[], q: number): V3 => {
  let [x, y, z] = [p[0]!, p[1]!, p[2]!];
  for (let i = 0; i < q; i++) [x, z] = [-z, x];
  return [x, y, z];
};

/** Seam between holdings: dark strip this wide (in cubes) on each face along a border (as on the site). */
const SEAM_WIDTH = 0.24;

/**
 * The brand crystal fitted into a box (centre cx, cy; at most w × h px), seen from a low
 * camera (dimetric, ~17° down) so its pointed top, wide girdle and pointed bottom read
 * clearly. Turned a quarter step at a time to show the most gold.
 */
function crystalSvg({ cx, cy, w, h }: { cx: number; cy: number; w: number; h: number }, resolution = 10): string {
  const geo = buildCrystal(HOLDINGS, { drawdowns: [DROP] }, { resolution, crackThreshold: 5 });
  const shell = exposedVoxels(geo.voxels);

  // face the viewer with the side that shows the most gold
  const facing = (v: Voxel, q: number) => {
    const [x, , z] = turn(v.position, q);
    return x + z > 0;
  };
  let q = 0;
  let bestGold = -1;
  for (let k = 0; k < 4; k++) {
    const gold = shell.filter((v) => v.gold && facing(v, k)).length;
    if (gold > bestGold) {
      bestGold = gold;
      q = k;
    }
  }
  const rot = (p: readonly number[]) => turn(p, q);

  const cells = shell.map((v) => ({ v, p: rot(v.position) }));
  const filled = new Set(geo.voxels.map((v) => rot(v.position).join(',')));
  const has = (x: number, y: number, z: number) => filled.has(`${x},${y},${z}`);
  // isometric camera looking from (+x, +y, +z): paint far → near
  cells.sort((a, b) => a.p[0] + a.p[1] + a.p[2] - (b.p[0] + b.p[1] + b.p[2]));

  // seams between holdings, keyed by the face they lie on (cube + normal, after the turn)
  const seams = new Map<string, V3[][]>();
  for (const s of regionBorders(geo.voxels)) {
    const half = [0, 0, 0];
    half[s.along] = 0.5 + SEAM_WIDTH / 2;
    const a = s.edge.map((c, i) => c - half[i]!);
    const b = s.edge.map((c, i) => c + half[i]!);
    const d = s.inward.map((c) => c * SEAM_WIDTH);
    const quad = [a, b, b.map((c, i) => c + d[i]!), a.map((c, i) => c + d[i]!)].map(rot);
    const key = `${rot(s.cell).join(',')}|${rot(s.normal).join(',')}`;
    seams.set(key, [...(seams.get(key) ?? []), quad]);
  }

  // fit: project at unit 1, then scale and centre into the box
  const c30 = Math.cos(Math.PI / 6);
  const DROP_K = 0.3;
  const raw = (x: number, y: number, z: number): [number, number] => [(x - z) * c30, (x + z) * DROP_K - y];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { p } of cells) {
    for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
      const [sx, sy] = raw(p[0] + dx, p[1] + dy, p[2] + dz);
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
  }
  const unit = Math.min(w / (maxX - minX), h / (maxY - minY));
  const ox = cx - ((minX + maxX) / 2) * unit;
  const oy = cy - ((minY + maxY) / 2) * unit;
  const P = (x: number, y: number, z: number) => {
    const [sx, sy] = raw(x, y, z);
    return `${(ox + sx * unit).toFixed(1)},${(oy + sy * unit).toFixed(1)}`;
  };
  const stroke = Math.max(1.2, unit * 0.09).toFixed(2);

  const glow: string[] = [];
  const faces: string[] = [];
  const poly = (pts: string[], fill: string, outline = true) =>
    `<polygon points="${pts.join(' ')}" fill="${fill}"${outline ? ` stroke="#000" stroke-width="${stroke}" stroke-linejoin="round"` : ''}/>`;
  for (const { v, p } of cells) {
    const [x, y, z] = p;
    const base = v.gold ? GOLD : v.color;
    const k = v.gold ? [1.18, 1.0, 0.86] : [1.12, 0.84, 0.66];
    const sides: Array<{ show: boolean; normal: V3; pts: string[]; light: number }> = [
      { show: !has(x, y + 1, z), normal: [0, 1, 0], light: k[0]!, pts: [P(x - 0.5, y + 0.5, z - 0.5), P(x + 0.5, y + 0.5, z - 0.5), P(x + 0.5, y + 0.5, z + 0.5), P(x - 0.5, y + 0.5, z + 0.5)] },
      { show: !has(x + 1, y, z), normal: [1, 0, 0], light: k[1]!, pts: [P(x + 0.5, y + 0.5, z - 0.5), P(x + 0.5, y + 0.5, z + 0.5), P(x + 0.5, y - 0.5, z + 0.5), P(x + 0.5, y - 0.5, z - 0.5)] },
      { show: !has(x, y, z + 1), normal: [0, 0, 1], light: k[2]!, pts: [P(x - 0.5, y + 0.5, z + 0.5), P(x + 0.5, y + 0.5, z + 0.5), P(x + 0.5, y - 0.5, z + 0.5), P(x - 0.5, y - 0.5, z + 0.5)] },
    ];
    let shown = 0;
    for (const s of sides) {
      if (!s.show) continue;
      shown++;
      faces.push(poly(s.pts, shade(base, s.light)));
      // the seams on this face go right after it, so nearer cubes still paint over them
      for (const quad of seams.get(`${p.join(',')}|${s.normal.join(',')}`) ?? []) faces.push(poly(quad.map((c) => P(...c)), '#000', false));
    }
    if (v.gold && shown) {
      const [gx, gy] = P(x, y, z).split(',');
      glow.push(`<circle cx="${gx}" cy="${gy}" r="${(unit * 0.95).toFixed(1)}" fill="${GOLD}"/>`);
    }
  }
  // warm halo behind the gold seam (a soft glow; outlines stay crisp on top)
  return `<g filter="url(#goldGlow)" opacity="0.75">${glow.join('')}</g>${faces.join('')}`;
}

/** The navbar gem as outlined voxels at `cell` px, top-left at (x, y). */
const markSvg = (x: number, y: number, cell: number, stroke: number) =>
  GEM.flatMap((row, gy) =>
    [...row].map((ch, gx) =>
      ch === '.' ? '' : `<rect x="${x + gx * cell}" y="${y + gy * cell}" width="${cell}" height="${cell}" fill="${SHADES[ch]}" stroke="#000" stroke-width="${stroke}"/>`,
    ),
  ).join('');

// ---------------------------------------------------------------------------
// Share card (og.jpg)
// ---------------------------------------------------------------------------

function ogSvg(): string {
  const W = 1200;
  const H = 630;
  // faint market grid
  const grid = [
    ...Array.from({ length: 11 }, (_, i) => `<line x1="0" y1="${i * 63}" x2="${W}" y2="${i * 63}"/>`),
    ...Array.from({ length: 20 }, (_, i) => `<line x1="${i * 63}" y1="0" x2="${i * 63}" y2="${H}"/>`),
  ].join('');

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
  ${crystalSvg({ cx: 330, cy: 300, w: 470, h: 440 })}

  <g transform="translate(640 150)">
    <g transform="translate(0 4)">${markSvg(0, 0, 9, 1.6)}</g>
    <text x="84" y="50" font-family="${GROTESK}" font-weight="700" font-size="60" letter-spacing="-1.5" fill="${INK}">PRISM</text>
    <text x="0" y="170" font-family="${GROTESK}" font-weight="700" font-size="64" letter-spacing="-2" fill="${INK}">A stock basket</text>
    <text x="0" y="240" font-family="${GROTESK}" font-weight="700" font-size="64" letter-spacing="-2" fill="${INK}">you can hold</text>
    <text x="0" y="300" font-family="Space Mono" font-weight="400" font-size="17" letter-spacing="2.5" fill="${MIST}">TOKENIZED STOCKS + ETH = ONE CRYSTAL</text>
    <text x="0" y="334" font-family="Space Mono" font-weight="400" font-size="17" letter-spacing="2.5" fill="${GOLD}">GOLD SEAMS = DROPS IT RECOVERED FROM</text>
    <g transform="translate(0 380)">
      <rect width="330" height="52" rx="26" fill="${LIME}"/>
      <text x="165" y="33" text-anchor="middle" font-family="Space Mono" font-weight="700" font-size="18" letter-spacing="1.5" fill="${BG}">prism-crystal.vercel.app</text>
    </g>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// X (Twitter): profile picture and header
// ---------------------------------------------------------------------------

/**
 * 400×400 profile picture: the voxel gem, large, in the middle of X's circle crop, on the
 * dark background with a soft lime glow; its one gold pixel glows a little. No text.
 * Black grout between voxels and a black outline keep its shape clear at 48px.
 */
function xAvatarSvg(): string {
  const S = 400;
  const cell = 46;
  const ox = (S - cell * 7) / 2;
  // the gem's weight is in its wide upper rows: nudge it down to sit optically centred
  const oy = (S - cell * 6) / 2 + 8;
  const bevel = Math.round(cell * 0.14);
  // one voxel with a faint bevel: lit top edge, shaded bottom edge
  const voxel = (x: number, y: number, ch: string) => {
    const px = ox + x * cell;
    const py = oy + y * cell;
    return (
      `<rect x="${px}" y="${py}" width="${cell}" height="${cell}" fill="${SHADES[ch]}" stroke="#000" stroke-width="5"/>` +
      `<rect x="${px + 2.5}" y="${py + 2.5}" width="${cell - 5}" height="${bevel}" fill="#fff" opacity="${ch === 'G' ? 0.35 : 0.2}"/>` +
      `<rect x="${px + 2.5}" y="${py + cell - 2.5 - bevel}" width="${cell - 5}" height="${bevel}" fill="#000" opacity="0.16"/>`
    );
  };
  const voxels = GEM.flatMap((row, y) => [...row].map((ch, x) => (ch === '.' ? '' : voxel(x, y, ch)))).join('');
  const g = GEM.findIndex((row) => row.includes('G'));
  const gCol = GEM[g]!.indexOf('G');
  const gx = ox + (gCol + 0.5) * cell;
  const gy = oy + (g + 0.5) * cell;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${LIME}" stop-opacity="0.34"/>
      <stop offset="0.45" stop-color="${LIME}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${LIME}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>
  <rect width="${S}" height="${S}" fill="${BG}"/>
  <circle cx="200" cy="${oy + cell * 2.6}" r="190" fill="url(#glow)"/>
  ${voxels}
  <!-- the gold pixel: a warm halo over its neighbours, the pixel itself crisp on top -->
  <circle cx="${gx}" cy="${gy}" r="${cell * 0.95}" fill="${GOLD}" opacity="0.32" filter="url(#soft)"/>
  ${voxel(gCol, g, 'G')}
</svg>`;
}

/**
 * Privy's login modal and login emails: 2:1 as Privy recommends (shown at 180×90), PNG (its
 * emails don't take SVG), on a dark rounded tile so it reads on Privy's white email too.
 */
function privyLogoSvg(): string {
  const W = 360;
  const H = 180;
  const cell = 15;
  const gemW = cell * 7;
  const gap = 20;
  const textW = 196; // "PRISM" at 64px in Space Grotesk Bold
  const ox = (W - (gemW + gap + textW)) / 2;
  const oy = (H - cell * 6) / 2;
  const voxels = GEM.flatMap((row, y) =>
    [...row].map((ch, x) =>
      ch === '.' ? '' : `<rect x="${ox + x * cell}" y="${oy + y * cell}" width="${cell}" height="${cell}" fill="${SHADES[ch]}" stroke="#000" stroke-width="2"/>`,
    ),
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="28" fill="${BG}"/>
  ${voxels}
  <text x="${ox + gemW + gap}" y="${H / 2 + 22}" font-family="${GROTESK}" font-weight="700" font-size="64" letter-spacing="-1.5" fill="${INK}">PRISM</text>
</svg>`;
}

/** A dark "market screen" with faint, mostly green candlesticks (as behind the site's hero). */
function candlePanel(x: number, y: number, w: number, h: number, seed: number, opacity: number): string {
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const n = Math.round(w / 15);
  const step = w / n;
  let price = h * (0.4 + rand() * 0.2);
  const candles: string[] = [];
  for (let i = 0; i < n; i++) {
    const open = price;
    // drifts up: a market having a good day
    price = Math.min(h - 18, Math.max(18, price + (rand() - 0.58) * h * 0.11));
    const close = price;
    const hi = Math.min(open, close) - rand() * h * 0.05;
    const lo = Math.max(open, close) + rand() * h * 0.05;
    const up = close < open; // y grows downwards
    const col = up ? '#50dc78' : '#f05050';
    const cx = x + i * step + step / 2;
    candles.push(
      `<line x1="${cx.toFixed(1)}" y1="${(y + hi).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(y + lo).toFixed(1)}" stroke="${col}" stroke-opacity="${up ? 0.6 : 0.35}" stroke-width="1.5"/>` +
        `<rect x="${(cx - step * 0.28).toFixed(1)}" y="${(y + Math.min(open, close)).toFixed(1)}" width="${(step * 0.56).toFixed(1)}" height="${Math.max(2, Math.abs(close - open)).toFixed(1)}" fill="${col}" fill-opacity="${up ? 0.6 : 0.35}"/>`,
    );
  }
  const grid = Array.from({ length: Math.floor(h / 32) }, (_, i) => `<line x1="${x}" y1="${y + 24 + i * 32}" x2="${x + w}" y2="${y + 24 + i * 32}"/>`).join('');
  return `<g opacity="${opacity}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#16191c" stroke="${LIME}" stroke-opacity="0.22" stroke-width="2"/>
    <g stroke="${LIME}" stroke-opacity="0.06" stroke-width="1">${grid}</g>
    ${candles.join('')}
  </g>`;
}

/**
 * 1500×500 header. The profile picture covers the bottom-left 450×200 on desktop and some
 * screens crop the top and bottom, so the text starts right of x = 450 and everything that
 * matters sits between y ≈ 80 and 400. The crystal (with its glowing gold seam) is on the right.
 */
function xBannerSvg(): string {
  const W = 1500;
  const H = 500;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="lime" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${LIME}" stop-opacity="0.24"/>
      <stop offset="1" stop-color="${LIME}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${LIME}" stop-opacity="0.09"/>
      <stop offset="1" stop-color="${LIME}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fadeL" x1="0" x2="1">
      <stop offset="0" stop-color="${BG}" stop-opacity="0.15"/>
      <stop offset="0.35" stop-color="${BG}" stop-opacity="0.82"/>
      <stop offset="0.62" stop-color="${BG}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${BG}" stop-opacity="0.1"/>
    </linearGradient>
    <filter id="goldGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- faint market screens -->
  ${candlePanel(30, 36, 390, 200, 3, 0.55)}
  ${candlePanel(-40, 268, 330, 190, 7, 0.3)}
  ${candlePanel(520, 360, 420, 170, 5, 0.32)}
  ${candlePanel(960, 22, 500, 230, 4, 0.42)}
  ${candlePanel(1110, 300, 420, 200, 6, 0.3)}
  <!-- keep the text area calm -->
  <rect width="${W}" height="${H}" fill="url(#fadeL)"/>

  <!-- the crystal -->
  <circle cx="1240" cy="245" r="230" fill="url(#halo)"/>
  <ellipse cx="1240" cy="440" rx="200" ry="30" fill="url(#lime)"/>
  ${crystalSvg({ cx: 1240, cy: 238, w: 380, h: 370 })}

  <!-- text: clear of the profile picture (bottom-left 450×200) -->
  <text x="472" y="212" font-family="${GROTESK}" font-weight="700" font-size="72" letter-spacing="-2.2" fill="${INK}">A stock basket</text>
  <text x="472" y="290" font-family="${GROTESK}" font-weight="700" font-size="72" letter-spacing="-2.2" fill="${LIME}">you can hold</text>
  <text x="475" y="340" font-family="Space Mono" font-weight="400" font-size="16" letter-spacing="1" fill="${MIST}">prism-crystal.vercel.app · Robinhood Chain Testnet</text>
</svg>`;
}

// ---------------------------------------------------------------------------

/** Write one file, made only when its path matches the filter argument (if any). */
const write = (name: string, make: () => string | Buffer, maxBytes = Infinity) => {
  if (only && !name.includes(only)) return;
  const data = make();
  if (data.length > maxBytes) throw new Error(`${name} is ${data.length} bytes — keep it under ${maxBytes}`);
  mkdirSync(dirname(join(out, name)), { recursive: true });
  writeFileSync(join(out, name), data);
  console.log('wrote', name, typeof data === 'string' ? `${data.length} chars` : `${data.length} bytes`);
};

// tab icons: the gem nearly fills the tile — 2px voxels at 16px, 4px at 32px
write('favicon.svg', () => iconSvg(32, { rounded: true, fill: 0.9 }));
write('favicon.ico', () => ico([16, 32, 48].map((size) => ({ size, data: png(iconSvg(size, { rounded: true, fill: 0.9 })) }))));
write('apple-touch-icon.png', () => png(iconSvg(180, { rounded: false, fill: 0.74 }))); // iOS rounds it itself
write('icon-192.png', () => png(iconSvg(192, { rounded: false, fill: 0.66 })));
write('icon-512.png', () => png(iconSvg(512, { rounded: false, fill: 0.66 })));
write('site.webmanifest', () =>
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
write(
  'og.jpg',
  () => {
    const card = new Resvg(ogSvg(), {
      fitTo: { mode: 'original' },
      font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Space Mono' },
    }).render();
    return jpeg.encode({ data: Buffer.from(card.pixels), width: card.width, height: card.height }, 88).data;
  },
  250_000,
);
// X: profile picture (upload limit 2 MB) and header (5 MB)
write('brand/x/prism-x-avatar.png', () => png(xAvatarSvg()), 2_000_000);
write('brand/x/prism-x-banner.png', () => png(xBannerSvg()), 5_000_000);
// Privy: the login modal's logo (PRIVY_CONFIG.appearance.logo) and, set in its dashboard, its login emails
write('brand/privy-logo.png', () => png(privyLogoSvg()), 200_000);
