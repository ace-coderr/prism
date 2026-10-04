import { describe, expect, it } from 'vitest';
import { SNAPSHOT_VERSION, crystalFromWire, parseSnapshot, type Snapshot } from '../src';

const snap: Snapshot = {
  version: SNAPSHOT_VERSION,
  generatedAt: 1_791_130_706,
  block: '128799283',
  tokens: ['NVDA', 'WETH'],
  markets: {},
  basket: {
    holdings: [{ symbol: 'NVDA', weight: 0.5, change24h: Number.NaN, volatility: 0.4 }],
    history: { drawdowns: [{ depth: 11.7, recovered: true, symbol: 'NVDA' }] },
    hours: 48,
  },
  stats: { forged: 1, owners: 1, ethHeld: 0.001, stocks: 5 },
  crystals: [
    {
      id: '1',
      owner: '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e',
      assets: [{ token: null, symbol: 'ETH', decimals: 18, amount: '1000000000000000' }],
      sealedUntil: 0,
      forgedBlock: '128669190',
      forgedWith: [{ token: null, symbol: 'ETH', decimals: 18, amount: '1000000000000000' }],
      history: { drawdowns: [] },
    },
  ],
};

describe('snapshot wire format', () => {
  it('survives JSON (bigints as strings, NaN restored)', () => {
    const back = parseSnapshot(JSON.parse(JSON.stringify(snap)))!;
    expect(back.stats).toEqual(snap.stats);
    expect(Number.isNaN(back.basket!.holdings[0]!.change24h)).toBe(true);
    const c = crystalFromWire(back.crystals![0]!);
    expect(c.id).toBe(1n);
    expect(c.assets[0]!.amount).toBe(1_000_000_000_000_000n);
    expect(c.forgedBlock).toBe(128_669_190n);
  });

  it('rejects anything that is not a snapshot (e.g. the SPA page from a host without the function)', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('<!doctype html>')).toBeNull();
    expect(parseSnapshot({ ...snap, version: 99 })).toBeNull();
    expect(parseSnapshot({ version: SNAPSHOT_VERSION })).toBeNull();
  });
});
