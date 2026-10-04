import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import {
  buildCrystal,
  exposedVoxels,
  type CorrelationInput,
  type CrystalHistory,
  type Holding,
} from '@prism/core';
import { glowTexture, outlinedFaceTexture, toonRamp } from './textures';

const cube = new THREE.BoxGeometry(1, 1, 1);
const OUTLINE = 1.14; // inverted-hull scale: thickness of the silhouette outline
// HDR gold (linear, >1) so only kintsugi cubes cross the bloom threshold; orange-heavy so the halo stays gold
const GOLD_HDR = new THREE.Color(4.2, 2.3, 0.35);

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
  onClick,
  onPointerOver,
  onPointerOut,
}: CrystalProps) {
  const { voxels, radius } = useMemo(() => {
    const geo = buildCrystal(holdings, history, { correlation, maxShards: 48, resolution: isCoarse ? 7 : 8 });
    // interior cubes are never visible — skip them
    return { voxels: exposedVoxels(geo.voxels), radius: geo.radius };
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
      b.setColorAt(i, col);
    });
    b.count = h.count = voxels.length;
    b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    b.computeBoundingSphere();
    h.computeBoundingSphere();
  }, [voxels, capacity]);

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
