import { motion, useTransform, type MotionValue } from 'motion/react';

/*
 * A flat pixel version of a PRISM crystal for diagrams: a gem of square cubes split into
 * four holdings (greens up, red down) with one gold seam. With `progress`, the cubes fly
 * in from all sides as it goes 0 → 1 (transform + opacity only).
 */

const WIDTHS = [1, 3, 5, 7, 9, 7, 5, 3, 1];
const COLORS = { A: '#5cc983', B: '#3c9a60', C: '#e0645c', D: '#86d9a2', G: '#f6c143' } as const;
const FROST = '#d6f1ff';

interface Cell {
  x: number;
  y: number;
  color: string;
  dx: number;
  dy: number;
}

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function cells(frost: boolean): Cell[] {
  const out: Cell[] = [];
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  WIDTHS.forEach((w, y) => {
    const start = (9 - w) / 2;
    for (let x = start; x < start + w; x++) {
      const region = x < 4 ? (y <= 4 ? 'A' : 'C') : y <= 4 ? 'B' : 'D';
      const gold = x >= 4 && x - y === 1;
      const base = COLORS[gold ? 'G' : region];
      const angle = Math.atan2(y - 4, x - 4 || 0.5) + (rand() - 0.5) * 0.8;
      const dist = 26 + rand() * 30;
      out.push({ x, y, color: frost ? mix(base, FROST, gold ? 0.35 : 0.62) : base, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist });
    }
  });
  return out;
}

const SOLID = cells(false);
const FROSTED = cells(true);
const CELL = 10;

function FlyingCell({ c, progress }: { c: Cell; progress: MotionValue<number> }) {
  const x = useTransform(progress, (p) => c.dx * (1 - p));
  const y = useTransform(progress, (p) => c.dy * (1 - p));
  // scattered cubes stay faintly visible, so the station never reads as empty
  const opacity = useTransform(progress, [0, 0.6, 1], [0.35, 0.85, 1]);
  return <motion.rect x={c.x * CELL} y={c.y * CELL} width={CELL} height={CELL} fill={c.color} stroke="#000" strokeWidth={1.2} style={{ x, y, opacity }} />;
}

export function PixelGem({
  size = 96,
  frost = false,
  progress,
  className = '',
}: {
  size?: number;
  frost?: boolean;
  /** 0 = scattered cubes, 1 = assembled crystal. Omit for a static gem. */
  progress?: MotionValue<number>;
  className?: string;
}) {
  const list = frost ? FROSTED : SOLID;
  return (
    <svg viewBox="-34 -34 158 158" width={size} height={size} className={`overflow-visible ${className}`} aria-hidden>
      {list.map((c) =>
        progress ? (
          <FlyingCell key={`${c.x}-${c.y}`} c={c} progress={progress} />
        ) : (
          <rect key={`${c.x}-${c.y}`} x={c.x * CELL} y={c.y * CELL} width={CELL} height={CELL} fill={c.color} stroke="#000" strokeWidth={1.2} />
        ),
      )}
    </svg>
  );
}
