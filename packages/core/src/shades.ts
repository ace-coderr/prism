/**
 * Per-asset shades. Every asset keeps its own shade inside a colour family, so the same
 * asset looks the same in every crystal and one crystal's holdings stay apart even when
 * they all moved the same way:
 *   - up today      → the green family (lime-green, emerald, teal-green, mint, forest, …)
 *   - down today    → the red family (crimson, brick, coral, rose, maroon, …)
 *   - no price data → greys
 * Each shade slot has its own fixed lightness (shared by all three families), so any two
 * slots differ by at least SHADE_STEP in OKLab lightness whatever the moves; hue adds more.
 * The size of the move only sets how vivid the colour is: a bigger move is more saturated.
 */
import { clamp, hashString, type Vec3 } from './math';

export type ShadeFamily = 'up' | 'down' | 'none';

interface Slot {
  /** OKLab lightness, the same in every family */
  L: number;
  /** full-move chroma and hue (OKLCH degrees) in the green and red families */
  up: [chroma: number, hue: number];
  down: [chroma: number, hue: number];
}

/** Lightness levels: evenly spaced from light to dark. */
const LIGHT = 0.86;
const DARK = 0.41;

/*
 * Slot order = lightness order (0 lightest). Neighbours alternate warm / cool hues so
 * close lightness levels also differ in hue.
 */
const SLOTS: Array<Omit<Slot, 'L'> & { names: string }> = [
  { names: 'mint / rose', up: [0.11, 166], down: [0.1, 6] },
  { names: 'lime-green / coral', up: [0.2, 128], down: [0.15, 40] },
  { names: 'seafoam / pink-red', up: [0.12, 182], down: [0.17, 0] },
  { names: 'chartreuse / salmon', up: [0.16, 123], down: [0.13, 33] },
  { names: 'emerald / crimson', up: [0.17, 155], down: [0.2, 12] },
  { names: 'teal-green / brick', up: [0.11, 188], down: [0.14, 36] },
  { names: 'green / raspberry', up: [0.14, 140], down: [0.16, 2] },
  { names: 'deep forest / maroon', up: [0.1, 150], down: [0.12, 22] },
];

export const SHADE_COUNT = SLOTS.length;
/** Lightness gap between neighbouring shade slots (the minimum distance between any two). */
export const SHADE_STEP = (LIGHT - DARK) / (SHADE_COUNT - 1);
const PALETTE: Slot[] = SLOTS.map((s, i) => ({ L: LIGHT - i * SHADE_STEP, up: s.up, down: s.down }));

/**
 * Fixed slots for the assets PRISM knows. Chosen so the ones that show up together
 * (the live basket: AAPL, NVDA, SPCX, ANTHROPIC, OPENAI, ETH) sit far apart.
 */
export const ASSET_SHADES: Readonly<Record<string, number>> = {
  ANTHROPIC: 0,
  AAPL: 1,
  ETH: 2,
  tSFUND: 3,
  NVDA: 4,
  OPENAI: 5,
  USDG: 6,
  SPCX: 7,
};
/** Same asset, other wrapper: shares the shade (unless both sit in one crystal). */
const ALIASES: Readonly<Record<string, string>> = { WETH: 'ETH' };

/** A ±8% day gives the most vivid colour. */
export const SHADE_FULL_MOVE = 8;
/** Even a 0.01% day keeps this much colour, so its family still reads. */
const MIN_CHROMA = 0.075;
/** Grey: a whisper of cool blue so it never reads as a price colour. */
const GREY: [number, number] = [0.012, 250];

/** The shade an asset asks for: its fixed slot, else one picked from its symbol. */
export function preferredShade(symbol: string): number {
  const own = ASSET_SHADES[symbol] ?? ASSET_SHADES[ALIASES[symbol] ?? ''];
  return own ?? hashString(symbol) % SHADE_COUNT;
}

/**
 * One shade slot per holding of a crystal. Known assets always get their own slot; an
 * alias (WETH next to ETH) or an unknown token whose slot is taken moves to the next free
 * one, so up to SHADE_COUNT holdings never share a shade.
 */
export function shadeSlots(symbols: string[]): number[] {
  const rank = (s: string) => (s in ASSET_SHADES ? 0 : s in ALIASES ? 1 : 2);
  const order = symbols
    .map((s, i) => i)
    .sort((a, b) => rank(symbols[a]!) - rank(symbols[b]!) || (symbols[a]! < symbols[b]! ? -1 : symbols[a]! > symbols[b]! ? 1 : a - b));
  const used = new Set<number>();
  const out: number[] = new Array(symbols.length);
  for (const i of order) {
    const want = preferredShade(symbols[i]!);
    let slot = want;
    for (let k = 0; k < SHADE_COUNT && used.has(slot); k++) slot = (want + k + 1) % SHADE_COUNT;
    used.add(slot);
    out[i] = slot;
  }
  return out;
}

export const familyOf = (change24h: number): ShadeFamily =>
  !Number.isFinite(change24h) ? 'none' : change24h >= 0 ? 'up' : 'down';

export interface ShadeOptions {
  /**
   * Small pictures (thumbnails, dots): more vivid colour and a touch lighter, so regions
   * stay apart at a few pixels each on the dark page.
   */
  boost?: boolean;
}

/** The colour of shade `slot` for a 24h move (NaN = no price data → grey). */
export function holdingShade(slot: number, change24h: number, opts: ShadeOptions = {}): { color: string; intensity: number; family: ShadeFamily } {
  const s = PALETTE[((slot % SHADE_COUNT) + SHADE_COUNT) % SHADE_COUNT]!;
  const family = familyOf(change24h);
  const L = opts.boost ? Math.min(0.9, s.L + 0.03) : s.L;
  if (family === 'none') return { color: oklchToHex(L, GREY[0], GREY[1]), intensity: 0, family };
  const intensity = clamp(Math.abs(change24h) / SHADE_FULL_MOVE, 0, 1);
  const [C, h] = family === 'up' ? s.up : s.down;
  // calm days are muted but keep their family's hue; big moves are fully vivid
  const k = opts.boost ? 0.75 + 0.4 * intensity : 0.6 + 0.4 * intensity;
  return { color: oklchToHex(L, Math.max(MIN_CHROMA, C * k), h), intensity, family };
}

/** Colours for a crystal's holdings, slot clashes resolved the same way the crystal does. */
export function holdingShades<T extends { symbol: string; change24h: number }>(holdings: T[], opts: ShadeOptions = {}) {
  const slots = shadeSlots(holdings.map((h) => h.symbol));
  return holdings.map((h, i) => ({ ...h, slot: slots[i]!, ...holdingShade(slots[i]!, h.change24h, opts) }));
}

// ---------------------------------------------------------------------------
// OKLab (Björn Ottosson): perceptual lightness / chroma / hue, and colour distance
// ---------------------------------------------------------------------------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklabToLinear(L: number, a: number, b: number): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → sRGB hex; chroma is reduced until the colour fits in sRGB (hue and lightness kept). */
export function oklchToHex(L: number, C: number, hueDeg: number): string {
  const h = (hueDeg * Math.PI) / 180;
  const at = (c: number) => oklabToLinear(L, c * Math.cos(h), c * Math.sin(h));
  const fits = (rgb: Vec3) => rgb.every((x) => x >= -1e-4 && x <= 1 + 1e-4);
  let c = C;
  if (!fits(at(c))) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(at(mid))) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const hex = (x: number) =>
    Math.round(clamp(toGamma(clamp(x, 0, 1)), 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  const [r, g, b] = at(c);
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** sRGB hex → OKLab [L, a, b]. */
export function hexToOklab(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => toLinear(x / 255)) as Vec3;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Hue in degrees [0, 360) and chroma of a hex colour (OKLCH). */
export function hexToOklch(hex: string): { L: number; C: number; h: number } {
  const [L, a, b] = hexToOklab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

/** Perceptual distance between two colours (ΔE in OKLab; ~0.02 is barely visible). */
export function colorDistance(x: string, y: string): number {
  const p = hexToOklab(x);
  const q = hexToOklab(y);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
