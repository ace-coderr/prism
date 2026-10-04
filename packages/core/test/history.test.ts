import { describe, expect, it } from 'vitest';
import { buildCrystal, crystalHistory, findDrawdowns, priceAt, seriesSince, type PricePoint } from '../src';

const series = (...prices: number[]): PricePoint[] => prices.map((price, i) => ({ t: i * 3600, price }));

describe('findDrawdowns', () => {
  it('finds a drop that later climbed back to its peak (recovered)', () => {
    const d = findDrawdowns(series(100, 90, 80, 95, 101), 5);
    expect(d).toEqual([{ depth: 20, recovered: true, at: 0 }]);
  });

  it('leaves the last drop open while the price is still below its peak', () => {
    const d = findDrawdowns(series(100, 110, 99, 104), 5, 'NVDA');
    expect(d).toEqual([{ depth: 10, recovered: false, at: 3600_000, symbol: 'NVDA' }]);
  });

  it('ignores drops smaller than the threshold and needs at least two points', () => {
    expect(findDrawdowns(series(100, 97, 101), 5)).toEqual([]);
    expect(findDrawdowns(series(100), 0)).toEqual([]);
    expect(findDrawdowns(series(100, 100, 100), 0.1)).toEqual([]);
  });

  it('finds several drops in order', () => {
    const d = findDrawdowns(series(100, 80, 100, 120, 108, 125, 100), 5);
    expect(d.map((x) => [x.depth, x.recovered])).toEqual([
      [20, true],
      [10, true],
      [20, false],
    ]);
  });
});

describe('priceAt / seriesSince', () => {
  const pts = series(10, 11, 12);
  it('reads the price in effect at a time', () => {
    expect(priceAt(pts, -1)).toBeNull();
    expect(priceAt(pts, 0)).toBe(10);
    expect(priceAt(pts, 5000)).toBe(11);
    expect(priceAt(pts, 99999)).toBe(12);
  });
  it('starts a series at the price in effect at the given time', () => {
    expect(seriesSince(pts, 5000)).toEqual([
      { t: 5000, price: 11 },
      { t: 7200, price: 12 },
    ]);
  });
});

describe('crystalHistory', () => {
  it('only counts drops after the forge time', () => {
    const s = new Map([['NVDA', series(100, 70, 100, 95, 99)]]);
    expect(crystalHistory(s, 0).drawdowns.map((d) => d.depth)).toEqual([30, 5]);
    // forged after the big drop: only the small open one is left (5% ≥ threshold)
    expect(crystalHistory(s, 2 * 3600).drawdowns).toEqual([{ depth: 5, recovered: false, at: 7200_000, symbol: 'NVDA' }]);
    expect(crystalHistory(s, 3 * 3600).drawdowns).toEqual([]);
  });

  it('keeps the deepest recovered drop and the open one per holding, capped overall', () => {
    const s = new Map([
      ['A', series(100, 90, 100, 80, 100, 94)],
      ['B', series(100, 60, 100)],
      ['C', series(100, 50)],
    ]);
    const h = crystalHistory(s, 0, { max: 3 });
    expect(h.drawdowns.map((d) => `${d.symbol}:${d.depth}:${d.recovered}`)).toEqual(['C:50:false', 'B:40:true', 'A:20:true']);
  });

  it('feeds buildCrystal: recovered drops become gold, with a lower live threshold', () => {
    const basket = [
      { symbol: 'A', weight: 0.5, change24h: 1, volatility: 0.2 },
      { symbol: 'B', weight: 0.5, change24h: -1, volatility: 0.2 },
    ];
    const history = crystalHistory(new Map([['A', series(100, 92, 100)]]), 0);
    expect(buildCrystal(basket, history).cracks).toHaveLength(0); // default threshold: 15%
    const geo = buildCrystal(basket, history, { crackThreshold: 5 });
    expect(geo.cracks).toHaveLength(1);
    expect(geo.voxels.some((v) => v.gold)).toBe(true);
  });
});
