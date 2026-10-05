import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Drawdown, Holding } from '@prism/core';
import { crystalCells, type CellData, type SeamData } from './shape';

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

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

type Cell = Omit<CellData, 'color'> & { color: THREE.Color };

export interface CrystalShape {
  cells: Cell[];
  /** dark seams where one holding meets another, each riding on a cube */
  seams: SeamData[];
  radius: number;
  /** yaw that turns the seam towards the camera */
  yaw: number;
}

/** Precompute every cube's states once (shape.ts), with three.js colours. */
export function makeShape(holdings: Holding[], drop: Drawdown): CrystalShape {
  const { cells, seams, radius, yaw } = crystalCells(holdings, drop);
  return { cells: cells.map((c) => ({ ...c, color: new THREE.Color(c.color) })), seams, radius, yaw };
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
  const seam = useRef<THREE.InstancedMesh>(null);
  const materials = useMemo(() => {
    const face = faceTexture();
    return {
      body: new THREE.MeshToonMaterial({ map: face, gradientMap: toonRamp(), toneMapped: false }),
      hull: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.BackSide }),
      gold: new THREE.MeshBasicMaterial({ map: face, color: GOLD, toneMapped: false }),
      seam: new THREE.MeshBasicMaterial({ color: '#000' }),
    };
  }, []);
  const n = shape.cells.length;
  const goldCells = useMemo(() => shape.cells.filter((c) => c.gold), [shape]);
  // each cube's scale and position this frame, for the seams riding on it
  const placed = useMemo(() => ({ s: new Float32Array(n), p: new Float32Array(n * 3) }), [n]);

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
      // a seam on a cube that turns gold fades out as the gold grows over it (gold stays clean)
      placed.s[i] = c.gold ? s * (1 - healed) : s;
      placed.p.set([px, py, pz], i * 3);
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

    // seams between holdings fly in, crack open and heal with the cubes they lie on
    const sm = seam.current;
    if (sm) {
      shape.seams.forEach((q, i) => {
        const s = placed.s[q.cell]!;
        m.makeScale(q.scale[0] * s, q.scale[1] * s, q.scale[2] * s);
        m.setPosition(placed.p[q.cell * 3]! + q.offset[0] * s, placed.p[q.cell * 3 + 1]! + q.offset[1] * s, placed.p[q.cell * 3 + 2]! + q.offset[2] * s);
        sm.setMatrixAt(i, m);
      });
      sm.count = shape.seams.length;
      sm.instanceMatrix.needsUpdate = true;
    }

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
        <instancedMesh ref={seam} args={[cube, materials.seam, Math.max(1, shape.seams.length)]} />
        <instancedMesh ref={gilt} args={[cube, materials.gold, Math.max(1, goldCells.length)]} />
      </group>
    </group>
  );
}
