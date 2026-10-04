import {
  type Vec3,
  add,
  clamp,
  dot,
  fibonacciSphere,
  hashString,
  hslToHex,
  length,
  mixHex,
  normalize,
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
  /** 24h price change in percent, e.g. 3.2 or -7.5. NaN = unknown (no price feed). */
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
  /** Hard cap on spires across the whole crystal (keeps mobile cheap). */
  maxShards?: number;
  /** Crystal radius in voxels. Higher = finer and more cubes. Default 8. */
  resolution?: number;
}

// ---------------------------------------------------------------------------
// Outputs (plain data — no three.js types)
// ---------------------------------------------------------------------------

/** Integer grid cell. */
export type Cell = [number, number, number];

export interface Voxel {
  /** Integer grid coordinates; one unit = one cube. */
  position: Cell;
  color: string;
  /** core = the central gem, facet = a holding's spire, bridge = fused correlated holdings. */
  kind: 'core' | 'facet' | 'bridge';
  /** Index into `clusters`; -1 for bridges. Core cells take the nearest cluster. */
  cluster: number;
  /** Kintsugi: this cube fills a healed crack. */
  gold: boolean;
}

export interface Cluster {
  symbol: string;
  weight: number;
  direction: Vec3;
  /** Linear size of the spire group. size³ is proportional to weight. */
  size: number;
  color: string;
  /** 0..1 strength of the color, from |change24h|. */
  intensity: number;
  /** 0..1, from volatility. */
  spikiness: number;
  /** Symbols this cluster is fused with (correlation > threshold). */
  fusedWith: string[];
  spires: number;
}

export interface Crack {
  symbol?: string;
  depth: number;
  /** Recovered drawdowns are filled with gold cubes; open ones stay as gaps. */
  gold: boolean;
  /** Grid cells the crack runs through (removed if open, gilded if gold). */
  cells: Cell[];
}

export interface CrystalGeometry {
  voxels: Voxel[];
  clusters: Cluster[];
  cracks: Crack[];
  fusions: Array<[string, string]>;
  /** Max distance (in voxels) of any cube centre from the origin, plus half a cube. */
  radius: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const CORRELATION_THRESHOLD = 0.7;
export const CRACK_THRESHOLD = 15; // percent
export const KINTSUGI_GOLD = '#f6c143';
const CORE_RADIUS = 0.55;
const BASE_SIZE = 1.15;
const DEFAULT_MAX_SHARDS = 64;
const DEFAULT_RESOLUTION = 8;
const COLOR_FULL_MOVE = 8; // a ±8% day saturates the color

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

export const NO_DATA_COLOR = '#8a9299';

/**
 * Flat, saturated green for gains and red for losses; a bigger move is deeper and stronger.
 * A non-finite change (NaN = no price data) renders neutral grey instead of a guessed color.
 */
export function changeColor(change24h: number): { color: string; intensity: number } {
  if (!Number.isFinite(change24h)) return { color: NO_DATA_COLOR, intensity: 0 };
  const intensity = clamp(Math.abs(change24h) / COLOR_FULL_MOVE, 0, 1);
  const hue = change24h >= 0 ? 138 : 2;
  const sat = 0.35 + 0.35 * intensity;
  const light = 0.6 - 0.18 * intensity;
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

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Voxels with at least one empty face neighbour — the only ones worth drawing. */
export function exposedVoxels(voxels: Voxel[]): Voxel[] {
  const filled = new Set(voxels.map((v) => cellKey(...v.position)));
  return voxels.filter((v) => {
    const [x, y, z] = v.position;
    return (
      !filled.has(cellKey(x + 1, y, z)) ||
      !filled.has(cellKey(x - 1, y, z)) ||
      !filled.has(cellKey(x, y + 1, z)) ||
      !filled.has(cellKey(x, y - 1, z)) ||
      !filled.has(cellKey(x, y, z + 1)) ||
      !filled.has(cellKey(x, y, z - 1))
    );
  });
}

// ---------------------------------------------------------------------------
// buildCrystal
// ---------------------------------------------------------------------------

/** A spire in continuous space, later rasterized onto the voxel grid. */
interface Spire {
  kind: 'facet' | 'bridge';
  cluster: number;
  dir: Vec3;
  len: number;
  halfWidth: number;
  color: string;
}

export function buildCrystal(
  holdingsIn: Holding[],
  history?: CrystalHistory,
  options: BuildCrystalOptions = {},
): CrystalGeometry {
  const holdings = normalizeHoldings(holdingsIn);
  const maxShards = options.maxShards ?? DEFAULT_MAX_SHARDS;
  const resolution = options.resolution ?? DEFAULT_RESOLUTION;
  const { groups, edges } = groupByCorrelation(holdings, options.correlation);
  if (holdings.length === 0) return { voxels: [], clusters: [], cracks: [], fusions: [], radius: 0 };

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
    const ring = 0.22 + 0.05 * members.length;
    members.forEach((m, k) => {
      directions[m] = tilt(anchor, ring, (k / members.length) * Math.PI * 2);
    });
  });

  // 2. Spire budget, proportional to weight.
  const rawCounts = holdings.map((h) => clamp(Math.round(2 + h.weight * 10), 2, 8));
  const rawTotal = rawCounts.reduce((s, c) => s + c, 0);
  const budgetScale = rawTotal > maxShards ? maxShards / rawTotal : 1;
  const counts = rawCounts.map((c) => Math.max(1, Math.floor(c * budgetScale)));

  const fusedWith: string[][] = holdings.map(() => []);
  for (const [i, j] of edges) {
    fusedWith[i]!.push(holdings[j]!.symbol);
    fusedWith[j]!.push(holdings[i]!.symbol);
  }

  // 3. Clusters + their spires (continuous space, unit ≈ crystal core radius / 0.55).
  const clusters: Cluster[] = [];
  const spires: Spire[] = [];
  const mainSpire: Spire[] = [];

  holdings.forEach((h, i) => {
    const dir = directions[i]!;
    const spikiness = clamp(h.volatility, 0, 1);
    const { color, intensity } = changeColor(h.change24h);
    const size = BASE_SIZE * Math.cbrt(h.weight);
    // volatile holdings grow taller, thinner columns
    const elongation = 0.95 + 1.6 * spikiness;
    const halfWidth = size * 0.42 * (1 - 0.45 * spikiness);
    const spread = 0.25 + 0.85 * Math.sqrt(h.weight);
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
      spires: counts[i]!,
    });

    for (let s = 0; s < counts[i]!; s++) {
      const a = rand();
      const b = rand();
      const c = rand();
      const d = rand();
      const sdir = s === 0 ? dir : tilt(dir, spread * (0.4 + 0.6 * a), b * Math.PI * 2);
      const spire: Spire = {
        kind: 'facet',
        cluster: i,
        dir: sdir,
        len: size * elongation * (s === 0 ? 1 : 0.5 + 0.4 * c),
        halfWidth: halfWidth * (s === 0 ? 1 : 0.6 + 0.35 * d),
        color,
      };
      spires.push(spire);
      if (s === 0) mainSpire.push(spire);
    }
  });

  // Fused neighbours get a bridge spire between them so they read as one block.
  const fusions: Array<[string, string]> = [];
  for (const [i, j] of edges) {
    const a = mainSpire[i]!;
    const b = mainSpire[j]!;
    fusions.push([clusters[i]!.symbol, clusters[j]!.symbol]);
    spires.push({
      kind: 'bridge',
      cluster: -1,
      dir: normalize(add(a.dir, b.dir)),
      len: ((a.len + b.len) / 2) * 0.85,
      // wide enough to span the gap between the two main spires
      halfWidth:
        Math.max(a.halfWidth, b.halfWidth) +
        Math.sin(Math.acos(clamp(dot(a.dir, b.dir), -1, 1)) / 2) * (CORE_RADIUS + a.len * 0.5),
      color: mixHex(a.color, b.color),
    });
  }

  // 4. Rasterize onto the integer grid.
  // The gem body is a fixed fraction of the crystal; spires start inside it and
  // are scaled so the longest one reaches `resolution` cells from the centre.
  const coreR = resolution * 0.45;
  const baseG = coreR * 0.5;
  const maxLen = spires.reduce((m, s) => Math.max(m, s.len), 1e-6);
  const g = (resolution - baseG) / maxLen; // grid cells per continuous unit
  const n = Math.ceil(resolution) + 1;
  const cells = new Map<string, Voxel>();

  for (let x = -n; x <= n; x++) {
    for (let y = -n; y <= n; y++) {
      for (let z = -n; z <= n; z++) {
        const p: Vec3 = [x, y, z];
        let best: Spire | null = null;
        let bestScore = Infinity;
        for (const s of spires) {
          // every holding pokes out of the gem body, however small its weight
          const lenG = Math.max(s.len * g, coreR * 0.95);
          const t = dot(p, s.dir) - baseG;
          if (t < 0 || t > lenG) continue;
          const u = t / lenG;
          // straight column, then a pointed tip over the last 40%
          const taper = u < 0.6 ? 1 : (1 - u) / 0.4;
          const allowed = Math.max(s.halfWidth * g * taper, u < 0.97 ? 0.55 : 0);
          const r = length(add(p, scale(s.dir, -(t + baseG))));
          if (r > allowed) continue;
          const score = r / Math.max(allowed, 1e-6);
          // facets win ties over bridges so each holding keeps its own color
          if (score < bestScore - (s.kind === 'bridge' ? 0.05 : 0)) {
            best = s;
            bestScore = score;
          }
        }
        const inCore = Math.abs(x) + Math.abs(y) * 0.8 + Math.abs(z) <= coreR;
        if (!best && !inCore) continue;

        if (best && !inCore) {
          cells.set(cellKey(x, y, z), {
            position: [x, y, z],
            color: best.color,
            kind: best.kind,
            cluster: best.cluster,
            gold: false,
          });
        } else {
          // core cells take the color of the cluster they face
          const dirP = normalize(p);
          let ci = 0;
          let bestDot = -Infinity;
          clusters.forEach((c, k) => {
            const d = dot(dirP, c.direction);
            if (d > bestDot) {
              bestDot = d;
              ci = k;
            }
          });
          cells.set(cellKey(x, y, z), {
            position: [x, y, z],
            color: clusters[ci]!.color,
            kind: 'core',
            cluster: ci,
            gold: false,
          });
        }
      }
    }
  }

  // 5. Living crystal: deep drawdowns cut a gap; recovered ones are filled with gold.
  const cracks: Crack[] = (history?.drawdowns ?? [])
    .filter((d) => Math.abs(d.depth) > CRACK_THRESHOLD)
    .map((d, k) => {
      const crack = crackCells(d, k, clusters, cells);
      for (const c of crack.cells) {
        const key = cellKey(...c);
        if (crack.gold) {
          const v = cells.get(key)!;
          cells.set(key, { ...v, gold: true, color: KINTSUGI_GOLD });
        } else {
          cells.delete(key);
        }
      }
      return crack;
    });

  const voxels = [...cells.values()];
  const radius = voxels.reduce((m, v) => Math.max(m, length(v.position)), 0) + 0.5;
  return { voxels, clusters, cracks, fusions, radius };
}

/**
 * A crack is a jagged one-cube-thick slice through the crystal: a plane through
 * the origin, limited to a wedge around the affected holding. Deeper drawdowns
 * open a wider wedge (a longer crack).
 */
function crackCells(d: Drawdown, index: number, clusters: Cluster[], cells: Map<string, Voxel>): Crack {
  const depth = Math.abs(d.depth);
  const target = d.symbol ? clusters.find((c) => c.symbol === d.symbol) : undefined;
  const rand = rng(hashString(`${d.symbol ?? 'basket'}:${index}:${depth}`));
  const center: Vec3 = target ? target.direction : fibonacciSphere(7)[Math.floor(rand() * 7)]!;
  const [t, b] = tangentBasis(center);
  const heading = rand() * Math.PI * 2;
  // `along` lies in the crack plane; `normal` is the plane normal
  const along = normalize(add(scale(t, Math.cos(heading)), scale(b, Math.sin(heading))));
  const normal = normalize(add(scale(t, -Math.sin(heading)), scale(b, Math.cos(heading))));
  const halfArc = 0.35 + clamp(depth / 100, 0, 1) * 1.5;
  const cosArc = Math.cos(halfArc);
  const phase = rand() * Math.PI * 2;

  const out: Cell[] = [];
  for (const v of cells.values()) {
    const p = v.position;
    const r = length(p);
    if (r < 1.5) continue;
    const dirP: Vec3 = [p[0] / r, p[1] / r, p[2] / r];
    // inside the wedge around the target direction (measured within the crack plane)
    const inPlane = normalize(add(dirP, scale(normal, -dot(dirP, normal))));
    if (dot(inPlane, center) < cosArc) continue;
    // zig-zag offset so the gap reads as a crack, not a cut
    const jag = 0.9 * Math.sin(dot(p, along) * 0.9 + phase);
    if (Math.abs(dot(p, normal) - jag) <= 0.75) out.push(p);
  }
  return { symbol: d.symbol, depth, gold: d.recovered, cells: out };
}
