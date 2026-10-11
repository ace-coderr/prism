/**
 * PRISM's look, shared by the app, the share images, the badge and the brand-asset generator:
 * the palette, the spectrum and the mark (a prism splitting a white beam into colors).
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
} as const;

/** The colors light splits into, top to bottom. */
export const SPECTRUM = ['#f0544f', '#f68a43', '#f6c143', '#d4f000', '#4cd07a', '#4fc3f0', '#8b7bff'] as const;

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
  /** 0..1: how much light comes out (sentiment); 1 = full spectrum */
  light?: number;
  /** 0..1: how cloudy the prism is (share of reviewers who sold) */
  cloud?: number;
  /** draw the dark rounded square behind it (icons) */
  tile?: boolean;
}

/**
 * The mark's shapes in a 64×64 box: the beam in, the prism, the rays out. Returned as SVG elements
 * (no outer <svg>), so React can inline it and the generators can wrap it.
 */
export function markShapes({ light = 1, cloud = 0, tile = false }: MarkOptions = {}): string {
  const l = Math.min(1, Math.max(0, light));
  const c = Math.min(1, Math.max(0, cloud));
  const rays = SPECTRUM.map((color, i) => {
    const y = 22 + i * 4.4;
    const tone = mix(PALETTE.mist, color, l * (1 - c * 0.75));
    return `<path d="M42.5 ${27.5 + i * 0.9}L62 ${y}" stroke="${tone}" stroke-width="3.2" stroke-linecap="round" opacity="${(0.35 + 0.65 * l) * (1 - c * 0.5)}"/>`;
  }).join('');
  const glass = mix(PALETTE.lime, PALETTE.mist, c * 0.8);
  return [
    tile ? `<rect width="64" height="64" rx="14" fill="${PALETTE.ink}"/>` : '',
    `<path d="M2 35L23 32" stroke="${PALETTE.white}" stroke-width="3.6" stroke-linecap="round"/>`,
    rays,
    `<path d="M32 9L52 49H12Z" fill="${glass}" fill-opacity="0.18" stroke="${glass}" stroke-width="4" stroke-linejoin="round"/>`,
    `<path d="M22.5 32L42 30" stroke="${mix(PALETTE.white, glass, 0.5)}" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/>`,
  ].join('');
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
