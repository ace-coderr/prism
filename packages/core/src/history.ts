/**
 * Real price history → crystal history. Works on step series (each price holds until
 * the next point), e.g. a token's USD price from its pool's swap events.
 */
import type { CrystalHistory, Drawdown } from './crystal';
import type { PricePoint } from './pool';

/**
 * Smallest drop (percent, peak to trough) that cracks a live PRISM crystal. Testnet
 * history only reaches back days, not years, so this is lower than the long-run
 * default in buildCrystal (CRACK_THRESHOLD).
 */
export const LIVE_CRACK_THRESHOLD = 5;

/** At most this many cracks / seams per crystal, so the shape stays readable. */
export const MAX_CRYSTAL_DROPS = 4;

const valid = (points: PricePoint[]) =>
  points.filter((p) => p.price > 0 && Number.isFinite(p.price)).sort((a, b) => a.t - b.t);

/** Price in effect at time `t` (unix s): the last point at or before it, else null. */
export function priceAt(points: PricePoint[], t: number): number | null {
  let out: number | null = null;
  for (const p of valid(points)) {
    if (p.t > t) break;
    out = p.price;
  }
  return out;
}

/**
 * The part of a series from `t` on: the price in effect at `t` (when known) followed
 * by every later point.
 */
export function seriesSince(points: PricePoint[], t: number): PricePoint[] {
  const pts = valid(points);
  const start = priceAt(pts, t);
  const after = pts.filter((p) => p.t > t);
  return start === null ? after : [{ t, price: start }, ...after];
}

/**
 * Peak-to-trough drops of at least `minDepth` percent. A drop is `recovered` once
 * the price climbs back to the peak it fell from; the last one may still be open.
 * `at` is the peak time in unix ms.
 */
export function findDrawdowns(points: PricePoint[], minDepth: number, symbol?: string): Drawdown[] {
  const pts = valid(points);
  const out: Drawdown[] = [];
  if (pts.length < 2) return out;
  let peak = pts[0]!;
  let trough = peak.price;
  const push = (recovered: boolean) => {
    const depth = ((peak.price - trough) / peak.price) * 100;
    if (depth >= minDepth) out.push({ depth: Math.round(depth * 10) / 10, recovered, at: peak.t * 1000, ...(symbol ? { symbol } : {}) });
  };
  for (const p of pts.slice(1)) {
    if (p.price >= peak.price) {
      push(true);
      peak = p;
      trough = p.price;
    } else if (p.price < trough) {
      trough = p.price;
    }
  }
  push(false);
  return out;
}

/**
 * A crystal's history from real prices since `sinceSec` (its forge time): per holding,
 * its deepest recovered drop (a gold seam) and its open drop (a crack), if any; then
 * the deepest `max` overall.
 */
export function crystalHistory(
  seriesBySymbol: Map<string, PricePoint[]>,
  sinceSec: number,
  { minDepth = LIVE_CRACK_THRESHOLD, max = MAX_CRYSTAL_DROPS }: { minDepth?: number; max?: number } = {},
): CrystalHistory {
  const picked: Drawdown[] = [];
  for (const [symbol, points] of seriesBySymbol) {
    const drops = findDrawdowns(seriesSince(points, sinceSec), minDepth, symbol);
    const deepestRecovered = drops.filter((d) => d.recovered).sort((a, b) => b.depth - a.depth)[0];
    const open = drops.find((d) => !d.recovered);
    if (deepestRecovered) picked.push(deepestRecovered);
    if (open) picked.push(open);
  }
  return { drawdowns: picked.sort((a, b) => b.depth - a.depth).slice(0, max) };
}
