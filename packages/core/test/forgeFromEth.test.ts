import { describe, expect, it } from 'vitest';
import {
  POOL_MANAGER,
  ROUTER_TOKENS,
  minOut,
  priceImpact,
  routerDeployArgs,
  splitEth,
  suggestSmallerEth,
  tokenById,
} from '../src';

const E = (n: number) => BigInt(Math.round(n * 1e18));

describe('forge from ETH helpers', () => {
  it('the router accepts exactly the five test stocks, all on 0.3% / 60 / no-hook ETH pools', () => {
    expect(ROUTER_TOKENS.map((t) => t.id)).toEqual(['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI']);
    const [pm, crystal, tokens, fee, spacing] = routerDeployArgs('0x59ce49dE3782FA87E94850b23FEB1457009f9f40');
    expect(pm).toBe(POOL_MANAGER);
    expect(crystal).toBe('0x59ce49dE3782FA87E94850b23FEB1457009f9f40');
    expect(tokens).toEqual(['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI'].map((id) => tokenById(id)!.address));
    expect([fee, spacing]).toEqual([3000, 60]);
  });

  it('splits one ETH amount by percentages, exactly', () => {
    expect(splitEth(E(1), [50, 30, 20])).toEqual([E(0.5), E(0.3), E(0.2)]);
    const odd = splitEth(1001n, [33, 33, 34]);
    expect(odd.reduce((s, x) => s + x, 0n)).toBe(1001n);
    expect(splitEth(E(1), [])).toEqual([]);
  });

  it('applies slippage to the quote (rounding down, never zero)', () => {
    expect(minOut(10_000n, 100)).toBe(9_900n);
    expect(minOut(1n, 100)).toBe(1n);
  });

  it('price impact leaves out the 0.3% pool fee', () => {
    // 0.1 ETH at 0.1 ETH per token = 1 token at spot, 0.997 after the fee
    expect(priceImpact(E(0.1), E(0.997), 0.1, 18)).toBeCloseTo(0, 9);
    expect(priceImpact(E(0.1), E(0.947), 0.1, 18)).toBeCloseTo(0.0502, 3);
    expect(priceImpact(E(0.1), E(1), null, 18)).toBeNull();
  });

  it('suggests a smaller amount only when impact is over 3%', () => {
    expect(suggestSmallerEth(E(1), 0.02)).toBeNull();
    const s = suggestSmallerEth(E(1), 0.08)!; // ≈ 1 × 2.4% / 8% = 0.3
    expect(Number(s) / 1e18).toBeCloseTo(0.3, 6);
  });
});
