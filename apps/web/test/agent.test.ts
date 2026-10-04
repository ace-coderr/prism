import { describe, expect, it } from 'vitest';
import { analyzeCrystal } from '../src/data/agent';

const w = (o: Record<string, number>) => new Map(Object.entries(o));

describe('agent analysis', () => {
  it('suggests trimming the holding that grew past its forge weight', () => {
    const a = analyzeCrystal(3n, w({ NVDA: 0.61, AAPL: 0.39 }), w({ NVDA: 0.4, AAPL: 0.6 }));
    expect(a.actionable).toBe(true);
    expect(a.grew).toEqual({ symbol: 'NVDA', from: 0.4, to: 0.61 });
    expect(a.suggestion).toBe('NVDA grew to 61% of crystal #3. Trimming back to 40% would lower your risk.');
    expect(a.target.get('NVDA')).toBe(0.4);
  });

  it('says nothing needs changing when weights barely moved', () => {
    const a = analyzeCrystal(2n, w({ NVDA: 0.52, AAPL: 0.48 }), w({ NVDA: 0.5, AAPL: 0.5 }));
    expect(a.actionable).toBe(false);
    expect(a.suggestion).toMatch(/close to how you forged it/);
  });

  it('a single-asset crystal has nothing to rebalance', () => {
    const a = analyzeCrystal(1n, w({ ETH: 1 }), w({ ETH: 1 }));
    expect(a.actionable).toBe(false);
    expect(a.suggestion).toBe('Crystal #1 holds only ETH, so there is nothing to rebalance. Adding a second asset would spread the risk.');
  });

  it('waits for forge-time prices instead of guessing', () => {
    const a = analyzeCrystal(4n, w({ NVDA: 0.7, AAPL: 0.3 }), null);
    expect(a.actionable).toBe(false);
    expect(a.forged).toBeNull();
    expect(a.suggestion).toMatch(/NVDA is 70% of crystal #4/);
  });
});
