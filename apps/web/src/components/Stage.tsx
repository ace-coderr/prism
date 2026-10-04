import { Suspense, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
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
          {/* a warm glow on gold only — low enough that every gold cube keeps its black outline */}
          <Bloom mipmapBlur luminanceThreshold={0.95} luminanceSmoothing={0.15} intensity={0.55} radius={0.4} />
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
 * Fits the camera to a bounding sphere: moves the (perspective) camera back until a
 * sphere of `radius` fits inside the horizontal band [top, bottom] of the canvas
 * (fractions of its height, 0 = top edge) and inside `side` of its width, with `pad`
 * extra room. Returns the world y to place the sphere's centre at so it sits in that band.
 */
export function useFitSphere(radius: number, top = 0.08, bottom = 0.92, side = 0.86, pad = 0.12) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const fov = 'fov' in camera ? (camera as THREE.PerspectiveCamera).fov : 40;
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanH = tanV * (size.width / Math.max(1, size.height));
  const band = Math.max(0.05, bottom - top);
  const r = radius * (1 + pad);
  // perspective-correct: a sphere at distance d subtends asin(r/d), so solve with sin → tan
  const fitV = r / Math.sin(Math.atan(band * tanV));
  const fitH = r / Math.sin(Math.atan(side * tanH));
  const distance = Math.max(fitV, fitH, r * 2);
  const centerY = (0.5 - (top + bottom) / 2) * 2 * distance * tanV;

  useLayoutEffect(() => {
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, distance]);

  return centerY;
}

/**
 * Lay `n` items out in a row on wide screens and a column on tall ones, returning
 * world positions and a radius that keeps every item fully in view — including
 * perspective (an off-centre sphere's near side projects further out), the 1.12×
 * selection highlight and the float.
 */
export function useRowLayout(n: number, gapFactor = 1) {
  const viewport = useThree((s) => s.viewport);
  const distance = useThree((s) => s.camera.position.length());
  const wide = viewport.aspect >= 1;
  // stacked (phone) layouts keep a margin top and bottom for overlaid captions
  const span = wide ? viewport.width : viewport.height * 0.86;
  const cell = span / n;
  const halfMain = (span / 2) * 0.95;
  const halfCross = ((wide ? viewport.height : viewport.width) / 2) * 0.9;
  const outer = ((n - 1) / 2) * cell;
  // largest radius s with (offset + s)·d / (d − s) ≤ half-extent, on both axes
  const fitMain = (distance * (halfMain - outer)) / (distance + halfMain);
  const fitCross = (distance * halfCross) / (distance + halfCross);
  const HIGHLIGHT = 1.12;
  const FLOAT = 0.06;
  const size = Math.max(
    0.2,
    Math.min((cell / 2) * 0.82 * gapFactor, (Math.min(fitMain, fitCross) - FLOAT) / HIGHLIGHT),
  );
  const positions = Array.from({ length: n }, (_, i) => {
    const offset = (i - (n - 1) / 2) * cell;
    return (wide ? [offset, 0, 0] : [0, -offset, 0]) as [number, number, number];
  });
  return { positions, size, wide };
}
