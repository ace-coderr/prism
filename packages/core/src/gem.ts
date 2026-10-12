/**
 * The Home hero's "living gem": every colored crown facet is one real review from PrismReviews
 * (the latest current ones, up to GEM_MAX_FACETS). Shared by the 3D scene and its still SVG
 * fallback, so both draw the same gem. Facets without a review stay clear glass: never faked.
 */
import type { Address } from 'viem';
import { PALETTE, mix } from './brand';
import type { ReviewView } from './reviews';
import type { ReviewState } from './scoring';

export const GEM_MAX_FACETS = 24;
/** The fewest crown facets the gem has (a hexagon, like the mark); extra ones are clear glass. */
export const GEM_MIN_FACETS = 6;

/** What the gem needs to know about one review. */
export interface GemFacet {
  id: number;
  author: Address;
  symbol: string;
  rating: number;
  state: ReviewState;
  /** days held so far, or (SOLD) days between reviewing and selling */
  days: number;
  /** the reviewer's position as a share of supply (null: unknown) */
  share: number | null;
}

export const toGemFacet = (v: ReviewView): GemFacet => ({
  id: v.id,
  author: v.author,
  symbol: v.symbol,
  rating: v.rating,
  state: v.state,
  days: v.days,
  share: v.supplyShare,
});

/** The latest current reviews (not replaced by a newer one from the same holder), newest first. */
export function gemFacets(current: readonly ReviewView[], max = GEM_MAX_FACETS): GemFacet[] {
  return [...current]
    .filter((v) => v.state.kind !== 'replaced')
    .sort((a, b) => b.id - a.id)
    .slice(0, max)
    .map(toGemFacet);
}

export const GEM_GLASS = '#cfe3ea';

/** 5–4 lime / green, 3 amber, 2–1 coral / red; SOLD dark grey; trimmed dimmer. */
export function facetColor(f: Pick<GemFacet, 'rating' | 'state'>): string {
  if (f.state.kind === 'sold') return PALETTE.sold;
  const base = f.rating >= 5 ? PALETTE.lime : f.rating === 4 ? PALETTE.up : f.rating === 3 ? PALETTE.gold : f.rating === 2 ? PALETTE.coral : PALETTE.down;
  return f.state.kind === 'trimmed' ? mix(base, PALETTE.ink, 0.45) : base;
}

/**
 * Facet widths from the reviewers' positions: the biggest position gets 2.5× the angle of the
 * smallest (log scale, since positions span orders of magnitude). Unknown positions get the smallest.
 */
export function facetWeights(facets: readonly Pick<GemFacet, 'share'>[]): number[] {
  const logs = facets.map((f) => (f.share && f.share > 0 ? Math.log10(f.share) : null));
  const known = logs.filter((l): l is number => l !== null);
  if (known.length === 0) return facets.map(() => 1);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  return logs.map((l) => (l === null ? 0.6 : hi === lo ? 1 : 0.6 + 0.9 * ((l - lo) / (hi - lo))));
}

/** One crown facet seen from above: a slice of the girdle from angle a0 to a1 (radians, clockwise from the top). */
export interface GemSegment {
  facet: GemFacet | null;
  a0: number;
  a1: number;
}

/** The crown's slices: one per review (sized by position), padded with glass up to GEM_MIN_FACETS. */
export function gemSegments(facets: readonly GemFacet[]): GemSegment[] {
  const weights = facetWeights(facets);
  const avg = weights.length ? weights.reduce((s, w) => s + w, 0) / weights.length : 1;
  const slots: Array<{ facet: GemFacet | null; w: number }> = facets.map((facet, i) => ({ facet, w: weights[i]! }));
  // spread the glass between the reviews rather than bunching it on one side
  const pad = Math.max(0, GEM_MIN_FACETS - slots.length);
  for (let k = 0; k < pad; k++) slots.splice(Math.round(((k + 1) * (slots.length + 1)) / (pad + 1)), 0, { facet: null, w: avg });
  const total = slots.reduce((s, x) => s + x.w, 0);
  let a = -Math.PI / 2 - (Math.PI * 2 * slots[0]!.w) / total / 2; // the first facet centred at the top
  return slots.map(({ facet, w }) => {
    const a0 = a;
    a += (Math.PI * 2 * w) / total;
    return { facet, a0, a1: a };
  });
}

/** Where the table (the flat top) ends, as a share of the girdle radius. */
export const GEM_TABLE = 0.5;

/**
 * A point on a crown facet, seen from above (unit girdle radius): `t` 0 at the girdle edge to 1 at
 * the table edge, `s` -1..1 across. The facet is a flat trapezoid, so the 3D scene uses the same
 * blend of its own corners.
 */
export function facetPoint(seg: Pick<GemSegment, 'a0' | 'a1'>, t: number, s: number): [number, number] {
  const u = (s + 1) / 2;
  const gx = Math.cos(seg.a0) + (Math.cos(seg.a1) - Math.cos(seg.a0)) * u;
  const gy = Math.sin(seg.a0) + (Math.sin(seg.a1) - Math.sin(seg.a0)) * u;
  const k = 1 + (GEM_TABLE - 1) * t;
  return [gx * k, gy * k];
}

/**
 * A crack across a SOLD facet as (t, s) points (see facetPoint): a jagged line from near the girdle
 * to near the table, wandering a little, the same for a review every time it's drawn.
 */
export function crackPath(seed: number): Array<[number, number]> {
  const rnd = (i: number) => {
    const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  };
  const steps = 9;
  let s = rnd(0) * 0.5;
  return Array.from({ length: steps + 1 }, (_, i): [number, number] => {
    if (i > 0) s = Math.max(-0.6, Math.min(0.6, s + (i % 2 ? 1 : -1) * (0.08 + Math.abs(rnd(i)) * 0.3) + rnd(i + 20) * 0.1));
    return [0.06 + 0.84 * (i / steps), s];
  });
}
