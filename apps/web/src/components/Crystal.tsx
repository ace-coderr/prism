import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Float, Line } from '@react-three/drei';
import * as THREE from 'three';
import {
  buildCrystal,
  KINTSUGI_GOLD,
  type CorrelationInput,
  type CrystalHistory,
  type Holding,
} from '@prism/core';

const MAX_SHARDS = 96;

// A unit quartz point: hexagonal prism with a pyramid tip, base sunk into the core.
// 6 radial segments keeps it faceted and cheap (~50 tris).
const shardGeometry = (() => {
  const profile = [
    new THREE.Vector2(0, -0.5),
    new THREE.Vector2(0.44, -0.36),
    new THREE.Vector2(0.5, 0.18),
    new THREE.Vector2(0, 0.5),
  ];
  const g = new THREE.LatheGeometry(profile, 6);
  g.computeVertexNormals();
  return g;
})();

const coreGeometry = new THREE.IcosahedronGeometry(1, 0);

const goldColor = new THREE.Color(KINTSUGI_GOLD).multiplyScalar(2.4); // >1 so bloom catches it
const crackColor = new THREE.Color('#d7deeb');

export interface CrystalProps {
  holdings: Holding[];
  history?: CrystalHistory;
  correlation?: CorrelationInput;
  /** World-space radius the crystal is fitted to. */
  size?: number;
  /** Radians per second of idle spin. */
  spin?: number;
  float?: boolean;
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
  position,
  highlight,
  onClick,
  onPointerOver,
  onPointerOut,
}: CrystalProps) {
  const geo = useMemo(
    () => buildCrystal(holdings, history, { correlation, maxShards: 64 }),
    [holdings, history, correlation],
  );
  const mesh = useRef<THREE.InstancedMesh>(null);
  const spinner = useRef<THREE.Group>(null);
  const fit = useRef<THREE.Group>(null);
  const targetScale = size / Math.max(geo.boundingRadius, 0.001);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    const count = Math.min(geo.shards.length, MAX_SHARDS);
    for (let i = 0; i < count; i++) {
      const s = geo.shards[i]!;
      mat.compose(pos.fromArray(s.position), quat.fromArray(s.quaternion), scl.fromArray(s.scale));
      m.setMatrixAt(i, mat);
      m.setColorAt(i, col.set(s.color));
    }
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [geo]);

  // start at the fitted size; later changes ease in from useFrame
  useLayoutEffect(() => {
    fit.current?.scale.setScalar(targetScale);
  }, []);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    if (spinner.current) spinner.current.rotation.y += spin * d;
    // ease toward the fitted scale so reshaping (e.g. Forge sliders) feels fluid
    if (fit.current) {
      const k = highlight ? 1.12 : 1;
      const cur = fit.current.scale.x;
      const next = THREE.MathUtils.damp(cur, targetScale * k, 8, d);
      fit.current.scale.setScalar(next);
    }
  });

  const body = (
    <group ref={spinner}>
      <group ref={fit}>
        <instancedMesh
          ref={mesh}
          args={[shardGeometry, undefined, MAX_SHARDS]}
          onClick={onClick}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        >
          <meshPhysicalMaterial
            flatShading
            transmission={0.85}
            thickness={0.8}
            roughness={0.06}
            ior={1.55}
            clearcoat={1}
            clearcoatRoughness={0.05}
            iridescence={0.35}
            iridescenceIOR={1.3}
            envMapIntensity={1.6}
            specularIntensity={1}
          />
        </instancedMesh>

        <mesh geometry={coreGeometry} scale={geo.core.radius} onClick={onClick}>
          <meshPhysicalMaterial
            flatShading
            color={geo.core.color}
            transmission={1}
            thickness={1.2}
            roughness={0.02}
            ior={2.0}
            iridescence={1}
            iridescenceIOR={1.6}
            envMapIntensity={2}
          />
        </mesh>

        {geo.cracks.map((c, i) => (
          <Line
            key={i}
            points={c.points}
            color={c.gold ? goldColor : crackColor}
            lineWidth={c.gold ? 2.6 : 1.4}
            transparent
            opacity={c.gold ? 0.95 : 0.6}
            toneMapped={false}
            // seams glow through the glass instead of hiding behind facets
            depthTest={false}
            renderOrder={10}
          />
        ))}
      </group>
    </group>
  );

  return (
    <group position={position}>
      {float ? (
        <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.6}>
          {body}
        </Float>
      ) : (
        body
      )}
    </group>
  );
}
