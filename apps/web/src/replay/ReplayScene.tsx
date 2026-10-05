import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  LIVE_CRACK_THRESHOLD,
  buildCrystal,
  exposedVoxels,
  regionBorders,
  replayTimeAt,
  seamYaw,
  type ReplayPlan,
  type ReplayTimeline,
  type Voxel,
} from '@prism/core';
import { FROST, GOLD_HDR, OUTLINE, SEAM_DEPTH, SEAM_WIDTH, bodyMaterial, cube, noRaycast, outlineMaterial, seamMaterial } from '../components/Crystal';
import { FrostShell } from '../components/FrostShell';

/*
 * The replay's crystal: every keyframe of the timeline is built once with the real renderer
 * (buildCrystal: per-asset shades, seams, cracks, gold), then each video frame blends the two
 * keyframes around its moment: cubes grow or shrink as the shape changes, colours shift with
 * the moves, a crack opens at a real drop and fills with gold when the price climbs back.
 * A gift's ice wraps on at the seal (its tiles fly in) and shatters at the unwrap.
 */

const key = (p: readonly number[]) => p.join(',');
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Seconds the ice takes to wrap on / to shatter. */
const FROST_IN = 0.7;
const FROST_OUT = 1.6;

interface Keyframe {
  /** per cell of the union: filled (1) or not (0), colour, gold */
  on: Float32Array;
  rgb: Float32Array;
  /** seams: [cell, offset xyz, scale xyz] */
  seams: Array<{ cell: number; offset: [number, number, number]; scale: [number, number, number] }>;
  solid: Voxel[];
}

export function ReplayScene({ timeline, plan, clock, reduce }: { timeline: ReplayTimeline; plan: ReplayPlan; clock: MutableRefObject<number>; reduce: boolean }) {
  const built = useMemo(() => {
    const geos = timeline.frames.map((f) =>
      f.holdings.length ? buildCrystal(f.holdings, f.history, { maxShards: 48, resolution: 8, crackThreshold: LIVE_CRACK_THRESHOLD }) : null,
    );
    // every cube that is ever on the surface, in one list
    const index = new Map<string, number>();
    const cells: Array<[number, number, number]> = [];
    for (const g of geos) {
      if (!g) continue;
      for (const v of exposedVoxels(g.voxels)) {
        const k = key(v.position);
        if (!index.has(k)) {
          index.set(k, cells.length);
          cells.push(v.position);
        }
      }
    }
    const col = new THREE.Color();
    const keyframes: Keyframe[] = geos.map((g) => {
      const on = new Float32Array(cells.length);
      const rgb = new Float32Array(cells.length * 3);
      const seams: Keyframe['seams'] = [];
      if (g) {
        for (const v of g.voxels) {
          const i = index.get(key(v.position));
          if (i === undefined) continue;
          on[i] = 1;
          if (v.gold) col.copy(GOLD_HDR);
          else col.set(v.color);
          rgb.set([col.r, col.g, col.b], i * 3);
        }
        for (const s of regionBorders(g.voxels)) {
          const cell = index.get(key(s.cell));
          if (cell === undefined) continue;
          seams.push({
            cell,
            offset: [0, 1, 2].map((a) => s.edge[a]! - s.cell[a]! + s.inward[a]! * (SEAM_WIDTH / 2) + s.normal[a]! * (SEAM_DEPTH / 2)) as [number, number, number],
            scale: [0, 1, 2].map((a) => (a === s.along ? 1 + SEAM_WIDTH : s.normal[a] !== 0 ? SEAM_DEPTH : SEAM_WIDTH)) as [number, number, number],
          });
        }
      }
      return { on, rgb, seams, solid: g?.voxels ?? [] };
    });
    const radius = Math.max(1, ...geos.map((g) => g?.radius ?? 0));
    const last = [...geos].reverse().find((g) => g);
    // the ice wraps the shape it has when the gift is sealed / sent
    let frostSolid: Voxel[] = [];
    if (timeline.frost) {
      const k = Math.round(((timeline.frost.from - timeline.start) / Math.max(1, timeline.end - timeline.start)) * (keyframes.length - 1));
      frostSolid = keyframes[Math.min(keyframes.length - 1, Math.max(0, k))]!.solid;
    }
    // fly-in for the forge: each cube from outside, inner ones first
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const fly = cells.map(([x, y, z]) => {
      const len = Math.hypot(x, y, z) || 1;
      const d = radius * (1.4 + rand() * 1.6);
      return { dx: (x / len) * d + (rand() - 0.5) * radius, dy: (y / len) * d + (rand() - 0.5) * radius, dz: (z / len) * d + (rand() - 0.5) * radius, delay: (len / radius) * 0.45 + rand() * 0.25 };
    });
    const maxSeams = Math.max(1, ...keyframes.map((k) => k.seams.length));
    return { cells, keyframes, radius, yaw: last ? seamYaw(last) : 0, frostSolid, fly, maxSeams };
  }, [timeline]);

  const body = useRef<THREE.InstancedMesh>(null);
  const hull = useRef<THREE.InstancedMesh>(null);
  const seamA = useRef<THREE.InstancedMesh>(null);
  const seamB = useRef<THREE.InstancedMesh>(null);
  const spinner = useRef<THREE.Group>(null);
  const unwrap = useRef<number | null>(1);
  const frostGroup = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  // fit the camera so the whole crystal (and its ice) stays in frame, in square or wide
  useLayoutEffect(() => {
    const r = (built.radius + 1.5) * 1.18;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = size.width / Math.max(1, size.height);
    const fit = Math.max(r / Math.sin(fov / 2), r / Math.sin(Math.atan(Math.tan(fov / 2) * aspect)));
    camera.position.set(0, built.radius * 0.18, fit);
    camera.lookAt(0, -built.radius * 0.02, 0);
    camera.updateProjectionMatrix();
  }, [built, camera, size]);

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Color(), scale: new Float32Array(0), pos: new Float32Array(0) }), []);
  useFrame(() => {
    const b = body.current;
    const h = hull.current;
    if (!b || !h) return;
    const s = clock.current;
    const { t, phase } = replayTimeAt(timeline, plan, s);
    const K = built.keyframes.length;
    const u = phase === 'intro' ? 0 : ((t - timeline.start) / Math.max(1, timeline.end - timeline.start)) * (K - 1);
    const ia = Math.min(K - 1, Math.floor(u));
    const ib = Math.min(K - 1, ia + 1);
    const f = smooth(clamp01(u - ia));
    const A = built.keyframes[ia]!;
    const B = built.keyframes[ib]!;
    const n = built.cells.length;
    if (tmp.scale.length !== n) {
      tmp.scale = new Float32Array(n);
      tmp.pos = new Float32Array(n * 3);
    }
    // ice tint on the crystal while it's frosted
    const fr = timeline.frost;
    const frostIn = fr ? clamp01((s - secondsAt(fr.from)) / FROST_IN) : 0;
    const frostOut = fr && fr.unwrapAt !== null ? clamp01((s - secondsAt(fr.unwrapAt)) / FROST_OUT) : 0;
    const frosted = fr ? smooth(frostIn) * (1 - smooth(frostOut)) : 0;
    const intro = phase === 'intro' ? (reduce ? 1 : s / plan.intro) : 1;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = built.cells[i]!;
      let k = A.on[i]! + (B.on[i]! - A.on[i]!) * f;
      let px = x;
      let py = y;
      let pz = z;
      if (intro < 1) {
        // the forge: cubes fly in and lock
        const fl = built.fly[i]!;
        const e = 1 - (1 - clamp01((intro * 1.6 - fl.delay) / 0.75)) ** 3;
        k *= e;
        px += fl.dx * (1 - e);
        py += fl.dy * (1 - e);
        pz += fl.dz * (1 - e);
      }
      tmp.scale[i] = k;
      tmp.pos.set([px, py, pz], i * 3);
      tmp.m.makeScale(k, k, k).setPosition(px, py, pz);
      b.setMatrixAt(i, tmp.m);
      tmp.m.makeScale(k * OUTLINE, k * OUTLINE, k * OUTLINE).setPosition(px, py, pz);
      h.setMatrixAt(i, tmp.m);
      tmp.c.setRGB(A.rgb[i * 3]! + (B.rgb[i * 3]! - A.rgb[i * 3]!) * f, A.rgb[i * 3 + 1]! + (B.rgb[i * 3 + 1]! - A.rgb[i * 3 + 1]!) * f, A.rgb[i * 3 + 2]! + (B.rgb[i * 3 + 2]! - A.rgb[i * 3 + 2]!) * f);
      if (frosted > 0) tmp.c.lerp(FROST, frosted * 0.3);
      b.setColorAt(i, tmp.c);
    }
    b.count = h.count = n;
    b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    // seams: the two keyframes' seams cross-fade, riding on their cubes
    for (const [mesh, kf, w] of [
      [seamA.current, A, 1 - f],
      [seamB.current, B, f],
    ] as const) {
      if (!mesh) continue;
      kf.seams.forEach((q, j) => {
        const e = tmp.scale[q.cell]! * w;
        tmp.m.makeScale(q.scale[0] * e, q.scale[1] * e, q.scale[2] * e);
        tmp.m.setPosition(tmp.pos[q.cell * 3]! + q.offset[0] * e, tmp.pos[q.cell * 3 + 1]! + q.offset[1] * e, tmp.pos[q.cell * 3 + 2]! + q.offset[2] * e);
        mesh.setMatrixAt(j, tmp.m);
      });
      mesh.count = kf.seams.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    // ice: tiles fly in at the seal (unwrap progress 1 → 0), shatter at the unwrap (0 → 1)
    if (fr) {
      unwrap.current = frostOut > 0 ? frostOut : 1 - smooth(frostIn);
      if (frostGroup.current) frostGroup.current.visible = s >= secondsAt(fr.from) && frostOut < 1;
    }
    // a slow turn, starting with the gold seam to the camera (still under reduced motion)
    if (spinner.current) spinner.current.rotation.y = built.yaw + (reduce ? 0 : (s - plan.total) * 0.32);
  });

  function secondsAt(at: number) {
    const span = Math.max(1, timeline.end - timeline.start);
    return plan.intro + Math.min(1, Math.max(0, (at - timeline.start) / span)) * plan.lapse;
  }

  const n = Math.max(1, built.cells.length);
  return (
    <group ref={spinner}>
      <group scale={1}>
        <instancedMesh ref={body} args={[cube, bodyMaterial, n]} raycast={noRaycast} />
        <instancedMesh ref={hull} args={[cube, outlineMaterial, n]} raycast={noRaycast} />
        <instancedMesh ref={seamA} args={[cube, seamMaterial, built.maxSeams]} raycast={noRaycast} />
        <instancedMesh ref={seamB} args={[cube, seamMaterial, built.maxSeams]} raycast={noRaycast} />
        {timeline.frost && built.frostSolid.length > 0 && (
          <group ref={frostGroup} visible={false}>
            <FrostShell voxels={built.frostSolid} unwrap={unwrap} reduce={reduce} />
          </group>
        )}
      </group>
    </group>
  );
}
