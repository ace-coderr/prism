import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import {
  type OwnedViber,
  buildCrystal,
  exposedVoxels,
  type CorrelationInput,
  type CrystalHistory,
  type Holding,
} from '@prism/core';
import { glowTexture, outlinedFaceTexture, toonRamp } from './textures';
import { useFitSphere } from './Stage';
import { ViberBillboard } from './Viber';

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
  onClick,
  onPointerOver,
  onPointerOut,
}: CrystalProps) {
  const { voxels, radius, biggest } = useMemo(() => {
    const geo = buildCrystal(holdings, history, { correlation, maxShards: 48, resolution: isCoarse ? 7 : 8 });
    const biggest = geo.clusters.reduce((b, c, i) => (c.weight > (geo.clusters[b]?.weight ?? -1) ? i : b), 0);
    // interior cubes are never visible — skip them
    return { voxels: exposedVoxels(geo.voxels), radius: geo.radius, biggest };
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

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    if (spinner.current) spinner.current.rotation.y += spin * d;
    if (fit.current) {
      const k = highlight ? 1.12 : 1;
      fit.current.scale.setScalar(THREE.MathUtils.damp(fit.current.scale.x, targetScale * k, 8, d));
    }
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
      {float ? (
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
 * may use, e.g. to keep clear of overlaid text. With a `companion` (the holder's own
 * vibe viber), the crystal steps left and the viber stands on the ground beside it,
 * and the fit widens to include both.
 */
export function FittedCrystal({
  top,
  bottom,
  companion,
  ...props
}: CrystalProps & { top?: number; bottom?: number; companion?: OwnedViber | null }) {
  const size = props.size ?? 1.6;
  const reach = size * (props.highlight ? 1.12 : 1) + FLOAT_ALLOWANCE;
  const cy = useFitSphere(companion ? reach * 1.75 : reach, top, bottom);
  if (!companion) return <Crystal {...props} size={size} position={[0, cy, 0]} />;
  return (
    <>
      <Crystal {...props} size={size} position={[-size * 0.6, cy, 0]} />
      <ViberBillboard viber={companion} position={[size * 1.35, cy - size, 0.2]} height={size * 1.25} />
    </>
  );
}
