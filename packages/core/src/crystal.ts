import {
  type Quat,
  type Vec3,
  add,
  clamp,
  fibonacciSphere,
  hashString,
  hslToHex,
  length,
  mixHex,
  normalize,
  quatFromUp,
  rng,
  scale,
  tangentBasis,
  tilt,
} from './math';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface Holding {
  symbol: string;
  /** Portfolio weight in [0, 1]. Weights are re-normalized to sum to 1. */
  weight: number;
  /** 24h price change in percent, e.g. 3.2 or -7.5. */
  change24h: number;
  /** Volatility in [0, 1]. Drives spikiness. */
  volatility: number;
}

export interface Drawdown {
  /** Peak-to-trough drop in percent. Sign is ignored (22 and -22 are the same). */
  depth: number;
  /** True once the position climbed back to its previous peak. */
  recovered: boolean;
  /** Holding the drawdown belongs to. Omit for a basket-wide drawdown. */
  symbol?: string;
  /** Optional unix ms timestamp, carried through untouched. */
  at?: number;
}

export interface CrystalHistory {
  drawdowns: Drawdown[];
}

/**
 * Pairwise correlations. Either a matrix aligned with the `holdings` array order,
 * or a symbol-keyed map (`{ AAPL: { MSFT: 0.82 } }`, either direction is enough).
 */
export type CorrelationInput = number[][] | Record<string, Record<string, number>>;

export interface BuildCrystalOptions {
  correlation?: CorrelationInput;
  /** Hard cap on facet shards across the whole crystal (keeps mobile cheap). */
  maxShards?: number;
}

// ---------------------------------------------------------------------------
// Outputs (plain data — no three.js types)
// ---------------------------------------------------------------------------

export interface Shard {
  kind: 'facet' | 'bridge';
  /** Index into `clusters`, or -1 for bridges between fused clusters. */
  cluster: number;
  position: Vec3;
  /** Rotation that maps the unit shard's +Y axis outward. [x, y, z, w]. */
  quaternion: Quat;
  /** [width, length, width] applied to a unit (1×1×1) crystal point. */
  scale: Vec3;
  color: string;
}

export interface Cluster {
  symbol: string;
  weight: number;
  direction: Vec3;
  /** Linear size. Volume (size³) is proportional to weight. */
  size: number;
  color: string;
  /** 0..1 strength of the color, from |change24h|. */
  intensity: number;
  /** 0..1, from volatility. */
  spikiness: number;
  /** Symbols this cluster is fused with (correlation > threshold). */
  fusedWith: string[];
  shardCount: number;
}

export interface Crack {
  symbol?: string;
  depth: number;
  /** Recovered drawdowns are rendered as gold kintsugi seams. */
  gold: boolean;
  points: Vec3[];
}

export interface CrystalGeometry {
  core: { radius: number; color: string };
  clusters: Cluster[];
  shards: Shard[];
  cracks: Crack[];
  fusions: Array<[string, string]>;
  boundingRadius: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const CORRELATION_THRESHOLD = 0.7;
export const CRACK_THRESHOLD = 15; // percent
export const CORE_RADIUS = 0.55;
const BASE_SIZE = 1.15;
const DEFAULT_MAX_SHARDS = 64;
const COLOR_FULL_MOVE = 8; // a ±8% day saturates the color
const GOLD = '#f5c451';

// ---------------------------------------------------------------------------
// Pieces (exported for tests and UI reuse)
// ---------------------------------------------------------------------------

/** Drop non-positive weights and scale the rest to sum to 1. */
export function normalizeHoldings(holdings: Holding[]): Holding[] {
  const valid = holdings.filter((h) => Number.isFinite(h.weight) && h.weight > 0);
  const total = valid.reduce((s, h) => s + h.weight, 0);
  if (total <= 0) return [];
  return valid.map((h) => ({ ...h, weight: h.weight / total }));
}

/** Green shades for gains, red for losses; a bigger move gives a deeper, more saturated color. */
export function changeColor(change24h: number): { color: string; intensity: number } {
  const intensity = clamp(Math.abs(change24h) / COLOR_FULL_MOVE, 0, 1);
  const hue = change24h >= 0 ? 148 : 355;
  const sat = 0.35 + 0.6 * intensity;
  const light = 0.8 - 0.32 * intensity;
  return { color: hslToHex(hue, sat, light), intensity };
}

function correlationLookup(holdings: Holding[], input?: CorrelationInput) {
  return (i: number, j: number): number => {
    if (!input) return 0;
    if (Array.isArray(input)) return input[i]?.[j] ?? input[j]?.[i] ?? 0;
    const a = holdings[i]!.symbol;
    const b = holdings[j]!.symbol;
    return input[a]?.[b] ?? input[b]?.[a] ?? 0;
  };
}

/**
 * Group holdings whose correlation exceeds the threshold (transitively).
 * Returns groups of indices in first-appearance order, plus the direct fused edges.
 */
export function groupByCorrelation(
  holdings: Holding[],
  correlation?: CorrelationInput,
  threshold = CORRELATION_THRESHOLD,
): { groups: number[][]; edges: Array<[number, number]> } {
  const n = holdings.length;
  const parent = holdings.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const corr = correlationLookup(holdings, correlation);
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (corr(i, j) > threshold) {
        edges.push([i, j]);
        parent[find(j)] = find(i);
      }
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(i);
  }
  return { groups: [...byRoot.values()], edges };
}

// ---------------------------------------------------------------------------
// buildCrystal
// ---------------------------------------------------------------------------

export function buildCrystal(
  holdingsIn: Holding[],
  history?: CrystalHistory,
  options: BuildCrystalOptions = {},
): CrystalGeometry {
  const holdings = normalizeHoldings(holdingsIn);
  const maxShards = options.maxShards ?? DEFAULT_MAX_SHARDS;
  const { groups, edges } = groupByCorrelation(holdings, options.correlation);

  // 1. Directions: one anchor per correlation group; members of a group sit
  //    in a tight ring around their anchor so they touch / fuse.
  const directions: Vec3[] = new Array(holdings.length);
  const anchors = fibonacciSphere(groups.length).map((d, gi) =>
    // a small deterministic tilt so 1–2 group crystals don't look axis-aligned
    groups.length <= 2 ? tilt(d, 0.35, gi * 2.1) : d,
  );
  groups.forEach((members, gi) => {
    const anchor = anchors[gi]!;
    if (members.length === 1) {
      directions[members[0]!] = anchor;
      return;
    }
    const ring = 0.28 + 0.05 * members.length;
    members.forEach((m, k) => {
      directions[m] = tilt(anchor, ring, (k / members.length) * Math.PI * 2);
    });
  });

  // 2. Shard budget, proportional to weight (at least 2 each).
  const rawCounts = holdings.map((h) => clamp(Math.round(3 + h.weight * 14), 2, 10));
  const rawTotal = rawCounts.reduce((s, c) => s + c, 0);
  const budgetScale = rawTotal > maxShards ? maxShards / rawTotal : 1;
  const counts = rawCounts.map((c) => Math.max(1, Math.floor(c * budgetScale)));

  // 3. Clusters + facet shards.
  const fusedWith: string[][] = holdings.map(() => []);
  for (const [i, j] of edges) {
    fusedWith[i]!.push(holdings[j]!.symbol);
    fusedWith[j]!.push(holdings[i]!.symbol);
  }

  const clusters: Cluster[] = [];
  const shards: Shard[] = [];
  const dims: Array<{ len: number; width: number }> = [];

  holdings.forEach((h, i) => {
    const dir = directions[i]!;
    const spikiness = clamp(h.volatility, 0, 1);
    const { color, intensity } = changeColor(h.change24h);
    const size = BASE_SIZE * Math.cbrt(h.weight);
    const elongation = 1.15 + 1.9 * spikiness;
    const baseWidth = size * 0.62 * (1 - 0.4 * spikiness);
    const spread = 0.3 + 1.0 * Math.sqrt(h.weight) * (0.7 + 0.3 * spikiness);
    const rand = rng(hashString(h.symbol));

    clusters.push({
      symbol: h.symbol,
      weight: h.weight,
      direction: dir,
      size,
      color,
      intensity,
      spikiness,
      fusedWith: fusedWith[i]!,
      shardCount: counts[i]!,
    });
    dims.push({ len: size * elongation, width: baseWidth });

    for (let s = 0; s < counts[i]!; s++) {
      // first shard is the cluster's main spire, the rest fan out around it
      const a = rand();
      const b = rand();
      const c = rand();
      const d = rand();
      const sdir = s === 0 ? dir : tilt(dir, spread * (0.35 + 0.65 * a), b * Math.PI * 2);
      const lenJitter = s === 0 ? 1 : 0.55 + 0.4 * c;
      const len = size * elongation * lenJitter;
      const width = baseWidth * (s === 0 ? 1 : 0.6 + 0.35 * d);
      shards.push({
        kind: 'facet',
        cluster: i,
        position: scale(sdir, CORE_RADIUS * 0.55 + len * 0.5),
        quaternion: quatFromUp(sdir, d * Math.PI),
        scale: [width, len, width],
        color,
      });
    }
  });

  // 4. Bridges: fused (highly correlated) neighbours share a crystal between them.
  const fusions: Array<[string, string]> = [];
  for (const [i, j] of edges) {
    const ci = clusters[i]!;
    const cj = clusters[j]!;
    fusions.push([ci.symbol, cj.symbol]);
    const dir = normalize(add(ci.direction, cj.direction));
    const len = ((dims[i]!.len + dims[j]!.len) / 2) * 0.8;
    const width = ((dims[i]!.width + dims[j]!.width) / 2) * 0.9;
    shards.push({
      kind: 'bridge',
      cluster: -1,
      position: scale(dir, CORE_RADIUS * 0.55 + len * 0.5),
      quaternion: quatFromUp(dir, 0.5),
      scale: [width, len, width],
      color: mixHex(ci.color, cj.color),
    });
  }

  // 5. Living crystal: deep drawdowns crack it; recovered ones heal in gold.
  const cracks: Crack[] = (history?.drawdowns ?? [])
    .filter((d) => Math.abs(d.depth) > CRACK_THRESHOLD)
    .map((d, k) => buildCrack(d, k, clusters));

  const boundingRadius = shards.reduce((m, s) => {
    return Math.max(m, length(s.position) + s.scale[1] * 0.5);
  }, CORE_RADIUS);

  const coreColor = clusters.length
    ? clusters.reduce((acc, c, i) => (i === 0 ? c.color : mixHex(acc, c.color, c.weight)), '#ffffff')
    : '#ffffff';

  return {
    core: { radius: CORE_RADIUS, color: mixHex(coreColor, '#ffffff', 0.6) },
    clusters,
    shards,
    cracks,
    fusions,
    boundingRadius,
  };
}

function buildCrack(d: Drawdown, index: number, clusters: Cluster[]): Crack {
  const depth = Math.abs(d.depth);
  const target = d.symbol ? clusters.find((c) => c.symbol === d.symbol) : undefined;
  const rand = rng(hashString(`${d.symbol ?? 'basket'}:${index}:${depth}`));
  const center: Vec3 = target
    ? target.direction
    : fibonacciSphere(7)[Math.floor(rand() * 7)]!;
  const [t, b] = tangentBasis(center);
  const heading = rand() * Math.PI * 2;
  const along = normalize(add(scale(t, Math.cos(heading)), scale(b, Math.sin(heading))));
  const side: Vec3 = normalize([
    center[1] * along[2] - center[2] * along[1],
    center[2] * along[0] - center[0] * along[2],
    center[0] * along[1] - center[1] * along[0],
  ]);

  // deeper drawdown → longer crack
  const halfArc = 0.3 + clamp(depth / 100, 0, 1) * 1.6;
  const segments = 9;
  const radius = CORE_RADIUS * 1.03;
  const points: Vec3[] = [];
  for (let s = 0; s <= segments; s++) {
    const u = -halfArc + (2 * halfArc * s) / segments;
    const jag = s === 0 || s === segments ? 0 : (rand() - 0.5) * 0.22;
    const p = normalize(
      add(add(scale(center, Math.cos(u)), scale(along, Math.sin(u))), scale(side, jag)),
    );
    points.push(scale(p, radius));
  }

  return { symbol: d.symbol, depth, gold: d.recovered, points };
}

export const KINTSUGI_GOLD = GOLD;
