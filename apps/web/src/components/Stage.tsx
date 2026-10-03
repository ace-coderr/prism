import { Suspense, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';

const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

interface StageProps {
  children: ReactNode;
  camera?: { position: [number, number, number]; fov?: number };
  className?: string;
  bloom?: boolean;
}

/**
 * Shared canvas: capped pixel ratio, studio lighting built from local
 * lightformers (no HDR download), soft bloom, and auto-degrade on slow devices.
 */
export function Stage({ children, camera, className, bloom = true }: StageProps) {
  const [dprMax, setDprMax] = useState(isCoarse ? 1.25 : 1.75);
  const [fx, setFx] = useState(true);

  return (
    <Canvas
      className={className}
      dpr={[1, dprMax]}
      camera={{ position: camera?.position ?? [0, 0, 6], fov: camera?.fov ?? 40 }}
      gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
    >
      <PerformanceMonitor
        onDecline={() => {
          setDprMax(1);
          setFx(false);
        }}
      />
      <AdaptiveDpr pixelated={false} />

      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 6, 3]} intensity={1.2} />

      <Environment resolution={128} frames={1} background backgroundBlurriness={0.7} backgroundIntensity={0.12}>
        <Lightformer form="rect" intensity={3} position={[0, 4, -6]} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={2} color="#9db7ff" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={2} color="#ffb0e0" position={[5, -1, -1]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="ring" intensity={4} color="#ffffff" position={[0, 0, 6]} scale={3} />
        <Lightformer form="rect" intensity={1} color="#7affc8" position={[0, -5, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
      </Environment>

      <Suspense fallback={null}>{children}</Suspense>

      {bloom && fx && (
        <EffectComposer multisampling={isCoarse ? 0 : 4}>
          <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={0.7} radius={0.7} />
        </EffectComposer>
      )}
    </Canvas>
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
  const size = Math.min(cell * 0.38 * gapFactor, (wide ? viewport.height : viewport.width) * 0.32);
  const positions = Array.from({ length: n }, (_, i) => {
    const offset = (i - (n - 1) / 2) * cell;
    return (wide ? [offset, 0, 0] : [0, -offset, 0]) as [number, number, number];
  });
  return { positions, size, wide };
}

