import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import { useReducedMotion } from 'motion/react';
import * as THREE from 'three';
import {
  LIVE_CRACK_THRESHOLD,
  buildCrystal,
  exposedVoxels,
  regionBorders,
  seamYaw,
  type CorrelationInput,
  type CrystalHistory,
  type Holding,
} from '@prism/core';
import { glowTexture, outlinedFaceTexture, toonRamp } from './textures';
import { SceneLabel, useFitSphere } from './Stage';
import { moveLabel, weightLabel, type LabelOf } from './AssetDots';
import { FrostShell } from './FrostShell';

const cube = new THREE.BoxGeometry(1, 1, 1);
const OUTLINE = 1.14; // inverted-hull scale: thickness of the silhouette outline
// HDR gold (linear, slightly >1): crosses the bloom threshold for a warm glow, but
// stays low enough that each cube's black frame still reads through it.
const GOLD_HDR = new THREE.Color(2.5, 1.5, 0.24);
/** Sealed-gift frost tint and the grey used to dim parts the legend isn't pointing at. */
const FROST = new THREE.Color('#d6f1ff');
const DIM = new THREE.Color('#23282c');
const hsl = { h: 0, s: 0, l: 0 };
/**
 * Seams between holdings: a dark strip this wide (in cubes) on each face along a border,
 * so neighbouring regions read as separate blocks even in similar shades. A cube's own
 * frame is ~0.09 per face, so a seam is well over twice as thick as the grid lines.
 */
const SEAM_WIDTH = 0.24;
const SEAM_DEPTH = 0.02;

export type CrystalFocus = 'size' | 'color' | 'spikes' | 'gold' | 'frost';

// shared materials — every crystal reuses the same programs
const bodyMaterial = new THREE.MeshToonMaterial({
  map: outlinedFaceTexture(),
  gradientMap: toonRamp(),
  toneMapped: false,
});
const outlineMaterial = new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.BackSide });
const seamMaterial = new THREE.MeshBasicMaterial({ color: '#000000' });
const glowMaterial = new THREE.MeshBasicMaterial({
  map: glowTexture(),
  color: '#d4f000',
  transparent: true,
  opacity: 0.09,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const noRaycast = () => null;

const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
/** Seconds each cube takes to fly into place when a crystal assembles. */
const ASSEMBLE_SECONDS = 0.75;
/** How long unwrapping a gift takes (a short fade under prefers-reduced-motion). */
const UNWRAP_SECONDS = 2.6;
const UNWRAP_SECONDS_REDUCED = 0.5;
/** A tapped holding stays picked this long (touch has no "pointer left"). */
const TAP_HOLD_MS = 5000;

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
  /** A sealed (or still wrapped) gift: the crystal sits in a shell of ice with sparkles. */
  sealed?: boolean;
  /** Plays the unwrap: the ice cracks, thaws and shatters into sparkles. */
  unwrapping?: boolean;
  /** Called once the unwrap animation has finished. */
  onUnwrapped?: () => void;
  /** Cubes fly in and assemble the crystal the first time it appears. */
  assemble?: boolean;
  /** Sway gently around the gold seam (kept facing the camera) instead of spinning. */
  sway?: boolean;
  /** Tint every cube with this hue (0..1), keeping its lightness: the address identicon. */
  hue?: number;
  /**
   * Hovering (or tapping) a holding lights it up and names it: "NVDA · 40% · +28.6% today".
   * On by default for real crystals; an identicon (`hue`) is not a basket, so off there.
   */
  identify?: boolean;
  /** How symbols are shown in that label. */
  labelOf?: LabelOf;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
}

interface Picked {
  cluster: number;
  /** where it was pointed at, in the crystal's own (cube) space */
  at: [number, number, number];
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
  unwrapping = false,
  onUnwrapped,
  assemble = false,
  sway = false,
  hue,
  identify = hue === undefined,
  labelOf,
  onClick,
  onPointerOver,
  onPointerOut,
}: CrystalProps) {
  const reduce = useReducedMotion();
  const tinted = hue !== undefined;
  const { voxels, solid, clusters, radius, biggest, yaw, seams } = useMemo(() => {
    const geo = buildCrystal(holdings, history, {
      correlation,
      maxShards: 48,
      resolution: isCoarse ? 7 : 8,
      crackThreshold: LIVE_CRACK_THRESHOLD,
    });
    const biggest = geo.clusters.reduce((b, c, i) => (c.weight > (geo.clusters[b]?.weight ?? -1) ? i : b), 0);
    // interior cubes are never visible — skip them
    const voxels = exposedVoxels(geo.voxels);
    // seams between holdings (an identicon has none), each kept relative to the cube it
    // lies on so it flies in with that cube
    const index = new Map(voxels.map((v, i) => [v.position.join(','), i]));
    const strips = tinted ? [] : regionBorders(geo.voxels);
    const seams = { cell: new Int32Array(strips.length), offset: new Float32Array(strips.length * 3), scale: new Float32Array(strips.length * 3) };
    strips.forEach((s, i) => {
      seams.cell[i] = index.get(s.cell.join(',')) ?? -1;
      for (let a = 0; a < 3; a++) {
        seams.offset[i * 3 + a] = s.edge[a]! - s.cell[a]! + s.inward[a]! * (SEAM_WIDTH / 2) + s.normal[a]! * (SEAM_DEPTH / 2);
        seams.scale[i * 3 + a] = a === s.along ? 1 + SEAM_WIDTH : s.normal[a] !== 0 ? SEAM_DEPTH : SEAM_WIDTH;
      }
    });
    return { voxels, solid: geo.voxels, clusters: geo.clusters, radius: geo.radius, biggest, yaw: seamYaw(geo), seams };
  }, [holdings, history, correlation, tinted]);

  // grow capacity in steps so the instanced buffers are rarely reallocated
  const capacity = Math.max(256, Math.ceil(voxels.length / 256) * 256);
  const seamCapacity = Math.max(256, Math.ceil(seams.cell.length / 256) * 256);
  const body = useRef<THREE.InstancedMesh>(null);
  const hull = useRef<THREE.InstancedMesh>(null);
  const seam = useRef<THREE.InstancedMesh>(null);
  const spinner = useRef<THREE.Group>(null);
  const fit = useRef<THREE.Group>(null);
  const targetScale = size / Math.max(radius, 0.001);

  // the holding being pointed at (hover) or tapped
  const [picked, setPicked] = useState<Picked | null>(null);
  const pickedRef = useRef<Picked | null>(null);
  pickedRef.current = picked;
  useEffect(() => setPicked(null), [voxels]);
  const tapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(tapTimer.current);
      clearTimeout(leaveTimer.current);
    },
    [],
  );

  // assembly: every cube flies in from outside (inner cubes first) and grows into place
  const assembly = useRef<{ start: number; offsets: Float32Array; delays: Float32Array; done: boolean } | null>(null);
  const assembled = useRef(false);

  /** Put every cube at scale `scaleOf(i)` and position `posOf(i)`, and the seams on them. */
  const place = useMemo(() => {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const ks = new Float32Array(voxels.length);
    const ps = new Float32Array(voxels.length * 3);
    return (scaleOf: (i: number) => number, posOf: (i: number, at: THREE.Vector3) => THREE.Vector3) => {
      const b = body.current;
      const h = hull.current;
      if (!b || !h) return;
      voxels.forEach((v, i) => {
        const e = scaleOf(i);
        posOf(i, p.set(v.position[0], v.position[1], v.position[2]));
        ks[i] = e;
        ps[i * 3] = p.x;
        ps[i * 3 + 1] = p.y;
        ps[i * 3 + 2] = p.z;
        m.makeScale(e, e, e).setPosition(p);
        b.setMatrixAt(i, m);
        m.makeScale(e * OUTLINE, e * OUTLINE, e * OUTLINE).setPosition(p);
        h.setMatrixAt(i, m);
      });
      b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = true;
      const s = seam.current;
      if (!s) return;
      const n = seams.cell.length;
      for (let i = 0; i < n; i++) {
        const c = seams.cell[i]!;
        const e = c >= 0 ? ks[c]! : 0;
        m.makeScale(seams.scale[i * 3]! * e, seams.scale[i * 3 + 1]! * e, seams.scale[i * 3 + 2]! * e);
        m.setPosition(ps[c * 3]! + seams.offset[i * 3]! * e, ps[c * 3 + 1]! + seams.offset[i * 3 + 1]! * e, ps[c * 3 + 2]! + seams.offset[i * 3 + 2]! * e);
        s.setMatrixAt(i, m);
      }
      s.count = n;
      s.instanceMatrix.needsUpdate = true;
    };
  }, [voxels, seams]);

  useLayoutEffect(() => {
    const b = body.current;
    const h = hull.current;
    if (!b || !h) return;
    b.count = h.count = voxels.length;
    const flying = assemble && !reduce && !assembled.current;
    place(() => (flying ? 0 : 1), (_, p) => p); // a crystal about to assemble starts hidden
    b.computeBoundingSphere();
    h.computeBoundingSphere();
    seam.current?.computeBoundingSphere();
  }, [voxels, capacity, seamCapacity, place, assemble, reduce]);

  /** Colour every cube; `frost` 0..1 is how iced-over it is (it fades while unwrapping). */
  const paint = useMemo(() => {
    const col = new THREE.Color();
    return (frost: number) => {
      const b = body.current;
      if (!b) return;
      const target = picked?.cluster ?? null;
      voxels.forEach((v, i) => {
        if (v.gold) col.copy(GOLD_HDR);
        else col.set(v.color);
        if (tinted && !v.gold) {
          col.getHSL(hsl);
          col.setHSL(hue!, Math.max(0.55, hsl.s), hsl.l);
        }
        // under the ice the shades still show through
        if (frost > 0) col.lerp(FROST, frost * (v.gold ? 0.2 : 0.3));
        if (target !== null) {
          // identify: the pointed-at holding stays as it is, the rest steps back
          if (v.cluster !== target) col.lerp(DIM, 0.62);
        } else if (focus && focus !== 'frost') {
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
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    };
  }, [voxels, focus, biggest, hue, tinted, picked]);

  // ice: a sealed or still-wrapped gift (and the legend's "Frost" line); unwrapping thaws it
  const iced = sealed || focus === 'frost';
  const unwrapProgress = useRef<number | null>(null);
  const unwrapStart = useRef<number | null>(null);
  const unwrapDone = useRef(false);
  useEffect(() => {
    if (!unwrapping) {
      unwrapProgress.current = null;
      unwrapStart.current = null;
      unwrapDone.current = false;
    }
  }, [unwrapping]);
  useLayoutEffect(() => {
    paint(iced && !(unwrapping && unwrapDone.current) ? 1 : 0);
  }, [paint, capacity, iced, unwrapping]);

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

  // sway keeps its own clock so it can pause while a holding is picked
  const swayClock = useRef(0);
  const eased = useMemo(() => new Float32Array(voxels.length), [voxels]);
  useFrame((state, dt) => {
    const d = Math.min(dt, 0.1);
    if (spinner.current && !reduce && !pickedRef.current) {
      if (sway) {
        swayClock.current += d;
        spinner.current.rotation.y = yaw + Math.sin(swayClock.current * 0.35) * 0.55;
      } else spinner.current.rotation.y += spin * d;
    }
    if (fit.current) {
      const k = highlight ? 1.12 : 1;
      fit.current.scale.setScalar(THREE.MathUtils.damp(fit.current.scale.x, targetScale * k, 8, d));
    }
    // unwrap: the ice cracks, thaws and shatters while the crystal's own colours come back
    if (unwrapping && iced && !unwrapDone.current) {
      if (unwrapStart.current === null) unwrapStart.current = state.clock.elapsedTime;
      const t = Math.min(1, (state.clock.elapsedTime - unwrapStart.current) / (reduce ? UNWRAP_SECONDS_REDUCED : UNWRAP_SECONDS));
      unwrapProgress.current = t;
      const reveal = THREE.MathUtils.smoothstep(t, 0.35, 1);
      paint(1 - reveal);
      if (t >= 1) {
        unwrapDone.current = true;
        onUnwrapped?.();
      }
    }
    const a = assembly.current;
    if (!a || a.done) return;
    if (a.delays.length !== voxels.length) {
      // the shape changed mid-flight (fresh prices): just show the new one whole
      a.done = true;
      place(() => 1, (_, p) => p);
      return;
    }
    if (a.start < 0) a.start = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - a.start;
    let done = true;
    for (let i = 0; i < voxels.length; i++) {
      const k = THREE.MathUtils.clamp((t - a.delays[i]!) / ASSEMBLE_SECONDS, 0, 1);
      if (k < 1) done = false;
      eased[i] = 1 - (1 - k) ** 3;
    }
    place(
      (i) => eased[i]!,
      (i, p) => {
        const r = 1 - eased[i]!;
        return p.set(p.x + a.offsets[i * 3]! * r, p.y + a.offsets[i * 3 + 1]! * r, p.z + a.offsets[i * 3 + 2]! * r);
      },
    );
    if (done) a.done = true;
  });

  // ---- identify: hover with a mouse, tap on touch
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>): Picked | null => {
    const v = e.instanceId !== undefined ? voxels[e.instanceId] : undefined;
    if (!v || v.cluster < 0 || !fit.current) return null;
    const at = fit.current.worldToLocal(e.point.clone());
    return { cluster: v.cluster, at: [at.x, at.y, at.z] };
  };
  const handlers = identify
    ? {
        onPointerMove: (e: ThreeEvent<PointerEvent>) => {
          if (e.pointerType !== 'mouse') return;
          e.stopPropagation();
          clearTimeout(leaveTimer.current);
          const p = pick(e);
          if (p?.cluster !== pickedRef.current?.cluster) setPicked(p);
        },
        onPointerOut: (e: ThreeEvent<PointerEvent>) => {
          onPointerOut?.(e);
          // fires on every cube-to-cube step too (each cube is its own instance), so only
          // clear if no move on the crystal follows
          if (e.pointerType === 'mouse') {
            clearTimeout(leaveTimer.current);
            leaveTimer.current = setTimeout(() => setPicked(null), 60);
          }
        },
        onClick: (e: ThreeEvent<MouseEvent>) => {
          onClick?.(e);
          // (older Safari's click is a plain MouseEvent: fall back to the device's pointer)
          const kind = (e.nativeEvent as Partial<PointerEvent>).pointerType || (isCoarse ? 'touch' : 'mouse');
          const touch = kind !== 'mouse';
          // a drag (orbiting the gallery) is not a tap
          if (!touch || e.delta > 8) return;
          e.stopPropagation();
          const p = pick(e);
          const next = p && p.cluster === pickedRef.current?.cluster ? null : p;
          setPicked(next);
          clearTimeout(tapTimer.current);
          if (next) tapTimer.current = setTimeout(() => setPicked(null), TAP_HOLD_MS);
        },
        onPointerMissed: () => setPicked(null),
      }
    : { onClick, onPointerOut };

  const shown = picked ? clusters[picked.cluster] : undefined;
  const crystal = (
    <group ref={spinner}>
      <group ref={fit}>
        <instancedMesh key={`b${capacity}`} ref={body} args={[cube, bodyMaterial, capacity]} onPointerOver={onPointerOver} {...handlers} />
        <instancedMesh key={`h${capacity}`} ref={hull} args={[cube, outlineMaterial, capacity]} raycast={noRaycast} />
        <instancedMesh key={`s${seamCapacity}`} ref={seam} args={[cube, seamMaterial, seamCapacity]} raycast={noRaycast} />
        {iced && !tinted && !(unwrapping && unwrapDone.current) && <FrostShell voxels={solid} unwrap={unwrapProgress} reduce={reduce} />}
        {shown && picked && (
          <SceneLabel position={picked.at} zIndexRange={[40, 30]}>
            <HoldingTag name={labelOf ? labelOf(shown.symbol) : shown.symbol} weight={shown.weight} change={shown.change24h} color={shown.color} />
          </SceneLabel>
        )}
      </group>
    </group>
  );

  return (
    <group position={position}>
      {glow && (
        <mesh material={glowMaterial} rotation-x={-Math.PI / 2} position-y={-size * 0.95} raycast={noRaycast}>
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

/** The small label over a pointed-at holding: "● NVDA · 40% · +28.6% today". */
function HoldingTag({ name, weight, change, color }: { name: string; weight: number; change: number; color: string }) {
  const move = moveLabel(change);
  return (
    <div
      role="status"
      className="pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-ink/95 px-3 py-1.5 font-mono text-[11px] text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]"
      style={{ transform: 'translate(-50%, calc(-100% - 14px))' }}
    >
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/70" style={{ background: color }} />
      <span className="font-bold">{name}</span>
      <span className="text-mist">·</span>
      <span>{weightLabel(weight)}</span>
      <span className="text-mist">·</span>
      {move ? (
        <span>
          <span className={change >= 0 ? 'text-up' : 'text-down'}>{move}</span> <span className="text-mist">today</span>
        </span>
      ) : (
        <span className="text-mist">no price yet</span>
      )}
    </div>
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
