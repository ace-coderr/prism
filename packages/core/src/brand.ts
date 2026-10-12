/**
 * PRISM's look, shared by the app, the share images, the badge and the brand-asset generator:
 * the palette and the mark (a hexagonal cut gem seen from above: five facets in PRISM's colors
 * and one dark grey, the "sold" facet).
 */

export const PALETTE = {
  ink: '#101214',
  panel: '#16191c',
  line: '#262b30',
  mist: '#9aa2a9',
  white: '#f4f6f7',
  lime: '#d4f000',
  up: '#4cd07a',
  down: '#f0544f',
  gold: '#f6c143',
  teal: '#3cc8b4',
  coral: '#ff7a5c',
  /** a SOLD facet */
  sold: '#4a5057',
} as const;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a: string, b: string, t: number) => {
  const x = hex(a);
  const y = hex(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * Math.min(1, Math.max(0, t))));
};

/** A true colors score's color: red at 1, gold at 3, green at 5. */
export function scoreColor(score: number): string {
  const s = Math.min(5, Math.max(1, score));
  return s <= 3 ? mix(PALETTE.down, PALETTE.gold, (s - 1) / 2) : mix(PALETTE.gold, PALETTE.up, (s - 3) / 2);
}

export interface MarkOptions {
  /** draw the dark rounded square behind it (app icons) */
  tile?: boolean;
}

/** The mark's facets, clockwise from the top right; the dark one is the "sold" facet. */
export const MARK_FACETS = [PALETTE.lime, PALETTE.up, PALETTE.teal, PALETTE.sold, PALETTE.coral, PALETTE.gold] as const;

/**
 * The mark's shapes in a 64×64 box: a pointy-top hexagon split into 6 triangular facets with thin
 * dark outlines. Returned as SVG elements (no outer <svg>), so React can inline it and the
 * generators can wrap it. Built to read at 16px: flat colors, no detail finer than a facet.
 */
export function markShapes({ tile = false }: MarkOptions = {}): string {
  const r = tile ? 23 : 29.5;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [32 + r * Math.cos(a), 32 + r * Math.sin(a)] as const;
  });
  const p = (q: readonly [number, number]) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
  const facets = MARK_FACETS.map((fill, i) => `<path d="M32 32L${p(pts[i]!)}L${p(pts[(i + 1) % 6]!)}Z" fill="${fill}"/>`).join('');
  const outline = `<path d="M${pts.map(p).join('L')}Z${pts.map((q) => `M32 32L${p(q)}`).join('')}" fill="none" stroke="${PALETTE.ink}" stroke-width="${tile ? 1.7 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
  return [tile ? `<rect width="64" height="64" rx="14" fill="${PALETTE.ink}"/>` : '', facets, outline].join('');
}

/** The mark as a standalone SVG document. */
export const markSvg = (size: number, opts: MarkOptions = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${markShapes(opts)}</svg>`;

/** A five-point star path in a `size` box at (x, y) (fonts don't all carry ★). */
export function starPath(x: number, y: number, size: number): string {
  const c = size / 2;
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? c : c * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${(x + c + r * Math.cos(a)).toFixed(2)},${(y + c + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join('L')}Z`;
}

/** Text for SVG/XML. */
export const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);
