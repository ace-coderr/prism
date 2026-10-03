/**
 * Weight helpers for the Forge: whole-number percentages that always total 100.
 */

export const TOTAL = 100;

export function totalOf(weights: number[]): number {
  return weights.reduce((s, w) => s + w, 0);
}

/** Split 100 evenly across `n` holdings (remainder goes to the first ones). */
export function evenWeights(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(TOTAL / n);
  const rem = TOTAL - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * Set weight `index` to `value` and redistribute the difference across the
 * other holdings proportionally to their current weights, so the total stays 100.
 * All results are non-negative integers.
 */
export function rebalance(weights: number[], index: number, value: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [TOTAL];
  const target = Math.round(Math.min(TOTAL, Math.max(0, value)));
  const others = weights.map((w, i) => (i === index ? 0 : Math.max(0, w)));
  const othersTotal = totalOf(others);
  const remaining = TOTAL - target;

  // proportional share (even split if the others are all zero)
  const raw = others.map((w, i) =>
    i === index ? 0 : othersTotal > 0 ? (w / othersTotal) * remaining : remaining / (n - 1),
  );
  const out = raw.map(Math.floor);
  out[index] = target;

  // hand out rounding leftovers by largest fractional part
  let leftover = TOTAL - totalOf(out);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .filter(({ i }) => i !== index)
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; leftover > 0; k = (k + 1) % order.length, leftover--) {
    out[order[k]!.i]! += 1;
  }
  return out;
}

/** Scale arbitrary non-negative weights to integers summing to 100 (largest remainder). */
export function normalizeTo100(weights: number[]): number[] {
  if (weights.length === 0) return [];
  const clean = weights.map((w) => Math.max(0, w));
  const total = totalOf(clean);
  if (total <= 0) return evenWeights(weights.length);
  const raw = clean.map((w) => (w / total) * TOTAL);
  const out = raw.map(Math.floor);
  let leftover = TOTAL - totalOf(out);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; leftover > 0; k++, leftover--) out[order[k % order.length]!.i]! += 1;
  return out;
}
