import { describe, expect, it } from 'vitest';
import { createPublicClient, http, type PublicClient } from 'viem';
import {
  NATIVE_ETH,
  TESTNET_TOKENS,
  ethPerToken,
  ethPoolId,
  ethToMovePrice,
  fetchVibePrices,
  marketSnapshot,
  poolIdOf,
  priceStats,
  robinhoodChainTestnet,
  sqrtPriceFromSlot0,
  tokenById,
  virtualReserves,
} from '../src';

const Q96 = 2n ** 96n;

// Pool ids published by vibe/vibe (config canonicalAssets + v6/pair-prices poolIds), 2026-10-04.
const PUBLISHED_POOL_IDS: Record<string, string> = {
  tSFUND: '0xb933556d80062453de15c70946f933fa12e8f86da995dfe9933a77dc0ae81f32',
  NVDA: '0xad46061426962ce3cdd72f85d73d5b904c2f76136162be56dc8e63e843848142',
  SPCX: '0x8dc43577fcadfcf3d16399e40055710d0cb6b20cf7e593f63c7b9df5fbc3d048',
  AAPL: '0x60e44167df8938068cdb05cbeb03b66223261778112681a0484bcf337aea870a',
  OPENAI: '0x0375f0465d6189403e3ce875b6d6c5a0c8be73efbf4654a5b314367634742e37',
  ANTHROPIC: '0x03a204cb51a9ac57222569e3223f3d9fca504016b8c1547ba6b47e964ca028da',
  USDG: '0xf7ee4588caf4077852f49030019949ed10b010d6cad0e5e1efab441b4fcb5ffc',
  'SPCX·Seedify': '0x2057b73efc9e4e546f72b79e7476422e173e2d36610f5f858fdfa2f83baf126e',
};

describe('V4 pool ids', () => {
  it('match the pool ids vibe/vibe publishes for every pooled token', () => {
    for (const [id, expected] of Object.entries(PUBLISHED_POOL_IDS)) {
      expect(ethPoolId(tokenById(id)!)).toBe(expected);
    }
  });

  it('poolIdOf hashes the full key (fee changes the id)', () => {
    const t = tokenById('NVDA')!;
    const a = poolIdOf({ currency0: NATIVE_ETH, currency1: t.address, fee: 3000, tickSpacing: 60, hooks: NATIVE_ETH });
    const b = poolIdOf({ currency0: NATIVE_ETH, currency1: t.address, fee: 500, tickSpacing: 10, hooks: NATIVE_ETH });
    expect(a).not.toBe(b);
  });

  it('WETH has no pool (priced 1:1 with ETH)', () => {
    expect(ethPoolId(tokenById('WETH')!)).toBeNull();
  });
});

describe('price math', () => {
  it('unpacks sqrtPriceX96 from slot0', () => {
    const packed = (123n << 160n) | 456n;
    expect(sqrtPriceFromSlot0(packed)).toBe(456n);
    expect(sqrtPriceFromSlot0('0x000000000bb8000000006d96000000000000000410e902be533ef4062164b48d')).toBeGreaterThan(0n);
  });

  it('converts sqrtPriceX96 to ETH per token with decimals', () => {
    expect(ethPerToken(Q96, 18)).toBeCloseTo(1, 12); // 1 token per ETH
    expect(ethPerToken(Q96 * 2n, 18)).toBeCloseTo(0.25, 12); // 4 tokens per ETH
    expect(ethPerToken(Q96, 6)).toBeCloseTo(1e-12, 20); // 6-decimal token
    expect(ethPerToken(0n, 18)).toBeNull();
  });

  it('virtual reserves and depth scale with liquidity', () => {
    const L = 10n ** 20n;
    const r = virtualReserves(L, Q96, 18);
    expect(r.eth).toBeCloseTo(100, 6);
    expect(r.token).toBeCloseTo(100, 6);
    const d1 = ethToMovePrice(L, Q96, 0.02);
    const d2 = ethToMovePrice(L * 2n, Q96, 0.02);
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeCloseTo(d1 * 2, 9);
    // 2% move on 100 ETH virtual reserve ≈ 100·(√1.02 − 1) ≈ 0.995 ETH
    expect(d1).toBeCloseTo(100 * (Math.sqrt(1.02) - 1), 6);
  });
});

describe('priceStats (24h change + volatility from history)', () => {
  const now = 1_800_000_000;
  const H = 3600;

  it('computes 24h change against the price in effect 24h ago', () => {
    const pts = [
      { t: now - 30 * H, price: 1.0 }, // before the window: the reference
      { t: now - 10 * H, price: 1.05 },
      { t: now - 1 * H, price: 1.1 },
    ];
    const s = priceStats(pts, now);
    expect(s.change24h).toBeCloseTo(10, 9);
    expect(s.samples).toBe(2);
  });

  it('flat history → 0% change, 0 volatility', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ t: now - 29 * H + i * H, price: 2 }));
    const s = priceStats(pts, now);
    expect(s.change24h).toBe(0);
    expect(s.volatility).toBe(0);
  });

  it('choppier history → higher volatility, capped at 1', () => {
    const wave = (amp: number) =>
      Array.from({ length: 48 }, (_, i) => ({ t: now - 47 * (H / 2) + i * (H / 2), price: 1 + amp * Math.sin(i) }));
    const calm = priceStats(wave(0.005), now).volatility!;
    const wild = priceStats(wave(0.2), now).volatility!;
    expect(wild).toBeGreaterThan(calm);
    expect(wild).toBeLessThanOrEqual(1);
    expect(calm).toBeGreaterThan(0);
  });

  it('returns nulls without data', () => {
    expect(priceStats([], now)).toMatchObject({ change24h: null, volatility: null });
  });
});

describe('fetchVibePrices', () => {
  it('parses ETH/USD, pair prices and quote rates', async () => {
    const responses: Record<string, unknown> = {
      'market/eth-usd': { data: { usdPerEthCents: '269189' } },
      'v6/pair-prices': {
        data: { items: [{ pairAddress: '0xABC', priceEthWad: '118587466946333075' }, { pairAddress: '0xdef', priceEthWad: null }] },
      },
      'market/quote-usd-rates': { data: { items: [{ quoteAddress: '0x5A5', usdPerQuoteCents: '16282' }] } },
    };
    const fake = (async (url: string) => {
      const key = Object.keys(responses).find((k) => url.endsWith(k))!;
      return { ok: true, json: async () => responses[key] };
    }) as unknown as typeof fetch;
    const p = await fetchVibePrices(fake, 'https://x');
    expect(p.usdPerEth).toBeCloseTo(2691.89);
    expect(p.ethPerTokenByAddress['0xabc']).toBeCloseTo(0.118587, 6);
    expect(p.ethPerTokenByAddress['0xdef']).toBeUndefined();
    expect(p.usdByQuoteAddress['0x5a5']).toBeCloseTo(162.82);
  });

  it('throws on HTTP errors (caller falls back to pool spot)', async () => {
    const fake = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(fetchVibePrices(fake, 'https://x')).rejects.toThrow(/403/);
  });
});

describe.runIf(process.env.RUN_RPC_TESTS === '1')('on-chain market snapshot (testnet RPC)', () => {
  const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http(undefined, { batch: true }) }) as PublicClient;

  it('prices every basket token from its pool (no API) and never invents a price', async () => {
    const snap = await marketSnapshot(client, TESTNET_TOKENS, null);
    for (const t of TESTNET_TOKENS) {
      const m = snap.get(t.id)!;
      if (t.pool) {
        expect(m.priceSource).toBe('V4 pool spot');
        expect(m.eth).toBeGreaterThan(0);
        expect(m.usd).toBeNull(); // no ETH/USD without the API
      }
    }
    expect(snap.get('WETH')!.eth).toBe(1);
  }, 120_000);
});
