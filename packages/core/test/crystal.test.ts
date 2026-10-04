import { describe, expect, it } from 'vitest';
import {
  buildCrystal,
  changeColor,
  exposedVoxels,
  groupByCorrelation,
  KINTSUGI_GOLD,
  NO_DATA_COLOR,
  normalizeHoldings,
  type CrystalGeometry,
  type Holding,
} from '../src';
import { distance, hexToRgb } from '../src/math';

const basket: Holding[] = [
  { symbol: 'NVDA', weight: 0.4, change24h: 4.2, volatility: 0.8 },
  { symbol: 'AAPL', weight: 0.3, change24h: -1.1, volatility: 0.3 },
  { symbol: 'ETH', weight: 0.2, change24h: -9.5, volatility: 0.9 },
  { symbol: 'MSFT', weight: 0.1, change24h: 0.4, volatility: 0.2 },
];

const key = (p: number[]) => p.join(',');
const countCluster = (geo: CrystalGeometry, i: number) => geo.voxels.filter((v) => v.cluster === i).length;

/** Furthest facet cube from the origin, for a cluster — how far its spire reaches. */
const reach = (geo: CrystalGeometry, i: number) =>
  Math.max(...geo.voxels.filter((v) => v.cluster === i && v.kind === 'facet').map((v) => Math.hypot(...v.position)));

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

describe('buildCrystal (voxels)', () => {
  it('snaps every voxel to a unique integer grid cell', () => {
    const geo = buildCrystal(basket);
    expect(geo.voxels.length).toBeGreaterThan(50);
    const seen = new Set<string>();
    for (const v of geo.voxels) {
      for (const c of v.position) expect(Number.isInteger(c)).toBe(true);
      expect(seen.has(key(v.position))).toBe(false);
      seen.add(key(v.position));
    }
  });

  it('creates one cluster per holding, each with its own cubes', () => {
    const geo = buildCrystal(basket);
    expect(geo.clusters.map((c) => c.symbol)).toEqual(['NVDA', 'AAPL', 'ETH', 'MSFT']);
    for (let i = 0; i < basket.length; i++) {
      expect(geo.voxels.some((v) => v.cluster === i && v.kind === 'facet')).toBe(true);
    }
  });

  it('cluster volume grows with weight', () => {
    const geo = buildCrystal(basket);
    const [nvda, , , msft] = geo.clusters;
    expect(nvda!.size ** 3 / msft!.size ** 3).toBeCloseTo(0.4 / 0.1, 5);
    expect(countCluster(geo, 0)).toBeGreaterThan(countCluster(geo, 3));
  });

  it('colors gains green and losses red', () => {
    const geo = buildCrystal(basket);
    const [r1, g1] = hexToRgb(geo.clusters[0]!.color); // NVDA +4.2
    const [r2, g2] = hexToRgb(geo.clusters[2]!.color); // ETH -9.5
    expect(g1).toBeGreaterThan(r1);
    expect(r2).toBeGreaterThan(g2);
    // every non-gold cube carries its cluster's (or a bridge's) color
    for (const v of geo.voxels.filter((x) => x.kind === 'facet')) {
      expect(v.color).toBe(geo.clusters[v.cluster]!.color);
    }
  });

  it('bigger moves give deeper, more saturated colors', () => {
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

  it('renders unknown change (no price feed) as neutral grey, not a guessed color', () => {
    expect(changeColor(Number.NaN)).toEqual({ color: NO_DATA_COLOR, intensity: 0 });
  });

  it('volatility makes taller, spikier columns', () => {
    const calm: Holding[] = [
      { symbol: 'A', weight: 0.5, change24h: 1, volatility: 0.1 },
      { symbol: 'B', weight: 0.5, change24h: 1, volatility: 0.95 },
    ];
    const geo = buildCrystal(calm);
    expect(geo.clusters[1]!.spikiness).toBeCloseTo(0.95);
    expect(reach(geo, 1)).toBeGreaterThan(reach(geo, 0));
  });

  it('is deterministic', () => {
    expect(buildCrystal(basket)).toEqual(buildCrystal(basket));
  });

  it('respects resolution and stays light for big baskets', () => {
    const many: Holding[] = Array.from({ length: 30 }, (_, i) => ({
      symbol: `T${i}`,
      weight: 1,
      change24h: i - 15,
      volatility: (i % 10) / 10,
    }));
    const geo = buildCrystal(many, undefined, { maxShards: 48, resolution: 8 });
    expect(geo.radius).toBeLessThanOrEqual(10);
    expect(geo.voxels.length).toBeLessThan(4000);
    const fine = buildCrystal(basket, undefined, { resolution: 12 });
    expect(fine.voxels.length).toBeGreaterThan(buildCrystal(basket).voxels.length);
  });

  it('handles empty input', () => {
    const geo = buildCrystal([]);
    expect(geo.voxels).toEqual([]);
    expect(geo.clusters).toEqual([]);
  });
});

describe('exposedVoxels', () => {
  it('drops fully enclosed cubes only', () => {
    const geo = buildCrystal(basket);
    const shell = exposedVoxels(geo.voxels);
    expect(shell.length).toBeLessThan(geo.voxels.length);
    expect(shell.length).toBeGreaterThan(0);
    // a solid 3×3×3 block exposes 26 of 27
    const block = [];
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++)
        for (let z = 0; z < 3; z++)
          block.push({ position: [x, y, z] as [number, number, number], color: '#fff', kind: 'core' as const, cluster: 0, gold: false });
    expect(exposedVoxels(block)).toHaveLength(26);
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
    const m: number[][] = six.map((_, i) => six.map((__, j) => (i === j ? 1 : 0)));
    m[1]![4] = 0.9;
    const geo = buildCrystal(six, undefined, { correlation: m });
    expect(geo.fusions).toEqual([['B', 'E']]);
    expect(geo.clusters[1]!.fusedWith).toEqual(['E']);
    expect(geo.voxels.some((v) => v.kind === 'bridge')).toBe(true);
  });

  it('places correlated holdings adjacent', () => {
    const geo = buildCrystal(six, undefined, { correlation: { A: { D: 0.9 } } });
    const dirs = geo.clusters.map((c) => c.direction);
    const dAD = distance(dirs[0]!, dirs[3]!);
    for (const other of [1, 2, 4, 5]) {
      expect(dAD).toBeLessThan(distance(dirs[0]!, dirs[other]!));
    }
  });

  it('fuses correlated holdings into one connected block outside the core', () => {
    const geo = buildCrystal(six, undefined, { correlation: { A: { D: 0.9 } } });
    // flood-fill through A, D and bridge cubes only — never through the core
    const allowed = new Map(
      geo.voxels
        .filter((v) => v.kind !== 'core' && (v.cluster === 0 || v.cluster === 3 || v.kind === 'bridge'))
        .map((v) => [key(v.position), v]),
    );
    const starts = geo.voxels.filter((v) => v.cluster === 0 && v.kind === 'facet');
    const seen = new Set(starts.map((v) => key(v.position)));
    const queue = starts.map((v) => v.position);
    while (queue.length) {
      const [x, y, z] = queue.pop()!;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = key([x + dx!, y + dy!, z + dz!]);
        if (allowed.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(allowed.get(k)!.position);
        }
      }
    }
    const reached = [...seen].some((k) => allowed.get(k)?.cluster === 3);
    expect(reached).toBe(true);
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
    expect(geo.cracks.map((c) => c.depth)).toEqual([22, 31]);
    expect(buildCrystal(basket, { drawdowns: [{ depth: 15, recovered: false }] }).voxels).toEqual(
      buildCrystal(basket).voxels,
    );
  });

  it('open cracks are gaps: their cubes are removed', () => {
    const clean = buildCrystal(basket);
    const cracked = buildCrystal(basket, { drawdowns: [{ depth: 30, recovered: false, symbol: 'NVDA' }] });
    const crack = cracked.cracks[0]!;
    expect(crack.gold).toBe(false);
    expect(crack.cells.length).toBeGreaterThan(3);
    expect(cracked.voxels.length).toBe(clean.voxels.length - crack.cells.length);
    const remaining = new Set(cracked.voxels.map((v) => key(v.position)));
    for (const c of crack.cells) expect(remaining.has(key(c))).toBe(false);
  });

  it('recovered cracks are filled with gold cubes', () => {
    const clean = buildCrystal(basket);
    const healed = buildCrystal(basket, { drawdowns: [{ depth: 30, recovered: true, symbol: 'NVDA' }] });
    const crack = healed.cracks[0]!;
    expect(crack.gold).toBe(true);
    expect(healed.voxels.length).toBe(clean.voxels.length);
    const gold = healed.voxels.filter((v) => v.gold);
    expect(gold.length).toBe(crack.cells.length);
    for (const v of gold) expect(v.color).toBe(KINTSUGI_GOLD);
  });

  it('cracks run through their holding', () => {
    const geo = buildCrystal(basket, { drawdowns: [{ depth: 30, recovered: true, symbol: 'AAPL' }] });
    const gold = geo.voxels.filter((v) => v.gold);
    const onAapl = gold.filter((v) => v.cluster === 1).length;
    expect(onAapl / gold.length).toBeGreaterThan(0.4);
  });

  it('deeper drawdowns make longer cracks', () => {
    const size = (depth: number) =>
      buildCrystal(basket, { drawdowns: [{ depth, recovered: true }] }).cracks[0]!.cells.length;
    expect(size(70)).toBeGreaterThan(size(20));
  });
});
