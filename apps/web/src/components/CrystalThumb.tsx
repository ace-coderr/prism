import { useEffect, useMemo, useRef } from 'react';
import { LIVE_CRACK_THRESHOLD, KINTSUGI_GOLD, buildCrystal, exposedVoxels, type CrystalHistory, type Holding } from '@prism/core';

const C30 = Math.cos(Math.PI / 6);
const FROST = [214, 241, 255];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const shade = ([r, g, b]: number[], k: number) => `rgb(${Math.min(255, r! * k) | 0},${Math.min(255, g! * k) | 0},${Math.min(255, b! * k) | 0})`;
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);

/** Isometric projection: looking down at the crystal from the front-right. */
const iso = (x: number, y: number, z: number): [number, number] => [(x - z) * C30, (x + z) * 0.5 - y];

/**
 * A small static crystal: the same voxel geometry as the 3D one, drawn isometrically on
 * a 2D canvas (no WebGL context per card, so a long list stays cheap).
 */
export function CrystalThumb({ holdings, history, sealed = false, size = 72 }: { holdings: Holding[]; history?: CrystalHistory; sealed?: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const voxels = useMemo(() => {
    if (!holdings.length) return [];
    const geo = buildCrystal(holdings, history, { maxShards: 32, resolution: 6, crackThreshold: LIVE_CRACK_THRESHOLD });
    // painter's order: farthest first (the camera sits towards +x +y +z)
    return exposedVoxels(geo.voxels).sort((a, b) => a.position[0] + a.position[1] + a.position[2] - (b.position[0] + b.position[1] + b.position[2]));
  }, [holdings, history]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!voxels.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of voxels) {
      const [x, y, z] = v.position;
      for (const [dx, dy, dz] of [[-0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] as const) {
        const [sx, sy] = iso(x + dx, y + dy, z + dz);
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
    }
    const px = size * dpr;
    const k = (px * 0.9) / Math.max(maxX - minX, maxY - minY);
    const ox = px / 2 - ((minX + maxX) / 2) * k;
    const oy = px / 2 - ((minY + maxY) / 2) * k;
    const P = (x: number, y: number, z: number) => {
      const [sx, sy] = iso(x, y, z);
      return [ox + sx * k, oy + sy * k] as const;
    };
    const face = (pts: ReadonlyArray<readonly [number, number]>, fill: string) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
    };
    ctx.lineWidth = Math.max(0.6, k * 0.07);
    ctx.strokeStyle = '#000';
    ctx.lineJoin = 'round';
    for (const v of voxels) {
      const [x, y, z] = v.position;
      let rgb = hex(v.gold ? KINTSUGI_GOLD : v.color);
      if (sealed) rgb = mix(rgb, FROST, v.gold ? 0.35 : 0.62);
      const h = 0.5;
      // top (+y), right (+x), left (+z)
      face([P(x - h, y + h, z - h), P(x + h, y + h, z - h), P(x + h, y + h, z + h), P(x - h, y + h, z + h)], shade(rgb, 1.18));
      face([P(x + h, y + h, z - h), P(x + h, y + h, z + h), P(x + h, y - h, z + h), P(x + h, y - h, z - h)], shade(rgb, 0.92));
      face([P(x - h, y + h, z + h), P(x + h, y + h, z + h), P(x + h, y - h, z + h), P(x - h, y - h, z + h)], shade(rgb, 0.7));
    }
  }, [voxels, sealed, size]);

  return <canvas ref={ref} aria-hidden className="shrink-0" style={{ width: size, height: size }} />;
}
