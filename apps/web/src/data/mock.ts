import type { CorrelationInput, CrystalHistory, Holding } from '@prism/core';

/*
 * SAMPLE DATA — clearly labelled "Sample" wherever it appears. It only uses the real
 * testnet tokens (the vibe/vibe test stocks + ETH, see packages/core/src/tokens.ts);
 * the prices, moves and histories here are made up to show what crystals look like.
 */

export interface SampleToken {
  symbol: string;
  name: string;
  /** made-up 24h move, % */
  change24h: number;
  /** made-up "how jumpy the price is", 0..1 */
  volatility: number;
}

export const TOKENS: SampleToken[] = [
  { symbol: 'NVDA', name: 'NVIDIA (test stock)', change24h: 3.8, volatility: 0.75 },
  { symbol: 'SPCX', name: 'SpaceX (test stock)', change24h: 1.2, volatility: 0.5 },
  { symbol: 'AAPL', name: 'Apple (test stock)', change24h: -0.9, volatility: 0.3 },
  { symbol: 'OPENAI', name: 'OpenAI (test asset)', change24h: 4.6, volatility: 0.6 },
  { symbol: 'ANTHROPIC', name: 'Anthropic (test asset)', change24h: -2.4, volatility: 0.65 },
  { symbol: 'ETH', name: 'Ether', change24h: -3.1, volatility: 0.7 },
];

export const TOKEN_BY_SYMBOL = Object.fromEntries(TOKENS.map((t) => [t.symbol, t])) as Record<string, SampleToken>;

/** Sample correlations (made up): the two AI test assets move together. */
export const CORRELATIONS: CorrelationInput = {
  OPENAI: { ANTHROPIC: 0.82 },
  NVDA: { AAPL: 0.72 },
};

/** Turn a { SYMBOL: percent } map into core holdings using the sample market data. */
export function toHoldings(weights: Record<string, number>): Holding[] {
  return Object.entries(weights).map(([symbol, pct]) => {
    const t = TOKEN_BY_SYMBOL[symbol]!;
    return { symbol, weight: pct / 100, change24h: t.change24h, volatility: t.volatility };
  });
}

export interface MockCrystal {
  id: string;
  name: string;
  weights: Record<string, number>;
  history?: CrystalHistory;
  /** sample basket value, in ETH */
  valueEth: number;
  forged: string;
}

/** Shown in My Crystals when no wallet is connected. */
export const MY_CRYSTALS: MockCrystal[] = [
  {
    id: 'c1',
    name: 'Kintsugi Core',
    weights: { NVDA: 35, SPCX: 25, AAPL: 20, ETH: 20 },
    history: {
      drawdowns: [
        { depth: 32, recovered: true, symbol: 'NVDA' },
        { depth: 18, recovered: true },
      ],
    },
    valueEth: 4.62,
    forged: '2026-04-12',
  },
  {
    id: 'c2',
    name: 'Volt',
    weights: { OPENAI: 40, ANTHROPIC: 35, NVDA: 25 },
    history: {
      drawdowns: [
        { depth: 26, recovered: true, symbol: 'OPENAI' },
        { depth: 21, recovered: false, symbol: 'ANTHROPIC' },
      ],
    },
    valueEth: 1.45,
    forged: '2026-07-01',
  },
  {
    id: 'c3',
    name: 'Quiet Giant',
    weights: { AAPL: 45, SPCX: 30, ETH: 25 },
    history: { drawdowns: [{ depth: 19, recovered: true, symbol: 'AAPL' }] },
    valueEth: 3.02,
    forged: '2026-09-18',
  },
];

/** Gallery "Examples" row — samples, never presented as real crystals. */
export const EXAMPLES: MockCrystal[] = [
  {
    id: 'e1',
    name: 'Aurora',
    weights: { NVDA: 50, ETH: 30, AAPL: 20 },
    history: { drawdowns: [{ depth: 34, recovered: true, symbol: 'NVDA' }] },
    valueEth: 2.1,
    forged: 'example',
  },
  {
    id: 'e2',
    name: 'Basalt',
    weights: { AAPL: 40, SPCX: 40, ETH: 20 },
    history: { drawdowns: [{ depth: 22, recovered: true }] },
    valueEth: 0.8,
    forged: 'example',
  },
  {
    id: 'e3',
    name: 'Ember',
    weights: { OPENAI: 35, ANTHROPIC: 35, NVDA: 30 },
    history: {
      drawdowns: [
        { depth: 41, recovered: true, symbol: 'ANTHROPIC' },
        { depth: 17, recovered: true, symbol: 'OPENAI' },
      ],
    },
    valueEth: 5.4,
    forged: 'example',
  },
  {
    id: 'e4',
    name: 'Glint',
    weights: { SPCX: 60, ETH: 40 },
    history: { drawdowns: [{ depth: 28, recovered: true, symbol: 'SPCX' }] },
    valueEth: 1.2,
    forged: 'example',
  },
  {
    id: 'e5',
    name: 'Halo',
    weights: { ETH: 40, NVDA: 20, AAPL: 20, SPCX: 20 },
    history: { drawdowns: [{ depth: 24, recovered: true, symbol: 'ETH' }] },
    valueEth: 3.3,
    forged: 'example',
  },
  {
    id: 'e6',
    name: 'Jade',
    weights: { ANTHROPIC: 50, AAPL: 50 },
    history: { drawdowns: [{ depth: 30, recovered: true, symbol: 'ANTHROPIC' }] },
    valueEth: 0.6,
    forged: 'example',
  },
];

/** Agent page illustration (sample): an over-concentrated basket and a calmer one. */
export const AGENT_PROPOSAL = {
  before: { NVDA: 50, OPENAI: 30, ETH: 20 } as Record<string, number>,
  after: { NVDA: 30, OPENAI: 15, AAPL: 20, SPCX: 15, ETH: 20 } as Record<string, number>,
  reasons: [
    'NVDA and OPENAI tend to move together, and they were 80% of this basket.',
    'Adding AAPL and SPCX spreads it out, so one bad day hurts less.',
    'ETH stays at 20% so not everything is a stock.',
  ],
};
