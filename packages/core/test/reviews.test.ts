import { describe, expect, it } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import {
  DAY,
  balanceKey,
  buildFeeds,
  buildWorld,
  countedMarks,
  filterReviews,
  rankReviewers,
  reviewerSummaries,
  VIBE_REFERRAL,
  tokenScore,
  type AssetInfo,
  type ReviewChainData,
  type ReviewerSummary,
  type StoredReview,
  type Supply,
  type WorldInput,
} from '../src';

const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, '0')}`);
const NOW = 1_800_000_000;
const MOON = A(0xaa);
const GRAD = A(0xbb);
const FAKE = A(0xcc); // someone's own ERC-20, not listed
const CREATOR = A(0x77);
const assets: Record<string, AssetInfo> = {
  [MOON.toLowerCase()]: { symbol: 'MOON', name: 'Moon Dog', kind: 'launch', graduatedBlock: null, creator: CREATOR },
  [GRAD.toLowerCase()]: { symbol: 'GRAD', name: 'Graduate', kind: 'launch', graduatedBlock: 5000, creator: null },
};
const assetOf = (t: Address) => assets[t.toLowerCase()] ?? null;
const supplies = new Map<string, Supply>([
  [MOON.toLowerCase(), { supply: 1_000_000n, decimals: 18 }],
  [GRAD.toLowerCase(), { supply: 1_000_000n, decimals: 18 }],
]);

type Posted = { text: string; block: number; logIndex: number; txHash: Hex };
function chain(entries: Array<[number, Partial<StoredReview> & { author: Address }, number?]>, markedBy: Array<[number, Address]> = []): ReviewChainData {
  const stored = new Map<number, StoredReview>();
  const posted = new Map<number, Posted>();
  for (const [id, s, block] of entries) {
    const held = s.heldAtPost ?? s.baseline ?? 1000n;
    stored.set(id, { rating: 5, status: 1, postedAt: NOW - 40 * DAY, soldAt: 0, token: MOON, previous: 0, heldAtPost: held, baseline: held, ...s });
    posted.set(id, { text: `review ${id}`, block: block ?? 1000 + id, logIndex: 0, txHash: `0x${id.toString(16).padStart(64, '0')}` as Hex });
  }
  return { stored, posted, markedBy: new Map(markedBy) };
}

/** A small, realistic world on the current contract. */
function world(extra: Partial<WorldInput> = {}) {
  const data = chain(
    [
      [2, { author: A(1), rating: 5 }],
      [3, { author: A(2), rating: 4 }],
      [4, { author: A(3), rating: 4, status: 2 }], // replaced by #7
      [5, { author: A(4), rating: 1, status: 3, soldAt: NOW - 38 * DAY }], // marked SOLD 2 days after reviewing
      [6, { author: A(5), rating: 5 }], // below half now, not marked yet
      [7, { author: A(3), rating: 3, previous: 4, postedAt: NOW - 5 * DAY }],
      [8, { author: A(1), rating: 5, token: GRAD }, 4000], // before GRAD graduated (block 5000)
      [9, { author: A(6), rating: 1, token: FAKE }], // unlisted token
      [10, { author: CREATOR, rating: 5 }], // the launch's own creator
      [11, { author: A(8), rating: 5, heldAtPost: 3n, baseline: 3n }], // dust
    ],
    [
      [5, A(9)],
      [11, A(9)], // a mark on a dust position: doesn't count
    ],
  );
  const balances = new Map<string, bigint | null>([
    [balanceKey(A(1), MOON), 1000n],
    [balanceKey(A(2), MOON), 700n],
    [balanceKey(A(3), MOON), 1000n],
    [balanceKey(A(5), MOON), 100n],
    [balanceKey(A(1), GRAD), 1000n],
    [balanceKey(A(6), FAKE), 10n ** 30n],
    [balanceKey(CREATOR, MOON), 500_000n],
    [balanceKey(A(8), MOON), 3n],
  ]);
  const input: WorldInput = { data, balances, supplies, assetOf, floorOf: () => 10n, now: NOW, ...extra };
  return { data, balances, w: buildWorld(input) };
}

describe('review views', () => {
  it('shows each review with its live state, position, days and text', () => {
    const { w } = world();
    expect(w.byId.get(2)).toMatchObject({ symbol: 'MOON', text: 'review 2', state: { kind: 'holding' }, supplyShare: 0.001, days: 40, rep: 1, excluded: null, listed: true });
    expect(w.byId.get(3)).toMatchObject({ state: { kind: 'trimmed', percent: 30 }, balance: '700', supplyShare: 0.0007 });
    expect(w.byId.get(5)).toMatchObject({ state: { kind: 'sold', marked: true }, days: 2, supplyShare: 0.001 });
    expect(w.byId.get(6)).toMatchObject({ state: { kind: 'sold', marked: false } });
    expect(w.byId.get(4)).toMatchObject({ state: { kind: 'replaced' }, replacedBy: 7 });
    // the run began with #4, 40 days ago: days count from there
    expect(w.byId.get(7)).toMatchObject({ previous: 4, days: 40 });
  });

  it('labels the creator’s own review, positions under the floor, and unlisted tokens', () => {
    const { w } = world();
    expect(w.byId.get(10)).toMatchObject({ creator: true, excluded: 'creator' });
    expect(w.byId.get(11)).toMatchObject({ excluded: 'small', floor: '10' });
    expect(w.byId.get(9)).toMatchObject({ listed: false, excluded: 'unlisted', name: 'Unknown token' });
  });

  it('a sold position stays a sold position: it isn’t "too small" because the seller holds little now', () => {
    const { w } = world();
    expect(w.byId.get(6)!.excluded).toBeNull(); // baseline 1000 ≥ floor, though 100 is held now
  });

  it('filters: Holding · Trimmed · SOLD · All (replaced reviews only on their own page)', () => {
    const { w } = world();
    const ids = (f: Parameters<typeof filterReviews>[1]) => filterReviews(w.views.filter((v) => v.listed), f).map((v) => v.id);
    expect(ids('holding')).toEqual([2, 7, 8, 10, 11]);
    expect(ids('trimmed')).toEqual([3]);
    expect(ids('sold')).toEqual([5, 6]);
  });

  it('strips bidi and zero-width characters from text people wrote', () => {
    const data = chain([[2, { author: A(1) }]]);
    data.posted.get(2)!.text = 'safe‮moc.live​ text﻿';
    const w = buildWorld({ data, balances: new Map([[balanceKey(A(1), MOON), 1000n]]), supplies, assetOf, now: NOW });
    expect(w.byId.get(2)!.text).toBe('safemoc.live text');
  });
});

describe('only what counts counts', () => {
  it('true colors use counted reviews only: no creator, no dust, no unlisted token', () => {
    const { w, balances } = world();
    const s = tokenScore(w, MOON, balances);
    expect(s.reviewers).toBe(3); // #2, #3 (trimmed), #7: not the creator (#10), not the dust (#11)
    expect(s.sold).toBe(2);
    expect(s.score).not.toBeNull();
    expect(s.total).toBe(7); // every current review of MOON shown on its page
  });

  it('honesty rep ignores the creator’s own launch and positions under the floor', () => {
    const { w } = world();
    expect(w.reps.get(CREATOR.toLowerCase())).toBeUndefined();
    expect(w.reps.get(A(8).toLowerCase())).toBeUndefined();
    expect(w.reps.get(A(6).toLowerCase())).toBeUndefined(); // the unlisted token
    expect(w.reps.get(A(1).toLowerCase())).toMatchObject({ kept: 2, decided: 2 });
  });

  it('a fake token can’t farm rep or reach the top launches, however many wallets review it', () => {
    const entries: Array<[number, Partial<StoredReview> & { author: Address }]> = Array.from({ length: 12 }, (_, i) => [i + 2, { author: A(0x100 + i), token: FAKE }]);
    const data = chain(entries);
    const balances = new Map(entries.map(([, s]) => [balanceKey(s.author, FAKE), 1000n]));
    const w = buildWorld({ data, balances, supplies, assetOf, now: NOW });
    expect(w.counted).toHaveLength(0);
    const f = buildFeeds(w, reviewerSummaries(w, data, balances, assetOf), balances);
    expect(f).toMatchObject({ latest: [], caught: [], topLaunches: [], topReviewers: [], gem: [] });
  });

  it('a launch newer than the index counts once it is indexed', () => {
    const data = chain([[2, { author: A(1), token: FAKE }]]);
    const balances = new Map([[balanceKey(A(1), FAKE), 1000n]]);
    expect(buildWorld({ data, balances, supplies, assetOf, now: NOW }).counted).toHaveLength(0);
    const indexed = (t: Address) => (t === FAKE ? { symbol: 'NEW', name: 'New one', kind: 'launch' as const, graduatedBlock: null, creator: null } : assetOf(t));
    expect(buildWorld({ data, balances, supplies, assetOf: indexed, now: NOW }).counted).toHaveLength(1);
  });

  it('sold below half and bought back: SOLD in the app, out of the score, sold for rep, in the caught feed', () => {
    const { w, data, balances } = world({ soldBack: new Map([[2, { at: NOW - 35 * DAY }]]) });
    expect(w.byId.get(2)!.state).toEqual({ kind: 'sold', marked: false, boughtBack: { at: NOW - 35 * DAY } });
    expect(w.byId.get(2)!.days).toBe(5);
    expect(tokenScore(w, MOON, balances).reviewers).toBe(2);
    expect(w.reps.get(A(1).toLowerCase())).toMatchObject({ kept: 1, decided: 2 }); // sold 5 days in
    const f = buildFeeds(w, reviewerSummaries(w, data, balances, assetOf), balances);
    expect(f.caught.map((v) => v.id)).toContain(2);
  });
});

describe('retired reviews (PRISM’s first contract)', () => {
  it('are shown with their live status by the old rules, and never counted', () => {
    const retired = chain([[1, { author: A(0x39), rating: 5, heldAtPost: 1000n }]]);
    const { w, data, balances } = world({ retired });
    const b = new Map(balances);
    b.set(balanceKey(A(0x39), MOON), 400n);
    const w2 = buildWorld({ data, retired, balances: b, supplies, assetOf, floorOf: () => 10n, now: NOW });
    expect(w2.byId.get(1)).toMatchObject({ retired: true, excluded: 'retired', state: { kind: 'sold', marked: false }, rep: null });
    expect(w2.counted.map((r) => r.id)).not.toContain(1);
    expect(tokenScore(w2, MOON, b)).toEqual(tokenScore(w, MOON, balances));
    const f = buildFeeds(w2, reviewerSummaries(w2, data, b, assetOf), b);
    // shown in "latest" as history (tagged Retired), but nowhere that counts
    expect(f.latest.map((v) => v.id)).toContain(1);
    expect(f.latest.find((v) => v.id === 1)).toMatchObject({ retired: true, excluded: 'retired' });
    expect(f.caught.map((v) => v.id)).not.toContain(1);
    expect(f.topReviewers.map((r) => r.address.toLowerCase())).not.toContain(A(0x39).toLowerCase());
    expect(f.gem.map((g) => g.id)).not.toContain(1);
  });
});

describe('reviewers, badges and truth keepers', () => {
  it('badges follow the counting rules', () => {
    const { w, data, balances } = world();
    const r = reviewerSummaries(w, data, balances, assetOf);
    expect(r.get(A(1).toLowerCase())).toMatchObject({ reviews: 2, holding: 2, badges: ['first-review', 'held-30', 'early-reviewer'] });
    expect(r.get(A(4).toLowerCase())).toMatchObject({ reviews: 1, sold: 1, rep: 0, badges: ['first-review'] });
    expect(r.get(A(3).toLowerCase())!.badges).toContain('held-30'); // the run started 40 days ago
    // shown, but no badges: the creator and the dust wallet
    expect(r.get(CREATOR.toLowerCase())).toMatchObject({ reviews: 1, badges: [] });
    expect(r.get(A(8).toLowerCase())).toMatchObject({ reviews: 1, badges: [] });
    expect(r.has(A(6).toLowerCase())).toBe(false); // unlisted: not even in profile stats
  });

  it('truth keeper marks count only on counted reviews of someone else', () => {
    const { w, data, balances } = world();
    expect(countedMarks(w, data.markedBy).get(A(9).toLowerCase())).toBe(1); // #5 counts, the dust #11 doesn't
    const self = chain([[2, { author: A(1), status: 3, soldAt: NOW - DAY }]], [[2, A(1)]]);
    const ws = buildWorld({ data: self, balances, supplies, assetOf, now: NOW });
    expect(countedMarks(ws, self.markedBy).size).toBe(0);
    expect(reviewerSummaries(w, data, balances, assetOf).get(A(9).toLowerCase())).toMatchObject({ marks: 1, badges: ['truth-keeper'] });
  });

  it('the honesty leaderboard needs 3 decided positions, ranked by (kept + 1) / (decided + 2)', () => {
    const r = (address: number, kept: number, decided: number): ReviewerSummary => ({ address: A(address), rep: decided ? kept / decided : null, kept, decided, reviews: decided, holding: 0, trimmed: 0, sold: 0, marks: 0, badges: [] });
    const ranked = rankReviewers([r(1, 1, 1), r(2, 9, 10), r(3, 3, 3), r(4, 2, 2)]);
    expect(ranked.map((x) => x.address)).toEqual([A(2), A(3)]); // 1 of 1 and 2 of 2 aren't shown yet
  });
});

describe('feeds', () => {
  it('latest (listed, retired ones too), caught (not dust), top launches, truth keepers and a gem of counted reviews', () => {
    const { w, data, balances } = world();
    const f = buildFeeds(w, reviewerSummaries(w, data, balances, assetOf), balances);
    expect(f.latest.map((v) => v.id)).toEqual([11, 10, 8, 7, 6, 5, 3, 2]);
    expect(f.caught.map((v) => v.id)).toEqual([6, 5]);
    expect(f.topLaunches.map((l) => l.symbol)).toEqual(['MOON']);
    expect(f.truthKeepers.map((t) => t.address)).toEqual([A(9).toLowerCase()]);
    expect(f.topReviewers).toEqual([]);
    expect(f.gem.map((g) => g.id)).toEqual([8, 7, 6, 5, 3, 2]); // not the creator's, not the dust
  });
});

describe('a launch from PRISM’s own wallets', () => {
  // $PRISM is launched from one owner wallet; the other is the creator's too
  const [OWNER_A, OWNER_B] = VIBE_REFERRAL.owners as [Address, Address];
  const PRISMLIKE = A(0xdd);
  const HOLDER = A(0x31);
  const info: AssetInfo = { symbol: 'PRISM', name: 'Prism', kind: 'launch', graduatedBlock: null, creator: OWNER_B, creatorWallets: VIBE_REFERRAL.owners };
  const build = (asset: AssetInfo, authors: Address[]) => {
    const entries = authors.map((author, i) => [2 + i, { author, rating: 5, token: PRISMLIKE }] as [number, Partial<StoredReview> & { author: Address }]);
    const balances = new Map<string, bigint | null>(authors.map((a) => [balanceKey(a, PRISMLIKE), 1000n]));
    const sup = new Map<string, Supply>([[PRISMLIKE.toLowerCase(), { supply: 1_000_000n, decimals: 18 }]]);
    const w = buildWorld({ data: chain(entries), balances, supplies: sup, assetOf: (t) => (t.toLowerCase() === PRISMLIKE.toLowerCase() ? asset : null), floorOf: () => 10n, now: NOW });
    return { w, balances };
  };

  it('has both owner wallets, written as the checksummed addresses the site uses', () => {
    expect(VIBE_REFERRAL.owners).toEqual(['0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e', '0x7Ed162246748A218E0404542683eeE0FC08fE4bD']);
  });

  it('labels a review from either owner wallet “Creator” and leaves it out of the score, in any letter case', () => {
    for (const recase of [(a: string) => a, (a: string) => a.toLowerCase(), (a: string) => `0x${a.slice(2).toUpperCase()}`]) {
      const { w, balances } = build(info, [recase(OWNER_A) as Address, recase(OWNER_B) as Address, HOLDER]);
      expect(w.byId.get(2)).toMatchObject({ creator: true, excluded: 'creator' });
      expect(w.byId.get(3)).toMatchObject({ creator: true, excluded: 'creator' });
      expect(w.byId.get(4)).toMatchObject({ creator: false, excluded: null });
      // the score is the one real holder's, and neither owner has an honesty rep from reviewing their own launch
      const s = tokenScore(w, PRISMLIKE, balances);
      expect(s.reviewers).toBe(1);
      expect(w.reps.get(OWNER_A.toLowerCase())).toBeUndefined();
      expect(w.reps.get(OWNER_B.toLowerCase())).toBeUndefined();
    }
  });

  it('does not extend to other launches: the owner wallets are ordinary holders there', () => {
    const other: AssetInfo = { symbol: 'MOON', name: 'Moon Dog', kind: 'launch', graduatedBlock: null, creator: CREATOR };
    const { w } = build(other, [OWNER_A, OWNER_B]);
    expect(w.byId.get(2)).toMatchObject({ creator: false, excluded: null });
    expect(w.byId.get(3)).toMatchObject({ creator: false, excluded: null });
  });
});
