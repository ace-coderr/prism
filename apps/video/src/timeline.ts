/*
 * The explainer's timeline in one place: scene boundaries and the frames where things
 * happen on screen. Both the picture (Explainer.tsx) and the soundtrack
 * (scripts/soundtrack.ts) read these, so every sound effect lands on its frame.
 * Pure data, no React / Remotion imports (the soundtrack script runs in plain Node).
 */
import type { Drawdown, Holding } from '@prism/core';

export const FPS = 30;
export const DURATION = 1200; // 40 s

/** Scene boundaries (frames). */
export const S = {
  ask: [0, 120],
  pick: [120, 255],
  fuse: [255, 435],
  read: [435, 615],
  seam: [615, 825],
  gift: [825, 975],
  trust: [975, 1080],
  end: [1080, 1200],
} as const;

/** Frames of the moments sound effects follow. */
export const T = {
  /** token card i starts sliding up */
  cardIn: (i: number) => S.pick[0] + 22 + i * 5,
  /** the cards fly into the middle */
  merge: [S.fuse[0], S.fuse[0] + 45],
  /** cubes fly in and lock into the crystal */
  assemble: [S.fuse[0] + 20, S.fuse[0] + 110],
  /** the drop: the crack opens along the seam */
  crack: [S.seam[0] + 45, S.seam[0] + 85],
  /** the price climbs back: gold fills the crack */
  heal: [S.seam[0] + 120, S.seam[0] + 165],
  /** sealed: frost wraps the crystal */
  frost: [S.gift[0] + 5, S.gift[0] + 35],
  /** the crystal flies to a friend's wallet, which lights up when it arrives */
  fly: [S.gift[0] + 55, S.gift[0] + 110],
  received: S.gift[0] + 100,
  /** trust line i appears */
  trustLine: (i: number) => S.trust[0] + 6 + i * 12,
  /** the end card (call to action) */
  end: S.end[0],
} as const;

/** An illustrative basket for the explainer: the six assets PRISM supports, in equal parts. */
export const TOKENS = [
  { symbol: 'AAPL', name: 'Apple', change: 2.6, vol: 0.35 },
  { symbol: 'NVDA', name: 'NVIDIA', change: 7.5, vol: 0.5 },
  { symbol: 'SPCX', name: 'SpaceX', change: -2.4, vol: 0.8 },
  { symbol: 'ANTHROPIC', name: 'Anthropic', change: 5.8, vol: 0.9 },
  { symbol: 'OPENAI', name: 'OpenAI', change: 4.1, vol: 0.55 },
  { symbol: 'ETH', name: 'Ether', change: -1.5, vol: 0.2 },
];
export const HOLDINGS: Holding[] = TOKENS.map((t) => ({ symbol: t.symbol, weight: 1 / 6, change24h: t.change, volatility: t.vol }));
export const DROP: Drawdown = { depth: 12, recovered: true, symbol: 'ANTHROPIC' };

/** The easing every `prog` uses: cubic-bezier(0.2, 0.8, 0.2, 1). */
export const EASE_BEZIER = [0.2, 0.8, 0.2, 1] as const;
