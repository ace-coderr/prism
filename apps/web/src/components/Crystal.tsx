import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import { useReducedMotion } from 'motion/react';
import * as THREE from 'three';
import {
  LIVE_CRACK_THRESHOLD,
  buildCrystal,
  exposedVoxels,
  seamYaw,
  type CorrelationInput,
  type CrystalHistory,
  type Holding,
} from '@prism/core';
import { glowTexture, outlinedFaceTexture, toonRamp } from './textures';
import { useFitSphere } from './Stage';

const cube = new THREE.BoxGeometry(1, 1, 1);
const OUTLINE = 1.14; // inverted-hull scale: thickness of the silhouette outline
// HDR gold (linear, slightly >1): crosses the bloom threshold for a warm glow, but
// stays low enough that each cube's black frame still reads through it.
const GOLD_HDR = new THREE.Color(2.5, 1.5, 0.24);
/** Sealed-gift frost tint and the grey used to dim parts the legend isn't pointing at. */
const FROST = new THREE.Color('#d6f1ff');
const DIM = new THREE.Color('#23282c');

export type CrystalFocus = 'size' | 'color' | 'spikes' | 'gold' | 'frost';

// shared materials — every crystal reuses the same two programs
const bodyMaterial = new THREE.MeshToonMaterial({
  map: outlinedFaceTexture(),
  gradientMap: toonRamp(),
  toneMapped: false,
});
const outlineMaterial = new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.BackSide });
const glowMaterial = new THREE.MeshBasicMaterial({
  map: glowTexture(),
  color: '#d4f000',
  transparent: true,
  opacity: 0.09,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
/** Seconds each cube takes to fly into place when a crystal assembles. */
const ASSEMBLE_SECONDS = 0.75;

export interface CrystalProps {
  holdings: Holding[];
  history?: CrystalHistory;
  correlation?: CorrelationInput;
  /** World-space radius the crystal is fitted to. */
  size?: number;
  /** Radians per second of idle spin. */
  spin?: number;
  float?: boolean;
  glow?: boolean;
  position?: [number, number, number];
  highlight?: boolean;
  /**
   * Legend focus: light up one part and dim the rest — the biggest holding ('size'),
   * the green/red price colours ('color'), the spikes ('spikes'), the gold seams
   * ('gold'), or the sealed-gift frost ('frost').
   */
  focus?: CrystalFocus | null;
  /** A sealed gift: the crystal is frosted over. */
  sealed?: boolean;
  /** Cubes fly in and assemble the crystal the first time it appears. */
  assemble?: boolean;
  /** Sway gently around the gold seam (kept facing the camera) instead of spinning. */
  sway?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
}

export function Crystal({
  holdings,
  history,
  correlation,
  size = 1.6,
  spin = 0.15,
  float = true,
  glow = true,
  position,
  highlight,
  focus = null,
  sealed = false,
  assemble = false,
  sway = false,
  onClick,
  onPointerOver,
  onPointerOut,
}: CrystalProps) {
  const reduce = useReducedMotion();
  const { voxels, radius, biggest, yaw } = useMemo(() => {
    const geo = buildCrystal(holdings, history, {
      correlation,
      maxShards: 48,
      resolution: isCoarse ? 7 : 8,
      crackThreshold: LIVE_CRACK_THRESHOLD,
    });
    const biggest = geo.clusters.reduce((b, c, i) => (c.weight > (geo.clusters[b]?.weight ?? -1) ? i : b), 0);
    // interior cubes are never visible — skip them
    return { voxels: exposedVoxels(geo.voxels), radius: geo.radius, biggest, yaw: seamYaw(geo) };
  }, [holdings, history, correlation]);

  // grow capacity in steps so the instanced buffers are rarely reallocated
  const capacity = Math.max(256, Math.ceil(voxels.length / 256) * 256);
  const body = useRef<THREE.InstancedMesh>(null);
  const hull = useRef<THREE.InstancedMesh>(null);
  const spinner = useRef<THREE.Group>(null);
  const fit = useRef<THREE.Group>(null);
  const targetScale = size / Math.max(radius, 0.001);

  useLayoutEffect(() => {
    const b = body.current;
    const h = hull.current;
    if (!b || !h) return;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    voxels.forEach((v, i) => {
      const [x, y, z] = v.position;
      m.makeTranslation(x, y, z);
      b.setMatrixAt(i, m);
      m.makeScale(OUTLINE, OUTLINE, OUTLINE).setPosition(x, y, z);
      h.setMatrixAt(i, m);
      if (v.gold) col.copy(GOLD_HDR);
      else col.set(v.color);
      const frost = sealed || focus === 'frost';
      if (frost) col.lerp(FROST, v.gold ? 0.35 : 0.62);
      if (focus && focus !== 'frost') {
        const lit =
          focus === 'gold'
            ? v.gold
            : focus === 'spikes'
              ? v.spike
              : focus === 'size'
                ? v.cluster === biggest && !v.gold
                : !v.gold && v.kind !== 'core'; // 'color'
        if (!lit) col.lerp(DIM, 0.82);
      }
      b.setColorAt(i, col);
    });
    b.count = h.count = voxels.length;
    b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    b.computeBoundingSphere();
    h.computeBoundingSphere();
  }, [voxels, capacity, focus, sealed, biggest]);

  // start at the fitted size; later changes ease in from useFrame
  useLayoutEffect(() => {
    fit.current?.scale.setScalar(targetScale);
  }, []);

  // the first time there is a shape: turn its gold seam (else a crack) to the camera
  const faced = useRef(false);
  useLayoutEffect(() => {
    if (faced.current || voxels.length === 0 || !spinner.current) return;
    spinner.current.rotation.y = yaw;
    faced.current = true;
  }, [voxels, yaw]);

  // assembly: every cube flies in from outside (inner cubes first) and grows into place
  const assembly = useRef<{ start: number; offsets: Float32Array; delays: Float32Array; done: boolean } | null>(null);
  const assembled = useRef(false);
  useLayoutEffect(() => {
    if (!assemble || reduce || assembled.current || voxels.length === 0) return;
    assembled.current = true;
    const offsets = new Float32Array(voxels.length * 3);
    const delays = new Float32Array(voxels.length);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    voxels.forEach((v, i) => {
      const [x, y, z] = v.position;
      const len = Math.hypot(x, y, z) || 1;
      const dist = radius * (1.4 + rand() * 1.8);
      offsets[i * 3] = (x / len) * dist + (rand() - 0.5) * radius;
      offsets[i * 3 + 1] = (y / len) * dist + (rand() - 0.5) * radius;
      offsets[i * 3 + 2] = (z / len) * dist + (rand() - 0.5) * radius;
      delays[i] = 0.05 + (len / radius) * 0.55 + rand() * 0.35;
    });
    assembly.current = { start: -1, offsets, delays, done: false };
  }, [voxels, assemble, reduce, radius]);

  const tmp = useMemo(() => new THREE.Matrix4(), []);
  useFrame((state, dt) => {
    const d = Math.min(dt, 0.1);
    if (spinner.current && !reduce) {
      if (sway) spinner.current.rotation.y = yaw + Math.sin(state.clock.elapsedTime * 0.35) * 0.55;
      else spinner.current.rotation.y += spin * d;
    }
    if (fit.current) {
      const k = highlight ? 1.12 : 1;
      fit.current.scale.setScalar(THREE.MathUtils.damp(fit.current.scale.x, targetScale * k, 8, d));
    }
    const a = assembly.current;
    const b = body.current;
    const h = hull.current;
    if (!a || a.done || !b || !h) return;
    if (a.start < 0) a.start = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - a.start;
    let done = true;
    voxels.forEach((v, i) => {
      const k = THREE.MathUtils.clamp((t - a.delays[i]!) / ASSEMBLE_SECONDS, 0, 1);
      if (k < 1) done = false;
      const e = 1 - (1 - k) ** 3;
      const [x, y, z] = v.position;
      const px = x + a.offsets[i * 3]! * (1 - e);
      const py = y + a.offsets[i * 3 + 1]! * (1 - e);
      const pz = z + a.offsets[i * 3 + 2]! * (1 - e);
      tmp.makeScale(e, e, e).setPosition(px, py, pz);
      b.setMatrixAt(i, tmp);
      tmp.makeScale(e * OUTLINE, e * OUTLINE, e * OUTLINE).setPosition(px, py, pz);
      h.setMatrixAt(i, tmp);
    });
    b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = true;
    if (done) a.done = true;
  });

  const crystal = (
    <group ref={spinner}>
      <group ref={fit}>
        <instancedMesh
          key={`b${capacity}`}
          ref={body}
          args={[cube, bodyMaterial, capacity]}
          onClick={onClick}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        />
        <instancedMesh key={`h${capacity}`} ref={hull} args={[cube, outlineMaterial, capacity]} raycast={() => null} />
      </group>
    </group>
  );

  return (
    <group position={position}>
      {glow && (
        <mesh material={glowMaterial} rotation-x={-Math.PI / 2} position-y={-size * 0.95} raycast={() => null}>
          <planeGeometry args={[size * 2.6, size * 2.6]} />
        </mesh>
      )}
      {float && !reduce ? (
        <Float speed={1.4} rotationIntensity={0.2} floatIntensity={0.5}>
          {crystal}
        </Float>
      ) : (
        crystal
      )}
    </group>
  );
}

/** Float moves the crystal by up to ±0.05 world units — included in the fitted sphere. */
const FLOAT_ALLOWANCE = 0.06;

/**
 * A crystal with the camera fitted to its bounding sphere, so it always stays fully
 * in view (desktop and phone). `top` / `bottom` are the band of the canvas height it
 * may use, e.g. to keep clear of overlaid text.
 */
export function FittedCrystal({ top, bottom, ...props }: CrystalProps & { top?: number; bottom?: number }) {
  const size = props.size ?? 1.6;
  const reach = size * (props.highlight ? 1.12 : 1) + FLOAT_ALLOWANCE;
  const cy = useFitSphere(reach, top, bottom);
  return <Crystal {...props} size={size} position={[0, cy, 0]} />;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const LOADING_HOLDINGS: Holding[] = [{ symbol: 'loading', weight: 1, change24h: Number.NaN, volatility: 0.12 }];
const LOADING_COLOR = new THREE.Color('#7d8670');
/** Seconds for one fly-in, hold, fly-out cycle of the loading crystal. */
const LOADING_CYCLE = 3.4;

/**
 * Shown while a crystal's data loads: a neutral gem whose cubes keep flying in,
 * holding together and drifting apart. Static under prefers-reduced-motion.
 */
export function LoadingCrystal({ size = 1.6, position }: { size?: number; position?: [number, number, number] }) {
  const reduce = useReducedMotion();
  const shape = useMemo(() => {
    const geo = buildCrystal(LOADING_HOLDINGS, undefined, { resolution: 6, maxShards: 6 });
    const voxels = exposedVoxels(geo.voxels);
    let seed = 13;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const offsets = voxels.map((v) => {
      const [x, y, z] = v.position;
      const len = Math.hypot(x, y, z) || 1;
      const dist = geo.radius * (1.2 + rand() * 1.4);
      return [(x / len) * dist, (y / len) * dist, (z / len) * dist, (len / geo.radius) * 0.35 + rand() * 0.25] as const;
    });
    return { voxels, offsets, radius: geo.radius };
  }, []);
  const body = useRef<THREE.InstancedMesh>(null);
  const hull = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const n = shape.voxels.length;
  const tmp = useMemo(() => new THREE.Matrix4(), []);

  const place = (t: number) => {
    const b = body.current;
    const h = hull.current;
    if (!b || !h) return;
    // 0..0.45 fly in, 0.45..0.75 hold, 0.75..1 drift apart
    const phase = (t % LOADING_CYCLE) / LOADING_CYCLE;
    shape.voxels.forEach((v, i) => {
      const [ox, oy, oz, d] = shape.offsets[i]!;
      const inK = THREE.MathUtils.clamp((phase / 0.45 - d) / 0.4, 0, 1);
      const outK = THREE.MathUtils.clamp((phase - 0.75) / 0.25 - d * 0.5, 0, 1);
      const k = reduce ? 1 : (1 - (1 - inK) ** 3) * (1 - outK * outK);
      const [x, y, z] = v.position;
      const s = 0.25 + 0.75 * k;
      tmp.makeScale(k * s, k * s, k * s).setPosition(x + ox * (1 - k), y + oy * (1 - k), z + oz * (1 - k));
      b.setMatrixAt(i, tmp);
      tmp.makeScale(k * s * OUTLINE, k * s * OUTLINE, k * s * OUTLINE).setPosition(x + ox * (1 - k), y + oy * (1 - k), z + oz * (1 - k));
      h.setMatrixAt(i, tmp);
    });
    b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => {
    const b = body.current;
    if (!b) return;
    shape.voxels.forEach((_, i) => b.setColorAt(i, LOADING_COLOR));
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    place(reduce ? 0 : LOADING_CYCLE * 0.6);
  }, [shape, reduce]);

  useFrame((state) => {
    if (reduce) return;
    place(state.clock.elapsedTime);
    if (group.current) group.current.rotation.y = state.clock.elapsedTime * 0.35;
  });

  return (
    <group position={position}>
      <group ref={group} scale={size / Math.max(shape.radius, 0.001)}>
        <instancedMesh ref={body} args={[cube, bodyMaterial, n]} raycast={() => null} />
        <instancedMesh ref={hull} args={[cube, outlineMaterial, n]} raycast={() => null} />
      </group>
    </group>
  );
}

/** The loading crystal, fitted to the canvas like FittedCrystal. */
export function FittedLoadingCrystal({ size = 1.6, top, bottom }: { size?: number; top?: number; bottom?: number }) {
  const cy = useFitSphere(size + FLOAT_ALLOWANCE, top, bottom);
  return <LoadingCrystal size={size} position={[0, cy, 0]} />;
}
