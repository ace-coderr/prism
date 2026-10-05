import { describe, expect, it } from 'vitest';
import {
  POOL_MANAGER,
  ROUTER_TOKENS,
  minOut,
  minsAtSend,
  priceImpact,
  priceMovedMessage,
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

  describe('minimums at the moment of sending (quotes go stale on busy, thin pools)', () => {
    // the bug case: 5 stocks × 0.004 ETH at 1%, and ANTHROPIC jumps between the quote and the click
    const shownQuotes = [E(0.0305), E(0.0302), E(0.016), E(0.02432), E(0.0521)];
    const shownMins = shownQuotes.map((q) => minOut(q, 100));

    it('goes ahead with the full slippage counted from the fresh quote when nothing moved past the minimum', () => {
      const fresh = [E(0.0304), E(0.0302), E(0.0161), E(0.0242), E(0.0519)]; // small moves, all above the minimums
      const check = minsAtSend(shownMins, fresh, 100);
      expect(check).toEqual({ ok: true, mins: fresh.map((q) => minOut(q, 100)) });
    });

    it('stops before the wallet opens when a fresh quote is below the minimum the user saw', () => {
      const fresh = [...shownQuotes];
      fresh[3] = E(0.01474); // ANTHROPIC −39%
      const check = minsAtSend(shownMins, fresh, 100);
      expect(check.ok).toBe(false);
      if (check.ok) return;
      expect(check.moved).toEqual([{ index: 3, quote: E(0.01474), min: shownMins[3] }]);
      expect(priceMovedMessage(check.moved.map((m) => ({ ...m, token: tokenById('ANTHROPIC')! })), 100)).toBe(
        'ANTHROPIC moved more than 1% since the quote on screen: ANTHROPIC now buys about 0.01474 (your minimum was 0.02408). Nothing was sent. The amounts are updated: check them and press Swap & forge again, or raise slippage.',
      );
    });

    it('lists every token that moved', () => {
      const fresh = [...shownQuotes];
      fresh[3] = E(0.02);
      fresh[4] = E(0.05);
      const check = minsAtSend(shownMins, fresh, 100);
      if (check.ok) throw new Error('expected a move');
      const msg = priceMovedMessage(check.moved.map((m) => ({ ...m, token: [tokenById('ANTHROPIC')!, tokenById('OPENAI')!][m.index - 3]! })), 100);
      expect(msg).toMatch(/^ANTHROPIC and OPENAI moved more than 1%/);
    });

    it('a better price is never a reason to stop', () => {
      const fresh = shownQuotes.map((q) => (q * 105n) / 100n);
      expect(minsAtSend(shownMins, fresh, 100).ok).toBe(true);
    });
  });
});
