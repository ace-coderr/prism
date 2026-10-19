import { describe, expect, it } from 'vitest';
import { getAddress, type Address } from 'viem';
import { EARLY_BUYERS, amount, duration, flagOf, share, xray, type LaunchSetup, type XrayInput, type XrayTransfer } from '../src';

const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, '0')}`);
const TOKEN = A(0xaa);
const CURVE = A(0xcc);
const POOL = A(0x8366);
const CREATOR = A(0x11);
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const E = (n: number | bigint) => BigInt(n) * 10n ** 18n;
const SUPPLY = E(1_000_000_000);
const LAUNCH_BLOCK = 1000;
const NOW_BLOCK = 1_000_000;
const SEC_PER_BLOCK = 0.12;
const NOW = 1_800_000_000;
/** the launch is (NOW_BLOCK - LAUNCH_BLOCK) * 0.12 s before now */
const LAUNCH_TIME = NOW - (NOW_BLOCK - LAUNCH_BLOCK) * SEC_PER_BLOCK;

let logIndex = 0;
const t = (from: string, to: string, value: bigint, block: number): XrayTransfer => ({ from, to, value, block, logIndex: logIndex++ });

const v6Setup: LaunchSetup = {
  kind: 'v6',
  taxBps: 300,
  split: { treasury: 10000, holdersPair: 0, holdersToken: 0, burn: 0 },
  protocolShareBps: 2000,
  airdrop: null,
  projectTreasury: null,
  createdAt: null,
  progress: 0.5,
  graduated: false,
};

function input(over: Partial<XrayInput> = {}): XrayInput {
  return {
    token: TOKEN,
    symbol: 'MOON',
    creator: CREATOR,
    launchBlock: LAUNCH_BLOCK,
    curve: CURVE,
    poolManager: POOL,
    graduatedBlock: null,
    transfers: [],
    complete: true,
    totalSupply: SUPPLY,
    decimals: 18,
    setup: v6Setup,
    timeOf: new Map([
      [LAUNCH_BLOCK, LAUNCH_TIME],
      [NOW_BLOCK, NOW],
    ]),
    secondsPerBlock: SEC_PER_BLOCK,
    nowBlock: NOW_BLOCK,
    now: NOW,
    ...over,
  };
}

const textOf = (x: ReturnType<typeof xray>, id: string) => x.signals.find((s) => s.id === id)?.text ?? null;
const unreadOf = (x: ReturnType<typeof xray>, id: string) => x.unread.find((u) => u.id === id)?.text ?? null;

/** the usual shape: everything mints to the curve, then the curve sells to buyers */
function launched(extra: XrayTransfer[] = [], opts: { creatorBuys?: bigint } = {}): XrayTransfer[] {
  const out = [t(ZERO, CURVE, SUPPLY, LAUNCH_BLOCK)];
  if (opts.creatorBuys) out.push(t(CURVE, CREATOR, opts.creatorBuys, LAUNCH_BLOCK + 10));
  return [...out, ...extra];
}

describe('formatting', () => {
  it('says amounts, shares and lengths of time the way people do', () => {
    expect(amount(E(1_200_000), 18)).toBe('1.2M');
    expect(amount(E(480), 18)).toBe('480');
    expect(amount(0n, 18)).toBe('0');
    expect(amount(5n * 10n ** 14n, 18)).toBe('0.0005');
    expect([0.92, 0.004, 0.0004, 1].map(share)).toEqual(['92%', '0.4%', '<0.1%', '100%']);
    expect([30, 240, 7200, 86400 * 12].map(duration)).toEqual(['30 seconds', '4 minutes', '2 hours', '12 days']);
    expect(duration(0)).toBe('less than a second');
  });
});

describe('age and status', () => {
  it('says whether it is on its curve or graduated, and how old it is', () => {
    expect(textOf(xray(input({ transfers: launched() })), 'age')).toBe('Still on its bonding curve, launched 1 day ago.');
    expect(textOf(xray(input({ transfers: launched(), graduatedBlock: 500_000 })), 'age')).toContain('Graduated to a pool');
    expect(textOf(xray(input({ setup: { kind: 'stock' }, creator: null })), 'age')).toContain('test stock: no launch, creator or bonding curve');
  });

  it('flags a worked-out time when the block’s timestamp wasn’t looked up', () => {
    const x = xray(input({ timeOf: new Map([[NOW_BLOCK, NOW]]) }));
    expect(x.signals.find((s) => s.id === 'age')!.estimated).toBe(true);
    expect(xray(input()).signals.find((s) => s.id === 'age')!.estimated).toBe(false);
  });
});

describe('the creator', () => {
  it('says what they bought and still hold (the supply mints to the curve, not to them)', () => {
    const x = xray(input({ transfers: launched([], { creatorBuys: E(100_000_000) }) }));
    expect(textOf(x, 'creator')).toBe('The creator still holds all 100M $MOON they bought (10% of the supply), 1 day in.');
    expect(x.creator).toMatchObject({ acquired: E(100_000_000), holds: E(100_000_000), movedOut: 0n, soldEverything: false });
    expect(x.creator!.shareOfSupply).toBeCloseTo(0.1, 6);
  });

  it('says when they never held any', () => {
    expect(textOf(xray(input({ transfers: launched() })), 'creator')).toBe('The creator has never held any $MOON.');
  });

  it('says when they sold everything, and how long after buying', () => {
    const transfers = launched([t(CREATOR, CURVE, E(50_000_000), LAUNCH_BLOCK + 2010)], { creatorBuys: E(50_000_000) });
    const timeOf = new Map([
      [LAUNCH_BLOCK, LAUNCH_TIME],
      [LAUNCH_BLOCK + 10, LAUNCH_TIME + 1],
      [LAUNCH_BLOCK + 2010, LAUNCH_TIME + 241],
      [NOW_BLOCK, NOW],
    ]);
    const x = xray(input({ transfers, timeOf }));
    expect(textOf(x, 'creator')).toBe('The creator sold everything they held (50M $MOON), starting 4 minutes after buying.');
    expect(x.creator!.soldEverything).toBe(true);
    expect(x.flag).toBe('Creator sold out');
  });

  it('says how much they moved out and their biggest single sale', () => {
    const transfers = launched(
      [t(CREATOR, CURVE, E(30_000_000), LAUNCH_BLOCK + 500), t(CREATOR, A(0x99), E(20_000_000), LAUNCH_BLOCK + 900)],
      { creatorBuys: E(100_000_000) },
    );
    const x = xray(input({ transfers }));
    expect(textOf(x, 'creator')).toBe('The creator has moved out 50% of what they bought and still holds 50M $MOON (5% of the supply). Biggest single sale: 30M.');
    expect(x.creator).toMatchObject({ movedOut: E(50_000_000), biggestOut: E(30_000_000), biggestOutBlock: LAUNCH_BLOCK + 500 });
    expect(x.flag).toBe('Creator sold 50% of their bag');
  });

  it('a creator who is also the curve is read from the curve’s own transfers, not invented', () => {
    // some launches put the creator and the curve at the same address: everything it sends out is a buy
    const x = xray(input({ creator: CURVE, transfers: launched([t(CURVE, A(0x55), E(1000), LAUNCH_BLOCK + 5)]) }));
    expect(x.creator!.address).toBe(CURVE);
    expect(x.creator!.acquired).toBe(SUPPLY); // the mint
    expect(textOf(x, 'creator')).toContain('The creator has moved out');
    // and it is still left out of the holder count and concentration
    expect(x.concentration!.holders).toBe(1);
  });

  it('says so when it can’t read who launched it, or the history is partial', () => {
    expect(unreadOf(xray(input({ creator: null })), 'creator')).toBe('PRISM couldn’t read who launched this.');
    const partial = xray(input({ complete: false, transfers: launched() }));
    expect(unreadOf(partial, 'creator')).toContain('couldn’t read this launch’s full history');
    expect(partial.signals.map((s) => s.id)).not.toContain('creator');
    expect(partial.creator).toBeNull();
  });
});

describe('concentration', () => {
  it('counts holders only: not the curve, the pool, the token’s own rewards or burns', () => {
    const transfers = launched([
      t(CURVE, A(0x21), E(600), LAUNCH_BLOCK + 1),
      t(CURVE, A(0x22), E(300), LAUNCH_BLOCK + 2),
      t(CURVE, A(0x23), E(100), LAUNCH_BLOCK + 3),
      t(A(0x21), TOKEN, E(10), LAUNCH_BLOCK + 4), // tax into the token's reward pool
      t(TOKEN, DEAD, E(10), LAUNCH_BLOCK + 5), // burned
      t(CURVE, POOL, E(1000), LAUNCH_BLOCK + 6), // liquidity at graduation
    ]);
    const x = xray(input({ transfers }));
    expect(x.concentration).toMatchObject({ holders: 3, circulating: E(990) });
    expect(x.concentration!.top3).toBeCloseTo(1, 6);
    expect(textOf(x, 'concentration')).toBe('Of the 3 wallets holding $MOON, the top 3 wallets hold 100%.');
  });

  it('reports the top 3 and top 10 of a wider field, and the biggest holder as the link', () => {
    const buys = Array.from({ length: 12 }, (_, i) => t(CURVE, A(0x30 + i), E(i === 0 ? 5000 : 100), LAUNCH_BLOCK + 1 + i));
    const x = xray(input({ transfers: launched(buys) }));
    expect(x.concentration!.holders).toBe(12);
    expect(x.concentration!.top3).toBeCloseTo(5200 / 6100, 4);
    expect(x.concentration!.biggest!.address).toBe(A(0x30).toLowerCase());
    expect(textOf(x, 'concentration')).toContain('the top 10 hold');
    expect(x.signals.find((s) => s.id === 'concentration')!.evidence).toEqual({ kind: 'address', value: A(0x30).toLowerCase() });
  });

  it('one holder, and nobody holding, are both said plainly', () => {
    const one = xray(input({ transfers: launched([t(CURVE, A(0x21), E(10), LAUNCH_BLOCK + 1)]) }));
    expect(textOf(one, 'concentration')).toBe('One wallet holds every $MOON in circulation.');
    const none = xray(input({ transfers: [t(ZERO, CURVE, SUPPLY, LAUNCH_BLOCK)] }));
    expect(unreadOf(none, 'concentration')).toBe('Nobody holds any $MOON yet.');
    expect(none.concentration).toBeNull();
  });
});

describe('the first buyers', () => {
  const buyAt = (who: Address, block: number) => t(CURVE, who, E(100), block);

  it('counts how many still hold and how many were out within an hour', () => {
    const transfers = launched([
      buyAt(A(0x41), LAUNCH_BLOCK + 1),
      buyAt(A(0x42), LAUNCH_BLOCK + 2),
      buyAt(A(0x43), LAUNCH_BLOCK + 3),
      t(A(0x42), CURVE, E(100), LAUNCH_BLOCK + 100), // out quickly
      t(A(0x43), CURVE, E(100), LAUNCH_BLOCK + 90_000), // out, but much later
    ]);
    const timeOf = new Map([
      [LAUNCH_BLOCK, LAUNCH_TIME],
      [LAUNCH_BLOCK + 1, LAUNCH_TIME + 1],
      [LAUNCH_BLOCK + 2, LAUNCH_TIME + 2],
      [LAUNCH_BLOCK + 3, LAUNCH_TIME + 3],
      [LAUNCH_BLOCK + 100, LAUNCH_TIME + 60],
      [LAUNCH_BLOCK + 90_000, LAUNCH_TIME + 50_000],
      [NOW_BLOCK, NOW],
    ]);
    const x = xray(input({ transfers, timeOf }));
    expect(x.early).toEqual({ counted: 3, stillHolding: 1, goneWithinHour: 1, exactTimes: true });
    expect(textOf(x, 'early')).toBe('Of its first 3 buyers, 1 still holds and 1 was out within an hour.');
  });

  it('someone who bought again after selling still counts as holding', () => {
    const transfers = launched([buyAt(A(0x41), LAUNCH_BLOCK + 1), t(A(0x41), CURVE, E(100), LAUNCH_BLOCK + 50), buyAt(A(0x41), LAUNCH_BLOCK + 60)]);
    const x = xray(input({ transfers }));
    expect(x.early).toMatchObject({ counted: 1, stillHolding: 1, goneWithinHour: 0 });
  });

  it('looks at the first 20 buyers only', () => {
    const buys = Array.from({ length: 30 }, (_, i) => buyAt(A(0x100 + i), LAUNCH_BLOCK + 1 + i));
    expect(xray(input({ transfers: launched(buys) })).early!.counted).toBe(EARLY_BUYERS);
  });

  it('buys through the pool count too, once it has graduated', () => {
    const x = xray(input({ graduatedBlock: 500, transfers: launched([t(POOL, A(0x51), E(10), LAUNCH_BLOCK + 600)]) }));
    expect(x.early).toMatchObject({ counted: 1, stillHolding: 1 });
  });

  it('says so when there are no buys, or buys can’t be told apart', () => {
    expect(unreadOf(xray(input({ transfers: launched() })), 'early')).toBe('Nobody has bought $MOON yet.');
    const blind = xray(input({ curve: null, poolManager: null, transfers: launched() }));
    expect(unreadOf(blind, 'early')).toContain('can’t tell buys apart');
  });

  it('flags the times as worked out when a block’s timestamp is missing', () => {
    const transfers = launched([buyAt(A(0x41), LAUNCH_BLOCK + 1), t(A(0x41), CURVE, E(100), LAUNCH_BLOCK + 2)]);
    const x = xray(input({ transfers }));
    expect(x.early!.exactTimes).toBe(false);
    expect(x.signals.find((s) => s.id === 'early')!.estimated).toBe(true);
  });
});

describe('holders over the last day', () => {
  it('compares the count now with a day ago', () => {
    // a day is 720,000 blocks at 0.12 s; these buys land inside and outside that window
    const old = NOW_BLOCK - 800_000;
    const recent = NOW_BLOCK - 1000;
    const transfers = launched([t(CURVE, A(0x61), E(10), old), t(CURVE, A(0x62), E(10), recent), t(CURVE, A(0x63), E(10), recent)]);
    expect(textOf(xray(input({ transfers })), 'holders')).toBe('3 wallets hold it, +2 in the last day.');
  });

  it('says there is nothing to compare on a launch younger than a day', () => {
    const young = xray(input({ launchBlock: NOW_BLOCK - 1000, transfers: [t(ZERO, CURVE, SUPPLY, NOW_BLOCK - 1000), t(CURVE, A(0x61), E(10), NOW_BLOCK - 900)] }));
    expect(textOf(young, 'holders')).toBe('It is less than a day old, so there is nothing to compare yet: 1 wallets hold it.');
  });
});

describe('the tax', () => {
  it('says the rate and whether holders get any of it', () => {
    expect(textOf(xray(input()), 'tax')).toBe('3% tax on every trade, and none of it goes to holders.');
    const toHolders = { ...v6Setup, split: { treasury: 2000, holdersPair: 3000, holdersToken: 4000, burn: 1000 } };
    expect(textOf(xray(input({ setup: toHolders })), 'tax')).toBe('3% tax on every trade, 70% of the creator’s part going back to holders.');
    expect(textOf(xray(input({ setup: { ...v6Setup, split: null } })), 'tax')).toContain('couldn’t read how it is split');
  });

  it('older launches charge a fixed curve fee instead', () => {
    const old: LaunchSetup = { kind: 'curve-fee', feeBps: 125, creatorShareBps: 7500, creatorVault: null, createdAt: null, progress: 0.2, graduated: false };
    expect(textOf(xray(input({ setup: old })), 'tax')).toBe('An older launch: a fixed 1.25% curve fee, none of it to holders.');
    expect(unreadOf(xray(input({ setup: null })), 'tax')).toBe('PRISM couldn’t read this launch’s setup.');
  });
});

describe('awkward launches', () => {
  it('a token with no transfers at all says what it can and nothing more', () => {
    const x = xray(input({ transfers: [] }));
    expect(textOf(x, 'age')).toContain('Still on its bonding curve');
    expect(textOf(x, 'creator')).toBe('The creator has never held any $MOON.');
    expect(unreadOf(x, 'concentration')).toBe('Nobody holds any $MOON yet.');
    expect(unreadOf(x, 'early')).toBe('Nobody has bought $MOON yet.');
    expect(x.flag).toBeNull();
  });

  it('transfers that don’t balance never make a negative holder', () => {
    // a wallet sending more than it ever received (a rebasing or reflecting token)
    const x = xray(input({ transfers: launched([t(A(0x71), CURVE, E(500), LAUNCH_BLOCK + 1), t(CURVE, A(0x72), E(100), LAUNCH_BLOCK + 2)]) }));
    expect(x.concentration!.holders).toBe(1);
    expect(x.concentration!.circulating).toBe(E(100));
  });

  it('everything burned leaves nobody holding', () => {
    const x = xray(input({ transfers: launched([t(CURVE, A(0x81), E(100), LAUNCH_BLOCK + 1), t(A(0x81), DEAD, E(100), LAUNCH_BLOCK + 2)]) }));
    expect(unreadOf(x, 'concentration')).toBe('Nobody holds any $MOON yet.');
    expect(x.early).toMatchObject({ counted: 1, stillHolding: 0 });
  });

  it('a partial history states nothing that needs all of it', () => {
    const x = xray(input({ complete: false, transfers: launched([], { creatorBuys: E(10) }) }));
    expect(x.signals.map((s) => s.id).sort()).toEqual(['age', 'tax']);
    expect(x.unread.map((u) => u.id).sort()).toEqual(['concentration', 'creator', 'early', 'holders']);
    expect(x.flag).toBeNull();
    expect(x.holders).toBeNull();
  });
});

describe('the one-line flag for cards and search', () => {
  it('leads with what most changes what someone is looking at', () => {
    const sold = { address: CREATOR, acquired: E(100), holds: 0n, movedOut: E(100), firstInBlock: 1, firstOutBlock: 2, biggestOut: E(100), biggestOutBlock: 2, soldEverything: true, shareOfSupply: 0 };
    expect(flagOf({ creator: sold, concentration: null, early: null })).toBe('Creator sold out');
    const half = { ...sold, holds: E(40), movedOut: E(60), soldEverything: false, shareOfSupply: 0.04 };
    expect(flagOf({ creator: half, concentration: null, early: null })).toBe('Creator sold 60% of their bag');
    expect(flagOf({ creator: null, concentration: { holders: 20, circulating: E(100), top3: 0.85, top10: 0.95, biggest: null }, early: null })).toBe('Top 3 wallets hold 85%');
    expect(flagOf({ creator: null, concentration: null, early: { counted: 20, stillHolding: 5, goneWithinHour: 12, exactTimes: true } })).toBe('12 of the first 20 buyers left within an hour');
    const whale = { ...sold, holds: E(90), movedOut: 0n, soldEverything: false, shareOfSupply: 0.9 };
    expect(flagOf({ creator: whale, concentration: null, early: null })).toBe('Creator holds 90% of the supply');
  });

  it('says nothing when nothing stands out', () => {
    const steady = { address: CREATOR, acquired: E(10), holds: E(10), movedOut: 0n, firstInBlock: 1, firstOutBlock: null, biggestOut: 0n, biggestOutBlock: null, soldEverything: false, shareOfSupply: 0.01 };
    expect(flagOf({ creator: steady, concentration: { holders: 50, circulating: E(100), top3: 0.2, top10: 0.4, biggest: null }, early: { counted: 20, stillHolding: 18, goneWithinHour: 1, exactTimes: true } })).toBeNull();
    expect(flagOf({ creator: null, concentration: null, early: null })).toBeNull();
  });
});
