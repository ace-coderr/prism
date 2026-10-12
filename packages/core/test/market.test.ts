import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import {
  POOL_MANAGER,
  V6_SUPPLY,
  applyTransfers,
  constantProductDayChange,
  dayStats,
  holderCount,
  poolCap,
  poolIdOf,
  poolPairReserve,
  tokenById,
  tokenIsCurrency1,
  v6CurveCap,
  v6DayChange,
  type Trade,
} from '../src';

const E18 = 10n ** 18n;
const Q96 = 2n ** 96n;
const LOW = '0x0000000000000000000000000000000000000001' as Address;
const HIGH = '0xffffffffffffffffffffffffffffffffffffffff' as Address;

describe('v6 curve market cap (vibe/vibe’s formula)', () => {
  it('starts at 5/16 of the target and reaches 5× it when 800M are sold', () => {
    const target = 4n * E18;
    expect(v6CurveCap(0n, target)).toBe((target * 5n) / 16n);
    expect(v6CurveCap((V6_SUPPLY * 8n) / 10n, target)).toBe(5n * target);
    expect(v6CurveCap(V6_SUPPLY / 2n, target)! > v6CurveCap(V6_SUPPLY / 4n, target)!).toBe(true);
    expect(v6CurveCap(0n, 0n)).toBeNull();
  });

  it('rebuilds the cap 24h ago from the trades since', () => {
    const target = 4n * E18;
    const sold = V6_SUPPLY / 2n;
    const trades: Trade[] = [
      { block: 1, side: 'buy', pair: E18, tokens: V6_SUPPLY / 10n },
      { block: 2, side: 'sell', pair: E18 / 2n, tokens: V6_SUPPLY / 20n },
    ];
    const then = v6CurveCap(sold - V6_SUPPLY / 20n, target)!;
    const now = v6CurveCap(sold, target)!;
    expect(v6DayChange(sold, target, trades)).toBeCloseTo(Number(now - then) / Number(then), 9);
    expect(v6DayChange(sold, target, [])).toBe(0);
  });

  it('older curves: price ∝ 1/reserve², so buying 10% of the reserve lifts it by about 23%', () => {
    const reserve = 900n * E18;
    expect(constantProductDayChange(reserve, [{ block: 1, side: 'buy', pair: 1n, tokens: 100n * E18 }])).toBeCloseTo((1000 / 900) ** 2 - 1, 9);
  });
});

describe('pools', () => {
  it('reads either side of a V4 pool', () => {
    expect(tokenIsCurrency1(HIGH, null)).toBe(true); // native ETH is always currency0
    expect(tokenIsCurrency1(LOW, HIGH)).toBe(false);
    // price 1:1 → cap = supply, either way round
    expect(poolCap(Q96, HIGH, null, 1000n)).toBe(1000n);
    // token is currency1 at 4 tokens per ETH (sqrtP = 2): 1000 tokens are worth 250 ETH
    expect(poolCap(2n * Q96, HIGH, null, 1000n)).toBe(250n);
    expect(poolCap(2n * Q96, LOW, HIGH, 1000n)).toBe(4000n);
    expect(poolPairReserve(10n ** 6n, Q96, HIGH, null)).toBe(10n ** 6n);
  });

  it('computes pool ids like v4-core (NVDA’s ETH pool)', () => {
    const nvda = tokenById('NVDA')!;
    expect(poolIdOf({ currency0: '0x0000000000000000000000000000000000000000', currency1: nvda.address, ...nvda.pool! })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('24h figures and holders', () => {
  it('sums volume and counts buys and sells', () => {
    const d = dayStats(
      [
        { block: 1, side: 'buy', pair: 3n, tokens: 1n },
        { block: 2, side: 'sell', pair: 2n, tokens: 1n },
        { block: 3, side: 'buy', pair: 5n, tokens: 1n },
      ],
      0.1,
    );
    expect(d).toEqual({ volume: 10n, buys: 2, sells: 1, change: 0.1 });
    expect(dayStats([], null).change).toBe(0); // no trades: the price didn't move
  });

  it('counts holders from transfers, without the curve, the pool, the token and burn addresses', () => {
    const zero = '0x0000000000000000000000000000000000000000';
    const curve = '0x00000000000000000000000000000000000000c0';
    const token = '0x00000000000000000000000000000000000000f0';
    const [a, b, c] = ['0x...a', '0x...b', '0x...c'];
    const bal = new Map<string, bigint>();
    applyTransfers(bal, [
      { from: zero, to: curve, value: 100n },
      { from: curve, to: a, value: 10n },
      { from: curve, to: b, value: 10n },
      { from: b, to: c, value: 10n }, // b sold out
      { from: curve, to: token, value: 5n }, // rewards held by the token
      { from: a, to: POOL_MANAGER, value: 4n },
      { from: a, to: '0x000000000000000000000000000000000000dEaD', value: 1n },
    ]);
    expect(holderCount(bal, [curve, POOL_MANAGER, token])).toBe(2); // a and c
  });
});
