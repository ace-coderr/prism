import { describe, expect, it } from 'vitest';
import { GEM_MIN_FACETS, MARK_FACETS, PALETTE, crackPath, facetColor, facetPoint, facetWeights, gemSegments, markShapes, type GemFacet } from '../src';

const facet = (id: number, rating: number, state: GemFacet['state'] = { kind: 'holding' }, share: number | null = 0.001): GemFacet => ({
  id,
  author: '0x0000000000000000000000000000000000000001',
  symbol: 'X',
  rating,
  state,
  days: 3,
  share,
});

describe('the mark', () => {
  it('is a hexagon of 6 facets: five colors and one dark "sold" facet', () => {
    expect(MARK_FACETS).toHaveLength(6);
    expect(MARK_FACETS.filter((c) => c === PALETTE.sold)).toHaveLength(1);
    const svg = markShapes();
    expect(svg.match(/<path d="M32 32L/g)).toHaveLength(6);
    expect(markShapes({ tile: true })).toContain('<rect');
  });
});

describe('the living gem', () => {
  it('colors facets by rating; SOLD goes grey, trimmed dimmer', () => {
    expect(facetColor(facet(1, 5))).toBe(PALETTE.lime);
    expect(facetColor(facet(1, 4))).toBe(PALETTE.up);
    expect(facetColor(facet(1, 3))).toBe(PALETTE.gold);
    expect(facetColor(facet(1, 2))).toBe(PALETTE.coral);
    expect(facetColor(facet(1, 1))).toBe(PALETTE.down);
    expect(facetColor(facet(1, 5, { kind: 'sold', marked: true }))).toBe(PALETTE.sold);
    expect(facetColor(facet(1, 5, { kind: 'trimmed', percent: 30 }))).not.toBe(PALETTE.lime);
  });

  it('sizes facets by position, never faking any', () => {
    const w = facetWeights([facet(1, 5, undefined, 0.1), facet(2, 5, undefined, 0.0001), facet(3, 5, undefined, null)]);
    expect(w[0]).toBeGreaterThan(w[1]!);
    expect(w[1]).toBe(w[2]); // unknown = smallest
    // fewer reviews than a hexagon: the rest is clear glass
    const two = gemSegments([facet(1, 5), facet(2, 3)]);
    expect(two).toHaveLength(GEM_MIN_FACETS);
    expect(two.filter((s) => s.facet)).toHaveLength(2);
    // no reviews: all glass
    expect(gemSegments([]).every((s) => s.facet === null)).toBe(true);
    // many: one facet per review, the full circle
    const many = gemSegments(Array.from({ length: 24 }, (_, i) => facet(i, 4)));
    expect(many).toHaveLength(24);
    expect(many.at(-1)!.a1 - many[0]!.a0).toBeCloseTo(Math.PI * 2, 9);
  });

  it('keeps cracks inside their facet', () => {
    for (const seg of gemSegments([facet(1, 5), facet(2, 4, undefined, 0.5)])) {
      for (const [t, s] of crackPath(7)) {
        const [x, y] = facetPoint(seg, t, s);
        const r = Math.hypot(x, y);
        expect(r).toBeLessThanOrEqual(1);
        let a = Math.atan2(y, x);
        while (a < seg.a0) a += Math.PI * 2;
        expect(a).toBeLessThanOrEqual(seg.a1 + 1e-9);
      }
    }
  });
});
