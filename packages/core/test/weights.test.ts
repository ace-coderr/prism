import { describe, expect, it } from 'vitest';
import { evenWeights, normalizeTo100, rebalance, totalOf } from '../src';

describe('evenWeights', () => {
  it('always sums to 100', () => {
    for (let n = 1; n <= 12; n++) expect(totalOf(evenWeights(n))).toBe(100);
    expect(evenWeights(3)).toEqual([34, 33, 33]);
  });
});

describe('rebalance', () => {
  it('keeps the total at 100 and sets the moved slider exactly', () => {
    const out = rebalance([50, 30, 20], 0, 70);
    expect(out[0]).toBe(70);
    expect(totalOf(out)).toBe(100);
    expect(out).toEqual([70, 18, 12]);
  });

  it('spreads evenly when the others are zero', () => {
    expect(rebalance([100, 0, 0], 0, 40)).toEqual([40, 30, 30]);
  });

  it('clamps and never goes negative', () => {
    const out = rebalance([20, 40, 40], 2, 150);
    expect(out).toEqual([0, 0, 100]);
    for (let v = 0; v <= 100; v += 7) {
      const r = rebalance([13, 29, 41, 17], 1, v);
      expect(totalOf(r)).toBe(100);
      expect(r.every((w) => w >= 0 && Number.isInteger(w))).toBe(true);
    }
  });
});

describe('normalizeTo100', () => {
  it('rescales to integers totalling 100', () => {
    expect(normalizeTo100([1, 1, 1])).toEqual([34, 33, 33]);
    expect(normalizeTo100([30, 30])).toEqual([50, 50]);
    expect(normalizeTo100([0, 0])).toEqual([50, 50]);
    expect(totalOf(normalizeTo100([17, 3, 9, 41]))).toBe(100);
  });
});
