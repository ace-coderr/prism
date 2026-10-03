import { useMemo, useState } from 'react';
import { Html, OrbitControls } from '@react-three/drei';
import { Crystal } from '../components/Crystal';
import { Stage } from '../components/Stage';
import { usd } from '../components/ui';
import { CORRELATIONS, GALLERY, toHoldings } from '../data/mock';

// two staggered rings so every crystal is visible from the default angle
const POSITIONS = GALLERY.map((_, i) => {
  const outer = i % 2 === 1;
  const a = (i / GALLERY.length) * Math.PI * 2;
  const r = outer ? 5.2 : 3.4;
  const y = (outer ? 0.9 : -0.9) + Math.sin(a * 3) * 0.4;
  return [Math.cos(a) * r, y, Math.sin(a) * r] as [number, number, number];
});

function Field() {
  const [hover, setHover] = useState<number | null>(null);
  const holdings = useMemo(() => GALLERY.map((c) => toHoldings(c.weights)), []);
  return (
    <>
      {GALLERY.map((c, i) => {
        const p = POSITIONS[i]!;
        return (
          <group key={c.id}>
            <Crystal
              holdings={holdings[i]!}
              history={c.history}
              correlation={CORRELATIONS}
              position={p}
              size={0.95}
              spin={0.12 + (i % 3) * 0.05}
              highlight={hover === i}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(i);
              }}
              onPointerOut={() => setHover((h) => (h === i ? null : h))}
            />
            {hover === i && (
              <Html position={[p[0], p[1] - 1.35, p[2]]} center>
                <div className="pointer-events-none whitespace-nowrap rounded-lg border border-line bg-ink/90 px-3 py-1.5 text-center text-xs">
                  <div className="font-display text-sm text-white">{c.name}</div>
                  <div className="text-mist">
                    {Object.keys(c.weights).join(' · ')} · {usd(c.value)}
                  </div>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

export default function Gallery() {
  return (
    <div className="absolute inset-0">
      <Stage className="!absolute inset-0" camera={{ position: [0, 3.5, 11], fov: 45 }}>
        <Field />
        <OrbitControls
          makeDefault
          enableDamping
          enablePan={false}
          minDistance={5}
          maxDistance={18}
          autoRotate
          autoRotateSpeed={0.35}
        />
      </Stage>
      <div className="pointer-events-none absolute left-4 top-4 max-w-xs">
        <h1 className="font-display text-2xl font-semibold">Gallery</h1>
        <p className="mt-1 text-sm text-mist">
          {GALLERY.length} crystals forged by the community. Drag to orbit, hover to inspect.
        </p>
      </div>
    </div>
  );
}
