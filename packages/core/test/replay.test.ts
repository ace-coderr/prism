import { describe, expect, it } from 'vitest';
import type { Address, Hash } from 'viem';
import { buildReplay, dropEvents, replayPlan, replaySecondsAt, replayTimeAt, type CrystalEvent, type ReplayAssetInfo } from '../src';

const ME = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e' as Address;
const FRIEND = '0x1111111111111111111111111111111111111111' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const AAPL = '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2' as Address;
const NVDA = '0x3ab049897b0697BdA766D8730fe1F955c9c103F0' as Address;
const E18 = 10n ** 18n;

const clock = (b: bigint) => 1_000_000 + Number(b) * 3600; // one block an hour
const T = (b: number) => clock(BigInt(b));
let li = 0;
const ev = (kind: CrystalEvent['kind'], block: number, extra: Partial<CrystalEvent> = {}): CrystalEvent => ({
  kind,
  id: 7n,
  block: BigInt(block),
  logIndex: li++,
  tx: `0x${(li + 1).toString(16).padStart(64, '0')}` as Hash,
  ...extra,
});

/** AAPL: flat at 0.1 ETH, drops 8% at hours 22–24, back above its peak at hour 27; NVDA flat. */
const aaplEth = [0, 21, 22, 23, 24, 25, 26, 27, 40].map((h) => ({ t: T(h), price: { 22: 0.096, 23: 0.093, 24: 0.092, 25: 0.095, 26: 0.098, 27: 0.101 }[h] ?? (h >= 27 ? 0.101 : 0.1) }));
const info = (token: Address | null): ReplayAssetInfo =>
  token === null
    ? { symbol: 'ETH', decimals: 18, eth: null, isEth: true, volatility: 0.2 }
    : token === AAPL
      ? { symbol: 'AAPL', decimals: 18, eth: aaplEth, volatility: 0.3 }
      : { symbol: 'NVDA', decimals: 18, eth: [{ t: T(0), price: 0.2 }], volatility: 0.4 };
const ethUsd = [{ t: T(0), price: 2000 }];

const events: CrystalEvent[] = [
  ev('transfer', 10, { from: ZERO, to: ME }),
  ev('forged', 10, { account: ME, moves: [{ token: AAPL, amount: 10n * E18 }, { token: null, amount: E18 }] }),
  ev('added', 20, { account: ME, moves: [{ token: NVDA, amount: 5n * E18 }] }),
  ev('withdrawn', 30, { account: ME, moves: [{ token: AAPL, amount: -5n * E18 }] }),
  ev('sealed', 40, { unlockTime: T(45) }),
  ev('transfer', 41, { from: ME, to: FRIEND }),
  // another crystal's event must not leak in
  { ...ev('added', 25, { moves: [{ token: NVDA, amount: 99n * E18 }] }), id: 8n },
];
const replay = () => buildReplay({ id: 7n, events, clock, info, ethUsd, historyStart: T(0), now: T(50), keyframes: 41 });

describe('drop events', () => {
  it('cracks when the price is 5% under its peak, and heals in gold once it is back', () => {
    const [d] = dropEvents(aaplEth, 'AAPL');
    expect(d).toMatchObject({ symbol: 'AAPL', peakAt: T(21), openAt: T(23), healedAt: T(27), depth: 8 });
  });
  it('a drop that never climbs back stays open', () => {
    const [d] = dropEvents([{ t: 1, price: 100 }, { t: 2, price: 90 }, { t: 3, price: 92 }], 'X');
    expect(d).toMatchObject({ openAt: 2, healedAt: null, depth: 10 });
    expect(dropEvents([{ t: 1, price: 100 }, { t: 2, price: 97 }, { t: 3, price: 101 }], 'X')).toEqual([]);
  });
});

describe('buildReplay', () => {
  it('lists what happened, in order', () => {
    const r = replay();
    expect(r.start).toBe(T(10));
    expect(r.end).toBe(T(50));
    expect(r.events.map((e) => e.kind)).toEqual(['forged', 'added', 'drop', 'heal', 'withdrawn', 'sealed', 'gift', 'unwrap']);
    expect(r.events.map((e) => e.t)).toEqual([T(10), T(20), T(23), T(27), T(30), T(40), T(41), T(45)]);
    expect(r.events.find((e) => e.kind === 'gift')?.to).toBe(FRIEND);
  });

  it('cracks at the drop and fills the crack with gold at the recovery', () => {
    const r = replay();
    const at = (h: number) => r.frames.find((f) => f.t === T(10) + ((T(50) - T(10)) * (h - 10)) / 40)!;
    expect(at(22).history.drawdowns).toEqual([]);
    expect(at(24).history.drawdowns).toEqual([{ symbol: 'AAPL', depth: 8, recovered: false }]);
    expect(at(26).history.drawdowns[0]!.recovered).toBe(false);
    expect(at(27).history.drawdowns[0]!.recovered).toBe(true);
    expect(at(49).history.drawdowns[0]!.recovered).toBe(true);
  });

  it('rebuilds what was inside from the real deposits and withdrawals, and its value in ETH', () => {
    const r = replay();
    const at = (h: number) => r.frames.find((f) => f.t === T(10) + ((T(50) - T(10)) * (h - 10)) / 40)!;
    // forge: 10 AAPL (1 ETH) + 1 ETH → equal halves
    expect(at(10).holdings.map((h) => h.symbol)).toEqual(['AAPL', 'ETH']);
    expect(at(10).valueEth).toBeCloseTo(2);
    expect(at(10).holdings[0]!.weight).toBeCloseTo(0.5);
    // + 5 NVDA (1 ETH)
    expect(at(20).holdings.map((h) => h.symbol).sort()).toEqual(['AAPL', 'ETH', 'NVDA']);
    expect(at(20).valueEth).toBeCloseTo(3);
    // the dip shows in the value line and in AAPL's 24h move
    expect(at(24).valueEth).toBeCloseTo(0.92 + 1 + 1);
    expect(at(24).holdings.find((h) => h.symbol === 'AAPL')!.change24h).toBeCloseTo(-8);
    // half the AAPL taken out
    expect(at(31).valueEth).toBeCloseTo(0.505 + 1 + 1);
    expect(r.values[0]!.eth).toBeCloseTo(2);
  });

  it('frosts the gift from its seal until it opens, then unwraps', () => {
    expect(replay().frost).toEqual({ from: T(40), unwrapAt: T(45) });
    // still sealed at the end: frosted to the last frame
    const later = buildReplay({ id: 7n, events: events.map((e) => (e.kind === 'sealed' ? { ...e, unlockTime: T(90) } : e)), clock, info, ethUsd, historyStart: T(0), now: T(50) });
    expect(later.frost).toEqual({ from: T(40), unwrapAt: null });
    expect(later.events.some((e) => e.kind === 'unwrap')).toBe(false);
  });

  it('starts at the forge, or at the start of the loaded history when the forge is older', () => {
    const r = buildReplay({ id: 7n, events, clock, info, ethUsd, historyStart: T(15), now: T(50) });
    expect(r.start).toBe(T(15));
    // what went in before the window still counts
    expect(r.frames[0]!.holdings.map((h) => h.symbol)).toEqual(['AAPL', 'ETH']);
  });
});

describe('playback', () => {
  it('lasts 8–15 s and maps video time onto the crystal’s life', () => {
    const r = replay();
    const plan = replayPlan(r);
    expect(plan.total).toBeGreaterThanOrEqual(8);
    expect(plan.total).toBeLessThanOrEqual(15);
    expect(replayTimeAt(r, plan, 0)).toMatchObject({ phase: 'intro', t: r.start });
    expect(replayTimeAt(r, plan, plan.intro + plan.lapse / 2).t).toBeCloseTo((r.start + r.end) / 2);
    expect(replayTimeAt(r, plan, plan.total - 0.1)).toMatchObject({ phase: 'outro', t: r.end });
    // the gold heal comes after the crack, both inside the time-lapse
    const crack = replaySecondsAt(r, plan, T(23));
    const gold = replaySecondsAt(r, plan, T(27));
    expect(crack).toBeGreaterThan(plan.intro);
    expect(gold).toBeGreaterThan(crack);
    expect(gold).toBeLessThan(plan.intro + plan.lapse);
  });
});
