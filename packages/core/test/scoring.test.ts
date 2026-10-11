import { describe, expect, it } from 'vitest';
import { getAddress, type Address } from 'viem';
import {
  DAY,
  balanceKey,
  capShares,
  honestyRep,
  isBelowHalf,
  positionsOf,
  reviewState,
  stateLabel,
  timeFactor,
  trueColors,
  type Balances,
  type HonestyRep,
  type ReviewRecord,
} from '../src';

const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, '0')}`);
const TOKEN = A(0x70);
const NOW = 1_800_000_000;
let nextId = 1;
const review = (o: Partial<ReviewRecord> & { author: Address }): ReviewRecord => ({
  id: nextId++,
  token: TOKEN,
  rating: 5,
  heldAtPost: 1000n,
  postedAt: NOW - 30 * DAY,
  status: 'active',
  soldAt: null,
  previous: 0,
  ...o,
});
const bal = (entries: Array<[Address, bigint | null, Address?]>): Balances => new Map(entries.map(([a, b, t]) => [balanceKey(a, t ?? TOKEN), b]));
const neutralRep = (): HonestyRep => ({ kept: 0, decided: 0, rep: null, weight: 1 });

describe('review status from live balances', () => {
  const r = { status: 'active' as const, heldAtPost: 1000n };
  it('holding, trimmed X%, or SOLD below half (exactly half is still holding)', () => {
    expect(reviewState(r, 1000n)).toEqual({ kind: 'holding' });
    expect(reviewState(r, 5000n)).toEqual({ kind: 'holding' });
    expect(reviewState(r, 900n)).toEqual({ kind: 'trimmed', percent: 10 });
    expect(reviewState(r, 999n)).toEqual({ kind: 'trimmed', percent: 1 }); // never "trimmed 0%"
    expect(reviewState(r, 510n)).toEqual({ kind: 'trimmed', percent: 49 });
    expect(reviewState(r, 500n)).toEqual({ kind: 'trimmed', percent: 50 });
    expect(reviewState(r, 490n)).toEqual({ kind: 'sold', marked: false });
    expect(reviewState(r, 0n)).toEqual({ kind: 'sold', marked: false });
  });

  it('SOLD on-chain is final whatever the balance; replaced reviews say so; unknown balance accuses nobody', () => {
    expect(reviewState({ status: 'sold', heldAtPost: 1000n }, 9999n)).toEqual({ kind: 'sold', marked: true });
    expect(reviewState({ status: 'replaced', heldAtPost: 1000n }, 0n)).toEqual({ kind: 'replaced' });
    expect(reviewState(r, null)).toEqual({ kind: 'holding' });
    expect([{ kind: 'holding' }, { kind: 'trimmed', percent: 12 }, { kind: 'sold', marked: false }, { kind: 'replaced' }].map((s) => stateLabel(s as never))).toEqual([
      'Holding',
      'Trimmed 12%',
      'SOLD',
      'Replaced',
    ]);
  });

  it('uses the contract’s exact threshold', () => {
    expect([490n, 500n, 510n].map((b) => isBelowHalf(b, 1000n))).toEqual([true, false, false]);
    expect([50n, 51n].map((b) => isBelowHalf(b, 101n))).toEqual([true, false]);
  });
});

describe('honesty rep: kept holding at least 7 days after reviewing', () => {
  const me = A(1);

  it('kept 7+ days counts; sold within 7 days doesn’t; a young position isn’t decided yet', () => {
    const kept = review({ author: me, token: A(0x71), postedAt: NOW - 10 * DAY });
    const quick = review({ author: me, token: A(0x72), postedAt: NOW - 20 * DAY, status: 'sold', soldAt: NOW - 17 * DAY });
    const young = review({ author: me, token: A(0x73), postedAt: NOW - 2 * DAY });
    const rep = honestyRep([kept, quick, young], bal([[me, 1000n, A(0x71)], [me, 1000n, A(0x73)]]), NOW);
    expect(rep).toEqual({ kept: 1, decided: 2, rep: 0.5, weight: 0.5 });
  });

  it('a sale after 7 days still counts as kept', () => {
    const r = review({ author: me, postedAt: NOW - 20 * DAY, status: 'sold', soldAt: NOW - 5 * DAY });
    expect(honestyRep([r], bal([]), NOW)).toMatchObject({ kept: 1, decided: 1, rep: 1 });
  });

  it('below half right now (not marked yet) counts as sold now', () => {
    const r = review({ author: me, postedAt: NOW - 3 * DAY });
    expect(honestyRep([r], bal([[me, 100n]]), NOW)).toMatchObject({ kept: 0, decided: 1, rep: 0 });
    expect(honestyRep([r], bal([[me, 100n]]), NOW + 10 * DAY)).toMatchObject({ kept: 1, decided: 1 }); // sold after 13 days
  });

  it('updates continue one position; a new review after a sale starts another', () => {
    const first = review({ author: me, postedAt: NOW - 9 * DAY, status: 'replaced' });
    const update = review({ author: me, postedAt: NOW - 1 * DAY, previous: first.id });
    const positions = positionsOf([first, update], bal([[me, 1000n]]), NOW);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ start: NOW - 9 * DAY, kept: true });

    const sold = review({ author: me, postedAt: NOW - 30 * DAY, status: 'sold', soldAt: NOW - 28 * DAY });
    const again = review({ author: me, postedAt: NOW - 3 * DAY, previous: sold.id });
    const two = positionsOf([sold, again], bal([[me, 1000n]]), NOW);
    expect(two.map((p) => p.kept)).toEqual([false, null]);
  });

  it('weight starts at one half for someone new and rises with an honest record', () => {
    expect(honestyRep([], bal([]), NOW).weight).toBe(0.5);
    const many = Array.from({ length: 8 }, (_, i) => review({ author: me, token: A(0x100 + i), postedAt: NOW - 30 * DAY }));
    const rep = honestyRep(many, new Map(many.map((r) => [balanceKey(me, r.token), 1000n])), NOW);
    expect(rep).toMatchObject({ kept: 8, decided: 8, rep: 1 });
    expect(rep.weight).toBeCloseTo(0.9, 10);
  });
});

describe('position size cap', () => {
  it('no single wallet counts more than 10%; the rest share the excess in proportion', () => {
    const shares = capShares([1_000_000, ...Array(20).fill(1)]);
    expect(shares[0]).toBeCloseTo(0.1, 12);
    for (const s of shares.slice(1)) expect(s).toBeCloseTo(0.9 / 20, 12);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('several whales are all capped', () => {
    const shares = capShares([500, 400, ...Array(18).fill(1)]);
    expect(shares[0]).toBeCloseTo(0.1, 12);
    expect(shares[1]).toBeCloseTo(0.1, 12);
    expect(Math.max(...shares)).toBeLessThanOrEqual(0.1 + 1e-12);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('with fewer than 10 wallets the cap becomes an equal share', () => {
    expect(capShares([100, 1])).toEqual([0.5, 0.5]);
    expect(capShares([3, 1, 1, 1])).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(capShares([2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map((x) => x))).toSatisfy((s: number[]) => Math.max(...s) <= 0.1 + 1e-12);
    expect(capShares([])).toEqual([]);
    expect(capShares([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe('holding time', () => {
  it('rises from 0.25 on the day of posting to 1 at 7 days', () => {
    expect(timeFactor(0)).toBe(0.25);
    expect(timeFactor(-5)).toBe(0.25);
    expect(timeFactor(3.5 * DAY)).toBeCloseTo(0.625, 12);
    expect(timeFactor(7 * DAY)).toBe(1);
    expect(timeFactor(70 * DAY)).toBe(1);
  });
});

describe('true colors score', () => {
  it('no reviews, or only sellers: no score yet', () => {
    expect(trueColors([], bal([]), NOW, neutralRep)).toMatchObject({ score: null, reviewers: 0, confidence: 'none' });
    const seller = review({ author: A(1) });
    const marked = review({ author: A(2), status: 'sold', soldAt: NOW - DAY });
    expect(trueColors([seller, marked], bal([[A(1), 10n], [A(2), 1000n]]), NOW, neutralRep)).toMatchObject({ score: null, sold: 2 });
  });

  it('a new token with one review is pulled toward neutral and flagged low confidence', () => {
    const t = trueColors([review({ author: A(1), rating: 5 })], bal([[A(1), 1000n]]), NOW, neutralRep);
    expect(t.average).toBe(5);
    expect(t.score).toBeCloseTo((5 + 3 * 2) / 3, 12);
    expect(t.confidence).toBe('low');
    const one = trueColors([review({ author: A(1), rating: 1 })], bal([[A(1), 1000n]]), NOW, neutralRep);
    expect(one.score).toBeCloseTo((1 + 6) / 3, 12);
  });

  it('counts only reviewers still holding (trimmed counts, with what they still hold)', () => {
    const holder = review({ author: A(1), rating: 5 });
    const trimmer = review({ author: A(2), rating: 1 });
    const seller = review({ author: A(3), rating: 1 });
    const t = trueColors([holder, trimmer, seller], bal([[A(1), 1000n], [A(2), 600n], [A(3), 100n]]), NOW, neutralRep);
    expect(t.reviewers).toBe(2);
    expect(t.sold).toBe(1);
    expect(t.counted.map((c) => c.state.kind)).toEqual(['holding', 'trimmed']);
    expect(t.average).toBeCloseTo(3, 12); // two wallets: capped to equal shares
  });

  it('replaced reviews don’t count twice; only the current one does', () => {
    const old = review({ author: A(1), rating: 1, status: 'replaced' });
    const cur = review({ author: A(1), rating: 4, previous: old.id });
    const t = trueColors([old, cur], bal([[A(1), 1000n]]), NOW, neutralRep);
    expect(t.reviewers).toBe(1);
    expect(t.average).toBe(4);
  });

  it('a whale can’t buy the score: 10% at most, however big', () => {
    const whale = review({ author: A(0xff), rating: 1, heldAtPost: 10n ** 27n });
    const crowd = Array.from({ length: 19 }, (_, i) => review({ author: A(i + 1), rating: 5, heldAtPost: 10n ** 18n }));
    const balances = bal([[A(0xff), 10n ** 27n], ...crowd.map((r): [Address, bigint] => [r.author, 10n ** 18n])]);
    const t = trueColors([whale, ...crowd], balances, NOW, neutralRep);
    expect(t.counted[0]!.weight).toBeCloseTo(0.1, 12);
    expect(t.average).toBeCloseTo(0.1 * 1 + 0.9 * 5, 12);
    expect(t.confidence).toBe('high');
  });

  it('longer holders and more honest reviewers count more', () => {
    const fresh = review({ author: A(1), rating: 1, postedAt: NOW });
    const veteran = review({ author: A(2), rating: 5, postedAt: NOW - 10 * DAY });
    const byTime = trueColors([fresh, veteran], bal([[A(1), 1000n], [A(2), 1000n]]), NOW, neutralRep);
    expect(byTime.counted.map((c) => c.weight)).toEqual([0.2, 0.8]); // 0.25 : 1
    const sameAge = [review({ author: A(1), rating: 1 }), review({ author: A(2), rating: 5 })];
    const reps: Record<string, HonestyRep> = { [A(1)]: { kept: 0, decided: 3, rep: 0, weight: 0.2 }, [A(2)]: { kept: 3, decided: 3, rep: 1, weight: 0.8 } };
    const byRep = trueColors(sameAge, bal([[A(1), 1000n], [A(2), 1000n]]), NOW, (a) => reps[a]!);
    expect(byRep.average).toBeCloseTo(0.2 * 1 + 0.8 * 5, 12);
  });

  it('confidence grows with the number of holders reviewing', () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => review({ author: A(i + 1) }));
    const all = (rs: ReviewRecord[]) => bal(rs.map((r): [Address, bigint] => [r.author, 1000n]));
    expect(trueColors(make(2), all(make(2)), NOW, neutralRep).confidence).toBe('low');
    expect(trueColors(make(5), all(make(5)), NOW, neutralRep).confidence).toBe('medium');
  });
});
