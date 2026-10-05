/*
 * The video crystal's cubes as plain data: where each one sits, where it flies in from,
 * when it lands, its part in the crack / gold seam, and the dark seams between holdings
 * that ride on it. VoxelCrystal.tsx draws them;
 * scripts/soundtrack.ts times the "click into place" sounds from the same numbers.
 */
import { buildCrystal, exposedVoxels, regionBorders, seamYaw, type Drawdown, type Holding } from '@prism/core';

/** Seams between holdings: a dark strip this wide (in cubes) on each face along a border (as on the site). */
export const SEAM_WIDTH = 0.24;
const SEAM_DEPTH = 0.02;

/** A seam strip riding on one cube: offset from the cube's centre and its size, both in cubes. */
export interface SeamData {
  cell: number;
  offset: [number, number, number];
  scale: [number, number, number];
}

export interface CellData {
  pos: [number, number, number];
  color: string;
  /** inside the gem (only seen through an open crack): drawn dark */
  interior: boolean;
  /** cut away while the drop is open */
  cut: boolean;
  /** gilded once the drop has recovered */
  gold: boolean;
  /** where it flies in from (assembly), and its stagger delays */
  from: [number, number, number];
  delay: number;
  crackDelay: number;
}

const key = (p: number[]) => p.join(',');

/** Every cube's states, computed once: whole, cracked (drop open) and healed (gold). */
export function crystalCells(holdings: Holding[], drop: Drawdown) {
  const opts = { crackThreshold: 5, maxShards: 48, resolution: 8 };
  const base = buildCrystal(holdings, undefined, opts);
  const open = buildCrystal(holdings, { drawdowns: [{ ...drop, recovered: false }] }, opts);
  const healed = buildCrystal(holdings, { drawdowns: [{ ...drop, recovered: true }] }, opts);
  const kept = new Set(open.voxels.map((v) => key(v.position)));
  const gilded = new Set(healed.voxels.filter((v) => v.gold).map((v) => key(v.position)));
  const surface = new Set(exposedVoxels(base.voxels).map((v) => key(v.position)));
  const seam = healed.cracks[0]?.paths[0] ?? [];
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const R = base.radius;
  const cells: CellData[] = base.voxels.map((v) => {
    const k = key(v.position);
    const [x, y, z] = v.position;
    const len = Math.hypot(x, y, z) || 1;
    const dist = R * (1.6 + rand() * 1.8);
    // crack opens along its path: cubes nearer the path's start go first
    let along = 0;
    if (seam.length > 1) {
      let best = Infinity;
      seam.forEach((p, i) => {
        const d = Math.hypot(p[0] - x, p[1] - y, p[2] - z);
        if (d < best) {
          best = d;
          along = i / (seam.length - 1);
        }
      });
    }
    const interior = !surface.has(k);
    return {
      pos: v.position,
      // the inside only shows through an open crack: a dark red gash
      color: interior ? '#3a0f0d' : v.color,
      interior,
      // the crack opens along the whole seam footprint, so it fills back exactly in gold
      cut: !kept.has(k) || gilded.has(k),
      gold: gilded.has(k),
      from: [(x / len) * dist + (rand() - 0.5) * R, (y / len) * dist + (rand() - 0.5) * R, (z / len) * dist + (rand() - 0.5) * R],
      delay: (len / R) * 0.6 + rand() * 0.4,
      crackDelay: along,
    };
  });
  const index = new Map(base.voxels.map((v, i) => [key(v.position), i]));
  const seams: SeamData[] = regionBorders(base.voxels).map((s) => ({
    cell: index.get(key(s.cell))!,
    offset: [0, 1, 2].map((a) => s.edge[a]! - s.cell[a]! + s.inward[a]! * (SEAM_WIDTH / 2) + s.normal[a]! * (SEAM_DEPTH / 2)) as [number, number, number],
    scale: [0, 1, 2].map((a) => (a === s.along ? 1 + SEAM_WIDTH : s.normal[a] !== 0 ? SEAM_DEPTH : SEAM_WIDTH)) as [number, number, number],
  }));
  return { cells, seams, radius: R, yaw: seamYaw(healed) };
}

/** Assembly progress (0..1) at which a cube with `delay` has fully landed (see VoxelCrystal). */
export const landsAt = (delay: number) => Math.min(1, (delay + 0.6) / 1.6);
