import {
  type Vec3,
  add,
  clamp,
  dot,
  hashString,
  hslToHex,
  length,
  mixHex,
  normalize,
  rng,
  scale,
  cross,
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
  /** Hard cap on volatility spikes across the whole crystal (keeps mobile cheap). */
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
  /** core = inner gem, facet = a holding's surface sector or spike, bridge = seam between fused holdings. */
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
  /** Relative linear size (∛weight); the holding's share of the gem grows with weight. */
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
  /** The crack's paths across the gem surface (grid units): main path first, then branches. */
  paths: Vec3[][];
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
/** Distance (in cubes) from a crack path that is cut away (open) or gilded (recovered). */
export const OPEN_CRACK_HALF_WIDTH = 0.75;
export const GOLD_SEAM_HALF_WIDTH = 1.15;
/** Volatility spikes never stick out more than this fraction of the crystal radius. */
export const MAX_SPIKE_FRACTION = 0.32;
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


/*
 * Shape: a gem. A pointed crown on top, a wide octagonal girdle, and a longer pointed
 * pavilion below — about as wide as it is tall. Each holding owns a sector of the gem
 * (bigger weight → bigger sector), volatility adds short capped spikes on its sector,
 * correlated holdings share a mixed-color seam, and drawdowns crack the surface along
 * meandering diagonal paths (gold when recovered).
 */

interface GemShape {
  /** girdle half-width (octagon inradius) */
  W: number;
  /** half-height of the straight girdle band */
  girdle: number;
  crownH: number;
  pavilionH: number;
}

function gemShape(R: number): GemShape {
  return { W: R * 0.66, girdle: Math.max(0.5, R * 0.06), crownH: R * 0.62, pavilionH: R * 0.9 };
}

/** Octagonal "radius" in the horizontal plane — gives the voxel gem flat facets. */
const octRadius = (x: number, z: number) =>
  Math.max(Math.abs(x), Math.abs(z), (Math.abs(x) + Math.abs(z)) / Math.SQRT2);

/** Allowed octagonal radius at height y (negative = above the crown / below the pavilion). */
function bodyHalfWidth(s: GemShape, y: number): number {
  if (y > s.girdle) return s.W * (1 - (y - s.girdle) / s.crownH);
  if (y < -s.girdle) return s.W * (1 - (-y - s.girdle) / s.pavilionH);
  return s.W;
}

/** Is point p inside the gem body scaled by `k` (k < 1 = the inner core)? */
function inBody(s: GemShape, p: Vec3, k = 1, tipFloor = 0.45): boolean {
  const hw = bodyHalfWidth(s, p[1] / k) * k;
  if (hw < 0) return false;
  return octRadius(p[0], p[2]) <= Math.max(hw, tipFloor);
}

/** Distance from the centre to the gem surface along unit direction `dir`. */
function surfaceRadius(s: GemShape, dir: Vec3): number {
  let r = 0;
  while (r < s.W * 4 && inBody(s, scale(dir, r), 1, 0)) r += 0.1;
  return Math.max(0, r - 0.05);
}

/** Directions mostly around the girdle so the gem keeps its pointed top and bottom. */
function girdleDirections(n: number): Vec3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = n === 1 ? 0 : 0.55 * (1 - (2 * (i + 0.5)) / n);
    const r = Math.sqrt(1 - y * y);
    const th = golden * i + 0.4;
    return normalize([Math.cos(th) * r, y, Math.sin(th) * r]);
  });
}

/** Keep a direction near the girdle (|y| ≤ maxY) so no spike points straight up or down. */
function flatten(d: Vec3, maxY = 0.6): Vec3 {
  const v = normalize([d[0], d[1] * 0.7, d[2]]);
  if (Math.abs(v[1]) <= maxY) return v;
  const h = Math.hypot(v[0], v[2]) || 1;
  const k = Math.sqrt(1 - maxY * maxY) / h;
  return [v[0] * k, Math.sign(v[1]) * maxY, v[2] * k];
}

interface Spike {
  cluster: number;
  dir: Vec3;
  /** distance from the centre where the spike axis starts (just inside the body) */
  base: number;
  /** axis length in cells */
  len: number;
  halfWidth: number;
}

export function buildCrystal(
  holdingsIn: Holding[],
  history?: CrystalHistory,
  options: BuildCrystalOptions = {},
): CrystalGeometry {
  const holdings = normalizeHoldings(holdingsIn);
  const maxShards = options.maxShards ?? DEFAULT_MAX_SHARDS;
  const R = options.resolution ?? DEFAULT_RESOLUTION;
  const { groups, edges } = groupByCorrelation(holdings, options.correlation);
  if (holdings.length === 0) return { voxels: [], clusters: [], cracks: [], fusions: [], radius: 0 };
  const shape = gemShape(R);
  const n = holdings.length;

  // 1. Directions: one anchor per correlation group around the girdle; members of a
  //    group sit in a tight ring around their anchor so they touch / fuse.
  const directions: Vec3[] = new Array(n);
  const anchors = girdleDirections(groups.length);
  groups.forEach((members, gi) => {
    const anchor = anchors[gi]!;
    if (members.length === 1) {
      directions[members[0]!] = anchor;
      return;
    }
    const ring = 0.22 + 0.05 * members.length;
    members.forEach((m, k) => {
      directions[m] = flatten(tilt(anchor, ring, (k / members.length) * Math.PI * 2));
    });
  });

  const fusedWith: string[][] = holdings.map(() => []);
  const fusedPair = new Set<string>();
  for (const [i, j] of edges) {
    fusedWith[i]!.push(holdings[j]!.symbol);
    fusedWith[j]!.push(holdings[i]!.symbol);
    fusedPair.add(`${i}:${j}`).add(`${j}:${i}`);
  }

  // 2. Clusters.
  const clusters: Cluster[] = holdings.map((h, i) => {
    const { color, intensity } = changeColor(h.change24h);
    return {
      symbol: h.symbol,
      weight: h.weight,
      direction: directions[i]!,
      size: BASE_SIZE * Math.cbrt(h.weight),
      color,
      intensity,
      spikiness: clamp(h.volatility, 0, 1),
      fusedWith: fusedWith[i]!,
      spires: 0,
    };
  });

  // 3. Volatility spikes: short crystal points on each holding's sector, capped so
  //    no single column ever dominates the gem's silhouette.
  const rawCounts = holdings.map((h) => clamp(Math.round(1 + h.weight * 8), 1, 6));
  const rawTotal = rawCounts.reduce((s, c) => s + c, 0);
  const budgetScale = rawTotal > maxShards ? maxShards / rawTotal : 1;
  const spikes: Spike[] = [];
  clusters.forEach((c, i) => {
    const count = Math.max(1, Math.floor(rawCounts[i]! * budgetScale));
    c.spires = count;
    const rand = rng(hashString(c.symbol));
    const spread = 0.18 + 0.55 * Math.sqrt(c.weight);
    for (let k = 0; k < count; k++) {
      const a = rand();
      const b = rand();
      const len = rand();
      const wid = rand();
      const dir = k === 0 ? c.direction : flatten(tilt(c.direction, spread * (0.4 + 0.6 * a), b * Math.PI * 2));
      const surf = surfaceRadius(shape, dir);
      const out = R * Math.min(MAX_SPIKE_FRACTION, (0.1 + 0.22 * c.spikiness) * (k === 0 ? 1 : 0.55 + 0.35 * len));
      spikes.push({
        cluster: i,
        dir,
        base: surf - 1.5,
        len: out + 1.5,
        halfWidth: (R / 8) * (0.9 + 1.4 * Math.sqrt(c.weight)) * (1 - 0.4 * c.spikiness) * (k === 0 ? 1 : 0.6 + 0.3 * wid),
      });
    }
  });

  // 4. Rasterize onto the integer grid.
  const sector = (p: Vec3) => {
    // bigger weight → bigger sector (an additively weighted partition of directions)
    const d = normalize([p[0], p[1] * 0.75, p[2]]);
    let best = 0;
    let second = -1;
    let bestS = -Infinity;
    let secondS = -Infinity;
    clusters.forEach((c, k) => {
      const sc = dot(d, c.direction) + 0.9 * (c.weight - 1 / n);
      if (sc > bestS) {
        second = best;
        secondS = bestS;
        best = k;
        bestS = sc;
      } else if (sc > secondS) {
        second = k;
        secondS = sc;
      }
    });
    return { best, second, margin: bestS - secondS };
  };

  const ext = Math.ceil(R * 1.15) + 1;
  const cells = new Map<string, Voxel>();
  for (let x = -ext; x <= ext; x++) {
    for (let y = -ext; y <= ext; y++) {
      for (let z = -ext; z <= ext; z++) {
        const p: Vec3 = [x, y, z];
        if (inBody(shape, p)) {
          const { best, second, margin } = sector(p);
          const core = inBody(shape, p, 0.5);
          const seam = !core && second >= 0 && margin < 0.07 && fusedPair.has(`${best}:${second}`);
          cells.set(cellKey(x, y, z), {
            position: p,
            color: seam ? mixHex(clusters[best]!.color, clusters[second]!.color) : clusters[best]!.color,
            kind: core ? 'core' : seam ? 'bridge' : 'facet',
            cluster: seam ? -1 : best,
            gold: false,
          });
          continue;
        }
        // outside the body: part of a spike?
        let hit: Spike | null = null;
        let hitScore = Infinity;
        for (const s of spikes) {
          const t = dot(p, s.dir) - s.base;
          if (t < 0 || t > s.len) continue;
          const u = t / s.len;
          const taper = u < 0.3 ? 1 : (1 - u) / 0.7; // a crystal point
          const allowed = Math.max(s.halfWidth * taper, u < 0.95 ? 0.5 : 0);
          const r = length(add(p, scale(s.dir, -(t + s.base))));
          if (r > allowed) continue;
          const score = r / Math.max(allowed, 1e-6);
          if (score < hitScore) {
            hit = s;
            hitScore = score;
          }
        }
        if (hit) {
          cells.set(cellKey(x, y, z), {
            position: p,
            color: clusters[hit.cluster]!.color,
            kind: 'facet',
            cluster: hit.cluster,
            gold: false,
          });
        }
      }
    }
  }

  const fusions: Array<[string, string]> = edges.map(([i, j]) => [clusters[i]!.symbol, clusters[j]!.symbol]);

  // 5. Living crystal: deep drawdowns crack the surface along meandering paths; recovered
  //    ones are traced in gold (kintsugi), open ones are cut away as dark grooves.
  const cracks: Crack[] = (history?.drawdowns ?? [])
    .filter((d) => Math.abs(d.depth) > CRACK_THRESHOLD)
    .map((d, k) => {
      const crack = crackAlongSurface(d, k, clusters, shape, cells);
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

// ---------------------------------------------------------------------------
// Cracks
// ---------------------------------------------------------------------------

/** Radians per crack-path step. */
const CRACK_STEP = 0.07;
/** A crack never runs steeper than this (sine of the angle from horizontal): no vertical pillars. */
export const MAX_CRACK_SLOPE = 0.88;

/** East (horizontal) and north (towards +y) unit tangents at a point on the gem. */
function localFrame(d: Vec3): [Vec3, Vec3] {
  const east = Math.abs(d[1]) > 0.98 ? ([1, 0, 0] as Vec3) : normalize(cross([0, 1, 0], d));
  return [east, cross(d, east)];
}

function clampHeading(h: number): number {
  const s = Math.sin(h);
  const c = Math.cos(h);
  if (Math.abs(s) <= MAX_CRACK_SLOPE) return h;
  return Math.atan2(Math.sign(s) * MAX_CRACK_SLOPE, (c >= 0 ? 1 : -1) * Math.sqrt(1 - MAX_CRACK_SLOPE ** 2));
}

function pointSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L = dot(ab, ab);
  const t = L === 0 ? 0 : clamp(dot(ap, ab) / L, 0, 1);
  return length([ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t]);
}

/**
 * A crack is a meandering path across the gem surface: it starts at the affected holding,
 * runs diagonally both ways (never steeper than MAX_CRACK_SLOPE), and deeper drawdowns
 * run longer and branch. Cells within the half-width of a path are the crack.
 */
function crackAlongSurface(
  d: Drawdown,
  index: number,
  clusters: Cluster[],
  shape: GemShape,
  cells: Map<string, Voxel>,
): Crack {
  const depth = Math.abs(d.depth);
  const target = d.symbol ? clusters.find((c) => c.symbol === d.symbol) : undefined;
  const rand = rng(hashString(`${d.symbol ?? 'basket'}:${index}:${depth}`));
  const center: Vec3 = target
    ? target.direction
    : normalize([Math.cos(rand() * 7), (rand() - 0.5) * 0.9, Math.sin(rand() * 7)]);
  const halfArc = 0.45 + 1.3 * clamp(depth / 100, 0, 1) + (d.recovered ? 0.25 : 0);
  const steps = Math.max(2, Math.round(halfArc / CRACK_STEP));

  const walk = (start: Vec3, heading: number, count: number): Vec3[] => {
    const pts: Vec3[] = [];
    let dir = start;
    let h = heading;
    for (let k = 0; k <= count; k++) {
      pts.push(scale(dir, surfaceRadius(shape, dir)));
      const [east, north] = localFrame(dir);
      h = clampHeading(h + (rand() - 0.5) * 0.5);
      dir = normalize(add(dir, add(scale(east, Math.cos(h) * CRACK_STEP), scale(north, Math.sin(h) * CRACK_STEP))));
    }
    return pts;
  };

  // diagonal start: 30–60° from horizontal, rising to the right or to the left
  const h0 = (Math.PI / 4 + (rand() - 0.5) * (Math.PI / 6)) * (rand() < 0.5 ? 1 : -1);
  const forward = walk(center, h0, steps);
  const backward = walk(center, h0 + Math.PI, steps);
  const main = [...backward.reverse(), ...forward.slice(1)];
  const paths: Vec3[][] = [main];

  // kintsugi-style branches off the main crack
  const branches = depth >= 30 ? 2 : depth > 15 ? 1 : 0;
  for (let b = 0; b < branches; b++) {
    const i = Math.min(main.length - 2, Math.floor((0.2 + 0.6 * rand()) * main.length));
    const at = normalize(main[i]!);
    const [east, north] = localFrame(at);
    const t: Vec3 = [main[i + 1]![0] - main[i]![0], main[i + 1]![1] - main[i]![1], main[i + 1]![2] - main[i]![2]];
    const along = Math.atan2(dot(t, north), dot(t, east));
    const turn = (0.6 + 0.4 * rand()) * (b % 2 === 0 ? 1 : -1);
    paths.push(walk(at, clampHeading(along + turn), Math.max(2, Math.round(steps * (0.35 + 0.2 * rand())))));
  }

  // open cracks are cut two cubes deep so the groove reads as a dark gap
  const inner = d.recovered
    ? []
    : paths.map((path) => path.map((p) => scale(p, Math.max(0, length(p) - 1.6) / Math.max(length(p), 1e-6))));
  const width = d.recovered ? GOLD_SEAM_HALF_WIDTH : OPEN_CRACK_HALF_WIDTH;

  const out: Cell[] = [];
  for (const v of cells.values()) {
    const p = v.position;
    let hit = false;
    for (const path of [...paths, ...inner]) {
      for (let k = 1; k < path.length && !hit; k++) {
        if (pointSegmentDistance(p, path[k - 1]!, path[k]!) <= width) hit = true;
      }
      if (hit) break;
    }
    if (hit) out.push(p);
  }
  return { symbol: d.symbol, depth, gold: d.recovered, cells: out, paths };
}
