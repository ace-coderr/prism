import { describe, expect, it } from 'vitest';
import {
  buildCrystal,
  changeColor,
  groupByCorrelation,
  normalizeHoldings,
  type Holding,
} from '../src';
import { distance, hexToRgb, length } from '../src/math';

const basket: Holding[] = [
  { symbol: 'NVDA', weight: 0.4, change24h: 4.2, volatility: 0.8 },
  { symbol: 'AAPL', weight: 0.3, change24h: -1.1, volatility: 0.3 },
  { symbol: 'ETH', weight: 0.2, change24h: -9.5, volatility: 0.9 },
  { symbol: 'MSFT', weight: 0.1, change24h: 0.4, volatility: 0.2 },
];

const avgLength = (geo: ReturnType<typeof buildCrystal>, i: number) => {
  const s = geo.shards.filter((x) => x.cluster === i);
  return s.reduce((a, x) => a + x.scale[1] / x.scale[0], 0) / s.length;
};

describe('normalizeHoldings', () => {
  it('rescales weights to sum to 1 and drops zero weights', () => {
    const out = normalizeHoldings([
      { symbol: 'A', weight: 2, change24h: 0, volatility: 0 },
      { symbol: 'B', weight: 6, change24h: 0, volatility: 0 },
      { symbol: 'C', weight: 0, change24h: 0, volatility: 0 },
    ]);
    expect(out.map((h) => h.symbol)).toEqual(['A', 'B']);
    expect(out[0]!.weight).toBeCloseTo(0.25);
    expect(out[1]!.weight).toBeCloseTo(0.75);
  });
});

describe('buildCrystal', () => {
  it('creates one cluster per holding', () => {
    const geo = buildCrystal(basket);
    expect(geo.clusters.map((c) => c.symbol)).toEqual(['NVDA', 'AAPL', 'ETH', 'MSFT']);
    for (let i = 0; i < basket.length; i++) {
      expect(geo.shards.some((s) => s.cluster === i)).toBe(true);
    }
  });

  it('cluster size grows with weight (volume ∝ weight)', () => {
    const geo = buildCrystal(basket);
    const [nvda, , , msft] = geo.clusters;
    expect(nvda!.size).toBeGreaterThan(msft!.size);
    expect(nvda!.size ** 3 / msft!.size ** 3).toBeCloseTo(0.4 / 0.1, 5);
    // heavier holdings also get more facets
    expect(nvda!.shardCount).toBeGreaterThanOrEqual(msft!.shardCount);
  });

  it('colors gains green and losses red', () => {
    const geo = buildCrystal(basket);
    const [r1, g1] = hexToRgb(geo.clusters[0]!.color); // NVDA +4.2
    const [r2, g2] = hexToRgb(geo.clusters[2]!.color); // ETH -9.5
    expect(g1).toBeGreaterThan(r1);
    expect(r2).toBeGreaterThan(g2);
  });

  it('bigger moves give more intense colors', () => {
    const small = changeColor(0.5);
    const big = changeColor(7);
    expect(big.intensity).toBeGreaterThan(small.intensity);
    const sat = (hex: string) => {
      const c = hexToRgb(hex);
      return Math.max(...c) - Math.min(...c);
    };
    expect(sat(big.color)).toBeGreaterThan(sat(small.color));
    expect(changeColor(-50).intensity).toBe(1);
  });

  it('spikiness follows volatility', () => {
    const geo = buildCrystal(basket);
    expect(geo.clusters[2]!.spikiness).toBeCloseTo(0.9);
    // ETH (vol 0.9) shards are more elongated than MSFT (vol 0.2)
    expect(avgLength(geo, 2)).toBeGreaterThan(avgLength(geo, 3));
  });

  it('is deterministic', () => {
    expect(buildCrystal(basket)).toEqual(buildCrystal(basket));
  });

  it('keeps shards inside the cap and returns finite numbers', () => {
    const many: Holding[] = Array.from({ length: 30 }, (_, i) => ({
      symbol: `T${i}`,
      weight: 1,
      change24h: i - 15,
      volatility: (i % 10) / 10,
    }));
    const geo = buildCrystal(many, undefined, { maxShards: 48 });
    expect(geo.shards.filter((s) => s.kind === 'facet').length).toBeLessThanOrEqual(48);
    for (const s of geo.shards) {
      for (const v of [...s.position, ...s.quaternion, ...s.scale]) expect(Number.isFinite(v)).toBe(true);
      expect(Math.hypot(...s.quaternion)).toBeCloseTo(1, 5);
    }
  });

  it('handles empty input', () => {
    const geo = buildCrystal([]);
    expect(geo.clusters).toEqual([]);
    expect(geo.shards).toEqual([]);
  });
});

describe('correlation fusion', () => {
  const six: Holding[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((symbol) => ({
    symbol,
    weight: 1,
    change24h: 1,
    volatility: 0.5,
  }));

  it('groups holdings above 0.7 correlation (transitively)', () => {
    const { groups } = groupByCorrelation(six, {
      A: { D: 0.85 },
      D: { F: 0.75 },
      B: { C: 0.7 }, // exactly 0.7 is NOT above the threshold
    });
    expect(groups).toEqual([[0, 3, 5], [1], [2], [4]]);
  });

  it('accepts a matrix aligned with holdings order', () => {
    const m = six.map((_, i) => six.map((__, j) => (i === j ? 1 : 0)));
    m[1]![4] = 0.9;
    const geo = buildCrystal(six, undefined, { correlation: m });
    expect(geo.fusions).toEqual([['B', 'E']]);
    expect(geo.clusters[1]!.fusedWith).toEqual(['E']);
    expect(geo.shards.filter((s) => s.kind === 'bridge')).toHaveLength(1);
  });

  it('places correlated holdings adjacent', () => {
    const geo = buildCrystal(six, undefined, { correlation: { A: { D: 0.9 } } });
    const dirs = geo.clusters.map((c) => c.direction);
    const dAD = distance(dirs[0]!, dirs[3]!);
    // A–D must be closer than A is to any uncorrelated holding
    for (const other of [1, 2, 4, 5]) {
      expect(dAD).toBeLessThan(distance(dirs[0]!, dirs[other]!));
    }
  });
});

describe('living crystal (kintsugi)', () => {
  it('only drawdowns deeper than 15% crack the crystal', () => {
    const geo = buildCrystal(basket, {
      drawdowns: [
        { depth: 12, recovered: false },
        { depth: 15, recovered: false },
        { depth: 22, recovered: false, symbol: 'NVDA' },
        { depth: -31, recovered: true, symbol: 'ETH' },
      ],
    });
    expect(geo.cracks).toHaveLength(2);
    expect(geo.cracks.map((c) => c.depth)).toEqual([22, 31]);
  });

  it('recovered drawdowns become gold seams, open ones stay cracks', () => {
    const geo = buildCrystal(basket, {
      drawdowns: [
        { depth: 25, recovered: true },
        { depth: 40, recovered: false },
      ],
    });
    expect(geo.cracks.map((c) => c.gold)).toEqual([true, false]);
  });

  it('crack lines are polylines on the crystal surface near their holding', () => {
    const geo = buildCrystal(basket, { drawdowns: [{ depth: 30, recovered: true, symbol: 'AAPL' }] });
    const crack = geo.cracks[0]!;
    expect(crack.points.length).toBeGreaterThan(4);
    const r = length(crack.points[0]!);
    for (const p of crack.points) expect(length(p)).toBeCloseTo(r, 5);
    // middle of the crack sits over the AAPL cluster
    const mid = crack.points[Math.floor(crack.points.length / 2)]!;
    const dir = geo.clusters[1]!.direction;
    const cos = (mid[0] * dir[0] + mid[1] * dir[1] + mid[2] * dir[2]) / r;
    expect(cos).toBeGreaterThan(0.9);
  });

  it('deeper drawdowns make longer cracks', () => {
    const arc = (depth: number) => {
      const c = buildCrystal(basket, { drawdowns: [{ depth, recovered: false }] }).cracks[0]!;
      return distance(c.points[0]!, c.points[c.points.length - 1]!);
    };
    expect(arc(60)).toBeGreaterThan(arc(20));
  });
});
