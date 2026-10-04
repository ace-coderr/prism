import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { candlePanelTexture } from './textures';

const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const BG = '#101214';

interface StageProps {
  children: ReactNode;
  camera?: { position: [number, number, number]; fov?: number };
  className?: string;
  bloom?: boolean;
  backdrop?: boolean;
}

/**
 * Shared canvas: capped pixel ratio, flat toon lighting, bloom tuned so only
 * gold (instance colors > 1) glows, and a market-screen backdrop that is
 * dropped on touch devices and whenever the frame rate dips.
 */
export function Stage({ children, camera, className, bloom = true, backdrop = true }: StageProps) {
  const [dprMax, setDprMax] = useState(isCoarse ? 1.25 : 1.75);
  const [fx, setFx] = useState(!isCoarse);

  return (
    <Canvas
      className={className}
      dpr={[1, dprMax]}
      camera={{ position: camera?.position ?? [0, 0, 6], fov: camera?.fov ?? 40 }}
      gl={{ antialias: !bloom, powerPreference: 'high-performance', alpha: false }}
    >
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 14, 34]} />
      <PerformanceMonitor
        onDecline={() => {
          setDprMax(1);
          setFx(false);
        }}
      />
      <AdaptiveDpr pixelated={false} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 7, 5]} intensity={0.75} />
      <directionalLight position={[-5, -2, -3]} intensity={0.2} color="#d4f000" />

      {backdrop && fx && <Backdrop />}
      <Suspense fallback={null}>{children}</Suspense>

      {bloom && (
        <EffectComposer multisampling={isCoarse ? 0 : 4}>
          <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.05} intensity={1.6} radius={0.65} />
        </EffectComposer>
      )}
    </Canvas>
  );
}

/** A ring of dark floating "market screens" around the scene. One shared geometry, three textures. */
function Backdrop() {
  const panels = useMemo(() => {
    const geom = new THREE.PlaneGeometry(6.4, 3.6);
    const textures = [0, 1, 2].map((i) => candlePanelTexture(i + 3));
    return Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const r = 15 + (i % 2) * 3;
      const material = new THREE.MeshBasicMaterial({
        map: textures[i % 3],
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      return {
        geom,
        material,
        position: [Math.sin(a) * r, (i % 3) * 2.2 - 1.5, -Math.cos(a) * r] as [number, number, number],
        rotationY: -a,
      };
    });
  }, []);
  return (
    <group>
      {panels.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geom}
          material={p.material}
          position={p.position}
          rotation-y={p.rotationY}
          raycast={() => null}
        />
      ))}
    </group>
  );
}

/**
 * Lay `n` items out in a row on wide screens and a column on tall ones,
 * returning world positions and a size that fits the current viewport.
 */
export function useRowLayout(n: number, gapFactor = 1) {
  const viewport = useThree((s) => s.viewport);
  const wide = viewport.aspect >= 1;
  const span = wide ? viewport.width : viewport.height;
  const cell = span / n;
  const size = Math.min(cell * 0.36 * gapFactor, (wide ? viewport.height : viewport.width) * 0.3);
  const positions = Array.from({ length: n }, (_, i) => {
    const offset = (i - (n - 1) / 2) * cell;
    return (wide ? [offset, 0, 0] : [0, -offset, 0]) as [number, number, number];
  });
  return { positions, size, wide };
}
