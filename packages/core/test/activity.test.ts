import { describe, expect, it } from 'vitest';
import type { Address, Hash } from 'viem';
import { activityOf, badgesOf, forgedBy, forgerOf, identicon, sortEvents, type CrystalEvent } from '../src';

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const ALICE = '0x00000000000000000000000000000000000a11ce' as Address;
const BOB = '0x0000000000000000000000000000000000000b0b' as Address;
const CAROL = '0x00000000000000000000000000000000000ca201' as Address;
const ROUTER = '0x000000000000000000000000000000000000r0u7'.replace('r0u7', 'f00d') as Address;

let n = 0;
const tx = (k: number) => `0x${k.toString(16).padStart(64, '0')}` as Hash;
const ev = (block: number, txk: number, e: Omit<CrystalEvent, 'block' | 'logIndex' | 'tx'>): CrystalEvent => ({
  ...e,
  block: BigInt(block),
  logIndex: n++,
  tx: tx(txk),
});

// #1: alice forges, seals, then gives it to carol.
// #2: forged through the router for bob; bob tops it up, withdraws, then burns it.
// #3: carol forges with 5 assets.
const events = sortEvents([
  ev(10, 1, { kind: 'transfer', id: 1n, from: ZERO, to: ALICE }),
  ev(10, 1, { kind: 'forged', id: 1n, account: ALICE, assets: 2 }),
  ev(11, 2, { kind: 'transfer', id: 2n, from: ZERO, to: ROUTER }),
  ev(11, 2, { kind: 'forged', id: 2n, account: ROUTER, assets: 3 }),
  ev(11, 2, { kind: 'transfer', id: 2n, from: ROUTER, to: BOB }),
  ev(12, 3, { kind: 'sealed', id: 1n, unlockTime: 2_000_000_000 }),
  ev(13, 4, { kind: 'transfer', id: 1n, from: ALICE, to: CAROL }),
  ev(14, 5, { kind: 'added', id: 2n, account: BOB, assets: 1 }),
  ev(15, 6, { kind: 'withdrawn', id: 2n, account: BOB, assets: 1 }),
  ev(16, 7, { kind: 'transfer', id: 2n, from: BOB, to: ZERO }),
  ev(16, 7, { kind: 'burned', id: 2n, account: BOB, assets: 3 }),
  ev(17, 8, { kind: 'transfer', id: 3n, from: ZERO, to: CAROL }),
  ev(17, 8, { kind: 'forged', id: 3n, account: CAROL, assets: 5 }),
]);

describe('activity from PrismCrystal events', () => {
  it('credits a router forge to the person it handed the crystal to', () => {
    const forged = events.find((e) => e.kind === 'forged' && e.id === 2n)!;
    expect(forgerOf(events, forged, ROUTER)).toBe(BOB);
    expect(forgerOf(events, forged, null)).toBe(ROUTER);
    expect(forgedBy(events, BOB, ROUTER).map((a) => a.id)).toEqual([2n]);
  });

  it("lists alice's activity newest first", () => {
    expect(activityOf(events, ALICE, ROUTER).map((a) => [a.kind, a.id, a.counterparty ?? null])).toEqual([
      ['gifted', 1n, CAROL],
      ['sealed', 1n, null],
      ['forged', 1n, null],
    ]);
  });

  it("lists bob's: the router hand-off and the burn's transfer are not gifts", () => {
    expect(activityOf(events, BOB, ROUTER).map((a) => a.kind)).toEqual(['burned', 'withdrew', 'added', 'forged']);
  });

  it("lists carol's, including what she received", () => {
    expect(activityOf(events, CAROL, ROUTER).map((a) => [a.kind, a.id, a.counterparty ?? null])).toEqual([
      ['forged', 3n, null],
      ['received', 1n, ALICE],
    ]);
  });

  it('matches addresses case-insensitively', () => {
    expect(activityOf(events, ALICE.toUpperCase().replace('0X', '0x') as Address, ROUTER)).toHaveLength(3);
  });
});

describe('badges', () => {
  it('lights only what was earned', () => {
    const alice = badgesOf({ activity: activityOf(events, ALICE, ROUTER), owned: [] });
    const earned = (b: typeof alice) => b.filter((x) => x.isEarned).map((x) => x.id);
    expect(earned(alice)).toEqual(['first-forge', 'gifter', 'sealed']);

    const carol = badgesOf({
      activity: activityOf(events, CAROL, ROUTER),
      owned: [
        { id: 1n, assets: 2, goldSeams: 1 },
        { id: 3n, assets: 5, goldSeams: 0 },
      ],
    });
    expect(earned(carol)).toEqual(['first-forge', 'kintsugi', 'diversified', 'early']);

    const nobody = badgesOf({ activity: [], owned: [{ id: 101n, assets: 4, goldSeams: 0 }] });
    expect(earned(nobody)).toEqual([]);
    expect(nobody.every((b) => b.how.length > 0 && b.earned.length > 0)).toBe(true);
  });
});

describe('identicon', () => {
  it('is deterministic per address and differs between addresses', () => {
    const a = identicon(ALICE);
    expect(identicon(ALICE)).toEqual(a);
    expect(identicon(ALICE.toUpperCase().replace('0X', '0x') as Address)).toEqual(a);
    expect(identicon(BOB)).not.toEqual(a);
    expect(a.holdings.length).toBeGreaterThanOrEqual(3);
    expect(a.holdings.length).toBeLessThanOrEqual(5);
    expect(a.holdings.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 9);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThanOrEqual(1);
  });
});
