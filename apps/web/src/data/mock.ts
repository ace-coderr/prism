import type { CorrelationInput, CrystalHistory, Holding } from '@prism/core';

// All data here is mock. Real token addresses come from
// https://docs.robinhood.com/chain/contracts in step 2.

export interface Token {
  symbol: string;
  name: string;
  kind: 'stock' | 'crypto';
  price: number;
  change24h: number;
  volatility: number;
}

export const TOKENS: Token[] = [
  { symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', price: 182.4, change24h: 3.8, volatility: 0.75 },
  { symbol: 'AAPL', name: 'Apple', kind: 'stock', price: 241.1, change24h: 0.9, volatility: 0.3 },
  { symbol: 'MSFT', name: 'Microsoft', kind: 'stock', price: 512.7, change24h: 1.4, volatility: 0.25 },
  { symbol: 'GOOGL', name: 'Alphabet', kind: 'stock', price: 248.3, change24h: 2.1, volatility: 0.35 },
  { symbol: 'AMZN', name: 'Amazon', kind: 'stock', price: 221.6, change24h: -1.8, volatility: 0.4 },
  { symbol: 'META', name: 'Meta', kind: 'stock', price: 734.9, change24h: -2.7, volatility: 0.5 },
  { symbol: 'TSLA', name: 'Tesla', kind: 'stock', price: 436.0, change24h: -5.6, volatility: 0.9 },
  { symbol: 'AMD', name: 'AMD', kind: 'stock', price: 164.2, change24h: 6.2, volatility: 0.8 },
  { symbol: 'NFLX', name: 'Netflix', kind: 'stock', price: 1204.5, change24h: -0.6, volatility: 0.45 },
  { symbol: 'PLTR', name: 'Palantir', kind: 'stock', price: 181.9, change24h: 9.4, volatility: 0.95 },
  { symbol: 'HOOD', name: 'Robinhood', kind: 'stock', price: 117.3, change24h: 4.4, volatility: 0.85 },
  { symbol: 'ETH', name: 'Ether', kind: 'crypto', price: 4380.0, change24h: -3.1, volatility: 0.7 },
];

export const TOKEN_BY_SYMBOL = Object.fromEntries(TOKENS.map((t) => [t.symbol, t])) as Record<string, Token>;

export const CORRELATIONS: CorrelationInput = {
  NVDA: { AMD: 0.86 },
  MSFT: { GOOGL: 0.78, AAPL: 0.74 },
  HOOD: { ETH: 0.72 },
  TSLA: { PLTR: 0.58 },
};

/** Turn a { SYMBOL: percent } map into core holdings using mock market data. */
export function toHoldings(weights: Record<string, number>): Holding[] {
  return Object.entries(weights).map(([symbol, pct]) => {
    const t = TOKEN_BY_SYMBOL[symbol]!;
    return { symbol, weight: pct / 100, change24h: t.change24h, volatility: t.volatility };
  });
}

export interface MockCrystal {
  id: string;
  name: string;
  owner: string;
  weights: Record<string, number>;
  history?: CrystalHistory;
  value: number;
  forged: string;
}

export const MY_CRYSTALS: MockCrystal[] = [
  {
    id: 'c1',
    name: 'Kintsugi Core',
    owner: 'you',
    weights: { NVDA: 35, MSFT: 25, AAPL: 20, ETH: 20 },
    history: {
      drawdowns: [
        { depth: 32, recovered: true, symbol: 'NVDA' },
        { depth: 18, recovered: true },
      ],
    },
    value: 12480,
    forged: '2026-04-12',
  },
  {
    id: 'c2',
    name: 'Volt',
    owner: 'you',
    weights: { TSLA: 40, PLTR: 30, AMD: 30 },
    history: { drawdowns: [{ depth: 27, recovered: false, symbol: 'TSLA' }] },
    value: 3920,
    forged: '2026-07-01',
  },
  {
    id: 'c3',
    name: 'Quiet Giant',
    owner: 'you',
    weights: { MSFT: 30, GOOGL: 25, AMZN: 25, NFLX: 20 },
    value: 8150,
    forged: '2026-09-18',
  },
];

const GALLERY_NAMES = [
  'Aurora', 'Basalt', 'Cinder', 'Dune', 'Ember', 'Frost',
  'Glint', 'Halo', 'Ion', 'Jade', 'Kestrel', 'Lumen',
];

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

export const GALLERY: MockCrystal[] = GALLERY_NAMES.map((name, i) => {
  const r = seeded(i * 97 + 13);
  const pool = [...TOKENS].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 4));
  const raw = pool.map(() => 0.2 + r());
  const sum = raw.reduce((s, x) => s + x, 0);
  const weights = Object.fromEntries(pool.map((t, k) => [t.symbol, Math.round((raw[k]! / sum) * 100)]));
  const drawdowns =
    r() > 0.55
      ? [{ depth: 16 + Math.round(r() * 30), recovered: r() > 0.4, symbol: pool[0]!.symbol }]
      : [];
  return {
    id: `g${i}`,
    name,
    owner: `collector_${(i * 7 + 3).toString(36)}`,
    weights,
    history: { drawdowns },
    value: Math.round(1500 + r() * 30000),
    forged: '2026-09-01',
  };
});

export const AGENT_PROPOSAL = {
  before: { NVDA: 45, AMD: 25, TSLA: 20, ETH: 10 } as Record<string, number>,
  after: { NVDA: 28, AMD: 12, MSFT: 20, AAPL: 15, ETH: 15, TSLA: 10 } as Record<string, number>,
  reasons: [
    'NVDA + AMD are 86% correlated — together they were 70% of the basket.',
    'Volatility-weighted risk drops ~31% by adding MSFT / AAPL ballast.',
    'ETH bumped to 15% to keep a non-equity leg.',
  ],
};
