import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  buildCrystal,
  exposedVoxels,
  seamYaw,
  type Drawdown,
  type Holding,
} from '@prism/core';

/*
 * The PRISM voxel crystal for video: same buildCrystal geometry and look as the web app
 * (outlined toon cubes, black hull, gold seams), but every pixel is a pure function of
 * the props, so Remotion can render any frame on its own.
 */

const OUTLINE = 1.14;
/** Kintsugi gold, drawn unlit so it glows against the toon-shaded cubes. */
const GOLD = new THREE.Color('#ffc93a');
const FROST = new THREE.Color('#d6f1ff');
const cube = new THREE.BoxGeometry(1, 1, 1);

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff';
  g.fillRect(6, 6, 52, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function toonRamp() {
  const data = new Uint8Array([110, 190, 255]);
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const key = (p: number[]) => p.join(',');
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

interface Cell {
  pos: [number, number, number];
  color: THREE.Color;
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

export interface CrystalShape {
  cells: Cell[];
  radius: number;
  /** yaw that turns the seam towards the camera */
  yaw: number;
}

/** Precompute every cube's states once: whole, cracked (drop open) and healed (gold). */
export function makeShape(holdings: Holding[], drop: Drawdown): CrystalShape {
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
  const cells: Cell[] = base.voxels.map((v) => {
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
      color: interior ? new THREE.Color('#3a0f0d') : new THREE.Color(v.color),
      interior,
      // the crack opens along the whole seam footprint, so it fills back exactly in gold
      cut: !kept.has(k) || gilded.has(k),
      gold: gilded.has(k),
      from: [(x / len) * dist + (rand() - 0.5) * R, (y / len) * dist + (rand() - 0.5) * R, (z / len) * dist + (rand() - 0.5) * R],
      delay: (len / R) * 0.6 + rand() * 0.4,
      crackDelay: along,
    };
  });
  return { cells, radius: R, yaw: seamYaw(healed) };
}

export interface CrystalState {
  /** 0 = scattered cubes, 1 = assembled */
  assemble: number;
  /** 0 = whole, 1 = the drop's crack fully open */
  crack: number;
  /** 0 = open, 1 = filled with gold */
  heal: number;
  /** 0..1 sealed-gift frost */
  frost: number;
  /** extra yaw on top of the seam-facing yaw */
  yaw: number;
  /** a gentle tilt towards the camera */
  tilt?: number;
}

export function VoxelCrystal({ shape, state, size = 1.6, position = [0, 0, 0] }: { shape: CrystalShape; state: CrystalState; size?: number; position?: [number, number, number] }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const hull = useRef<THREE.InstancedMesh>(null);
  const gilt = useRef<THREE.InstancedMesh>(null);
  const materials = useMemo(() => {
    const face = faceTexture();
    return {
      body: new THREE.MeshToonMaterial({ map: face, gradientMap: toonRamp(), toneMapped: false }),
      hull: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.BackSide }),
      gold: new THREE.MeshBasicMaterial({ map: face, color: GOLD, toneMapped: false }),
    };
  }, []);
  const n = shape.cells.length;
  const goldCells = useMemo(() => shape.cells.filter((c) => c.gold), [shape]);

  useLayoutEffect(() => {
    const b = body.current;
    const h = hull.current;
    if (!b || !h) return;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    shape.cells.forEach((c, i) => {
      const a = smooth(clamp01((state.assemble * 1.6 - c.delay) / 0.6));
      let s = a;
      const cutOpen = c.cut ? smooth(clamp01((state.crack * 1.5 - c.crackDelay * 0.5) / 0.5)) : 0;
      const healed = c.gold || c.cut ? smooth(clamp01((state.heal * 1.5 - c.crackDelay * 0.5) / 0.5)) : 0;
      if (c.cut) s *= Math.max(1 - cutOpen, healed);
      const [x, y, z] = c.pos;
      const px = x + c.from[0] * (1 - a);
      const py = y + c.from[1] * (1 - a);
      const pz = z + c.from[2] * (1 - a);
      m.makeScale(s, s, s).setPosition(px, py, pz);
      b.setMatrixAt(i, m);
      m.makeScale(s * OUTLINE, s * OUTLINE, s * OUTLINE).setPosition(px, py, pz);
      h.setMatrixAt(i, m);
      col.copy(c.color);
      if (state.frost > 0) col.lerp(FROST, state.frost * (c.gold ? 0.3 : 0.62));
      b.setColorAt(i, col);
    });
    b.count = h.count = n;
    b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;

    // the gold seam: unlit gold cubes that grow over the crack as it heals
    const g = gilt.current;
    if (!g) return;
    goldCells.forEach((c, i) => {
      const a = smooth(clamp01((state.assemble * 1.6 - c.delay) / 0.6));
      const healed = smooth(clamp01((state.heal * 1.5 - c.crackDelay * 0.5) / 0.5));
      const s2 = a * healed * 1.02;
      m.makeScale(s2, s2, s2).setPosition(c.pos[0], c.pos[1], c.pos[2]);
      g.setMatrixAt(i, m);
      col.set('#ffffff');
      if (state.frost > 0) col.lerp(FROST, state.frost * 0.35);
      g.setColorAt(i, col);
    });
    g.count = goldCells.length;
    g.instanceMatrix.needsUpdate = true;
    if (g.instanceColor) g.instanceColor.needsUpdate = true;
  });

  const k = size / shape.radius;
  return (
    <group position={position} rotation={[state.tilt ?? 0.18, shape.yaw + state.yaw, 0]}>
      <group scale={k}>
        <instancedMesh ref={body} args={[cube, materials.body, n]} />
        <instancedMesh ref={hull} args={[cube, materials.hull, n]} />
        <instancedMesh ref={gilt} args={[cube, materials.gold, Math.max(1, goldCells.length)]} />
      </group>
    </group>
  );
}
