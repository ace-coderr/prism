import { useEffect, useRef, useState } from 'react';
import { markShapes } from '@prism/core';
import type { PrismScene } from './prismScene';

/** The mark as inline SVG: the logo, and the hero on devices that don't get the 3D one. */
export function PrismMark({ size = 26, light = 1, cloud = 0, className = '' }: { size?: number; light?: number; cloud?: number; className?: string }) {
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={className} dangerouslySetInnerHTML={{ __html: markShapes({ light, cloud }) }} />;
}

/** WebGL, enough cores and memory, no data saver and no reduced-motion preference. */
function canAnimate(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if ((nav.hardwareConcurrency ?? 4) < 4 || (nav.deviceMemory ?? 4) < 2 || nav.connection?.saveData) return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * The hero prism: light splits into colors from live sentiment (`light`, 0..1) and turns cloudy as
 * reviewers sell (`cloud`, 0..1). 3D when the device can, else the same picture as a still SVG.
 */
export function HeroPrism({ light, cloud, className = '' }: { light: number; cloud: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PrismScene | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!canAnimate() || !host.current) return;
    let cancelled = false;
    void import('./prismScene')
      .then(({ mountPrism }) => {
        if (cancelled || !host.current) return;
        scene.current = mountPrism(host.current, light, cloud);
        setLive(true);
      })
      .catch(() => undefined); // stays the still picture
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => scene.current?.update(light, cloud), [light, cloud]);

  return (
    <div className={`relative ${className}`} role="img" aria-label={`A prism splitting light into colors${cloud > 0.2 ? ', clouded by sellers' : ''}`}>
      {!live && <PrismMark size={512} light={light} cloud={cloud} className="absolute inset-0 m-auto h-full w-full" />}
      <div ref={host} className={`absolute inset-0 transition-opacity duration-700 ${live ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  );
}
