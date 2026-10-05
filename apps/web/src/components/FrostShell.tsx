import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Voxel } from '@prism/core';

/*
 * A sealed gift's ice: a translucent voxel shell one cube thick around the crystal (only its
 * outside faces, so it reads as one clean block of ice), with soft sparkles twinkling on it.
 * While unwrapping (progress 0 → 1) the ice cracks into its tiles, thaws, then shatters
 * outward in a burst of sparkles.
 */

/** Unwrap progress shared with the crystal: null = still wrapped, 0..1 = unwrapping. */
export type UnwrapRef = MutableRefObject<number | null>;

const plane = new THREE.PlaneGeometry(1, 1);
const DIRS: Array<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function iceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  // clear-ish blue middle, bright frosty rim: each tile reads as a block of ice
  const grad = g.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, 'rgba(225,244,255,0.20)');
  grad.addColorStop(1, 'rgba(170,220,255,0.08)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(235,248,255,0.62)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 61, 61);
  // a little frost streak
  g.strokeStyle = 'rgba(255,255,255,0.3)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(12, 46);
  g.lineTo(30, 20);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sparkleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.18, 'rgba(220,245,255,0.85)');
  glow.addColorStop(1, 'rgba(200,235,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  // four-point star
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.moveTo(32, 2);
  g.lineTo(35, 29);
  g.lineTo(62, 32);
  g.lineTo(35, 35);
  g.lineTo(32, 62);
  g.lineTo(29, 35);
  g.lineTo(2, 32);
  g.lineTo(29, 29);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let shared: { ice: THREE.MeshBasicMaterial; sparkle: THREE.PointsMaterial } | null = null;
function materials() {
  if (!shared) {
    shared = {
      ice: new THREE.MeshBasicMaterial({ map: iceTexture(), transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false }),
      sparkle: new THREE.PointsMaterial({
        map: sparkleTexture(),
        size: 0.9,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        toneMapped: false,
      }),
    };
  }
  return shared;
}

const SPARKLES = 46;
const THAW = new THREE.Color('#8fd3ff');

export function FrostShell({ voxels, unwrap, reduce }: { voxels: Voxel[]; unwrap: UnwrapRef; reduce: boolean | null }) {
  // the shell: every empty cell within one step of the crystal; its outside faces are the ice
  const shell = useMemo(() => {
    const solid = new Set(voxels.map((v) => key(...v.position)));
    const iceCells = new Set<string>();
    const cells: Array<[number, number, number]> = [];
    for (const v of voxels) {
      const [x, y, z] = v.position;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const k = key(x + dx, y + dy, z + dz);
            if (!solid.has(k) && !iceCells.has(k)) {
              iceCells.add(k);
              cells.push([x + dx, y + dy, z + dz]);
            }
          }
    }
    const faces: Array<{ pos: THREE.Vector3; normal: THREE.Vector3; seed: number }> = [];
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [x, y, z] of cells) {
      for (const [dx, dy, dz] of DIRS) {
        const n = key(x + dx, y + dy, z + dz);
        if (iceCells.has(n) || solid.has(n)) continue;
        faces.push({ pos: new THREE.Vector3(x + dx * 0.5, y + dy * 0.5, z + dz * 0.5), normal: new THREE.Vector3(dx, dy, dz), seed: rand() });
      }
    }
    // sparkles sit just outside random faces
    const pts = new Float32Array(SPARKLES * 3);
    const phase = new Float32Array(SPARKLES);
    for (let i = 0; i < SPARKLES; i++) {
      const f = faces[Math.floor(rand() * faces.length)]!;
      pts[i * 3] = f.pos.x + f.normal.x * 0.25 + (rand() - 0.5) * 0.6;
      pts[i * 3 + 1] = f.pos.y + f.normal.y * 0.25 + (rand() - 0.5) * 0.6;
      pts[i * 3 + 2] = f.pos.z + f.normal.z * 0.25 + (rand() - 0.5) * 0.6;
      phase[i] = rand() * Math.PI * 2;
    }
    return { faces, pts, phase };
  }, [voxels]);

  const tiles = useRef<THREE.InstancedMesh>(null);
  const sparkles = useRef<THREE.Points>(null);
  const group = useRef<THREE.Group>(null);
  const { sparkle } = materials();
  // its own ice material (sharing the texture): fading one gift's ice must not fade the others
  const ice = useMemo(() => materials().ice.clone(), []);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(shell.pts.slice(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKLES * 3), 3));
    return g;
  }, [shell]);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const z = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const col = useMemo(() => new THREE.Color(), []);
  const spin = useMemo(() => new THREE.Quaternion(), []);
  const axis = useMemo(() => new THREE.Vector3(), []);

  /** Place the ice tiles for unwrap progress `t` (0 = whole ice). */
  const place = (t: number) => {
    const mesh = tiles.current;
    if (!mesh) return;
    const crack = smooth(clamp01(t / 0.25)); // tiles split apart: dark gaps appear
    const burst = smooth(clamp01((t - 0.55) / 0.45)); // tiles fly off and vanish
    shell.faces.forEach((f, i) => {
      q.setFromUnitVectors(z, f.normal);
      // each shard tumbles a little as it flies
      if (burst > 0) q.multiply(spin.setFromAxisAngle(axis.set(f.seed - 0.5, 0.5, 0.5 - f.seed).normalize(), burst * (2 + f.seed * 4)));
      const k = (1 - 0.14 * crack) * (1 - burst);
      s.set(k, k, k);
      p.copy(f.pos).addScaledVector(f.normal, burst * (2.5 + f.seed * 5)).addScaledVector(f.pos, burst * 0.25);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      // toon-ish light on the ice: tops brightest; a thaw tints it clearer blue
      // (kept under the bloom threshold, so only the sparkles glow)
      const light = f.normal.y > 0 ? 0.86 : f.normal.y < 0 ? 0.5 : f.normal.x + f.normal.z > 0 ? 0.74 : 0.62;
      const thaw = smooth(clamp01((t - 0.2) / 0.4));
      col.setRGB(light, light, light).lerp(THAW, thaw * 0.35);
      mesh.setColorAt(i, col);
    });
    mesh.count = shell.faces.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  useLayoutEffect(() => {
    place(unwrap.current ?? 0);
    tiles.current?.computeBoundingSphere();
  }, [shell]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = useRef(-1);
  useFrame((state) => {
    const t = unwrap.current ?? 0;
    if (t !== last.current) {
      place(t);
      last.current = t;
      ice.opacity = 1 - smooth(clamp01((t - 0.3) / 0.6)) * 0.6;
    }
    // sparkles: a gentle twinkle; on unwrap they burst outward and fade
    const pts = sparkles.current;
    if (!pts) return;
    const pos = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const c = pts.geometry.getAttribute('color') as THREE.BufferAttribute;
    const burst = smooth(clamp01((t - 0.5) / 0.5));
    const time = reduce ? 0 : state.clock.elapsedTime;
    for (let i = 0; i < SPARKLES; i++) {
      const tw = reduce ? 0.7 : 0.35 + 0.65 * Math.max(0, Math.sin(time * 2.2 + shell.phase[i]!));
      const b = (t > 0 ? 1 + 1.5 * Math.sin(Math.PI * clamp01(t / 0.6)) : tw) * (1 - burst);
      c.setXYZ(i, b * 0.9, b * 0.97, b);
      const k = 1 + burst * 0.9;
      pos.setXYZ(i, shell.pts[i * 3]! * k, shell.pts[i * 3 + 1]! * k, shell.pts[i * 3 + 2]! * k);
    }
    c.needsUpdate = true;
    pos.needsUpdate = true;
    if (group.current) group.current.visible = t < 1;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={tiles} args={[plane, ice, Math.max(1, shell.faces.length)]} raycast={() => null} renderOrder={2} />
      <points ref={sparkles} geometry={geometry} material={sparkle} raycast={() => null} renderOrder={3} />
    </group>
  );
}
