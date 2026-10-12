import { describe, expect, it } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import {
  DAY,
  balanceKey,
  buildFeeds,
  buildWorld,
  filterReviews,
  reviewerSummaries,
  tokenScore,
  type AssetInfo,
  type ReviewChainData,
  type StoredReview,
  type Supply,
} from '../src';

const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, '0')}`);
const NOW = 1_800_000_000;
const MOON = A(0xaa);
const GRAD = A(0xbb);
const assets: Record<string, AssetInfo> = {
  [MOON.toLowerCase()]: { symbol: 'MOON', name: 'Moon Dog', kind: 'launch', graduatedBlock: null },
  [GRAD.toLowerCase()]: { symbol: 'GRAD', name: 'Graduate', kind: 'launch', graduatedBlock: 5000 },
};
const assetOf = (t: Address) => assets[t.toLowerCase()] ?? null;
const supplies = new Map<string, Supply>([
  [MOON.toLowerCase(), { supply: 1_000_000n, decimals: 18 }],
  [GRAD.toLowerCase(), { supply: 1_000_000n, decimals: 18 }],
]);

/** A small, realistic world: three holders of MOON, a seller, an update, a review of a launch that later graduated. */
function world() {
  const stored = new Map<number, StoredReview>();
  const posted = new Map<number, { text: string; block: number; txHash: Hex }>();
  const add = (id: number, s: Partial<StoredReview> & { author: Address }, block = 1000 + id) => {
    stored.set(id, { rating: 5, status: 1, postedAt: NOW - 40 * DAY, soldAt: 0, token: MOON, previous: 0, heldAtPost: 1000n, ...s });
    posted.set(id, { text: `review ${id}`, block, txHash: `0x${id.toString(16).padStart(64, '0')}` as Hex });
  };
  add(1, { author: A(1), rating: 5 });
  add(2, { author: A(2), rating: 4 });
  add(3, { author: A(3), rating: 4, status: 2 }); // replaced by #6
  add(4, { author: A(4), rating: 1, status: 3, soldAt: NOW - 38 * DAY }); // marked SOLD 2 days after reviewing
  add(5, { author: A(5), rating: 5 }); // sold below half, not marked yet
  add(6, { author: A(3), rating: 3, previous: 3, postedAt: NOW - 5 * DAY });
  add(7, { author: A(1), rating: 5, token: GRAD }, 4000); // before GRAD graduated (block 5000)
  const data: ReviewChainData = { stored, posted, markedBy: new Map([[4, A(9)]]) };
  const balances = new Map<string, bigint | null>([
    [balanceKey(A(1), MOON), 1000n],
    [balanceKey(A(2), MOON), 700n],
    [balanceKey(A(3), MOON), 1000n],
    [balanceKey(A(5), MOON), 100n],
    [balanceKey(A(1), GRAD), 1000n],
  ]);
  return { data, balances, w: buildWorld(data, balances, supplies, assetOf, NOW) };
}

describe('review views', () => {
  it('shows each review with its live state, position, days and text', () => {
    const { w } = world();
    expect(w.byId.get(1)).toMatchObject({ symbol: 'MOON', text: 'review 1', state: { kind: 'holding' }, supplyShare: 0.001, days: 40, rep: 1 });
    expect(w.byId.get(2)).toMatchObject({ state: { kind: 'trimmed', percent: 30 }, balance: '700', supplyShare: 0.0007 });
    expect(w.byId.get(4)).toMatchObject({ state: { kind: 'sold', marked: true }, days: 2, supplyShare: 0.001 }); // sold 2 days after reviewing
    expect(w.byId.get(5)).toMatchObject({ state: { kind: 'sold', marked: false } });
    expect(w.byId.get(3)).toMatchObject({ state: { kind: 'replaced' }, replacedBy: 6 });
    expect(w.byId.get(6)).toMatchObject({ previous: 3, days: 5 });
  });

  it('filters: Holding · Trimmed · SOLD · All (replaced reviews only on their own page)', () => {
    const { w } = world();
    const ids = (f: Parameters<typeof filterReviews>[1]) => filterReviews(w.views, f).map((v) => v.id);
    expect(ids('holding')).toEqual([1, 6, 7]);
    expect(ids('trimmed')).toEqual([2]);
    expect(ids('sold')).toEqual([4, 5]);
    expect(ids('all')).toEqual([1, 2, 4, 5, 6, 7]);
  });
});

describe('true colors on a token page', () => {
  it('is shown from 3 holding reviewers, never counting sellers', () => {
    const { w, balances } = world();
    const s = tokenScore(w, MOON, balances);
    expect(s.reviewers).toBe(3); // #1, #2 (trimmed), #6
    expect(s.sold).toBe(2);
    expect(s.score).not.toBeNull();
    expect(s.score!).toBeGreaterThan(3);
    expect(s.score!).toBeLessThan(5);
  });

  it('is hidden below 3 (“Not enough reviews yet”)', () => {
    const { w, balances } = world();
    const s = tokenScore(w, GRAD, balances);
    expect(s).toMatchObject({ score: null, reviewers: 1, total: 1 });
  });
});

describe('reviewers and badges', () => {
  it('counts holding / trimmed / SOLD, and awards badges from what happened on-chain', () => {
    const { w, data, balances } = world();
    const r = reviewerSummaries(w, data, balances, assetOf);
    expect(r.get(A(1).toLowerCase())).toMatchObject({ reviews: 2, holding: 2, badges: ['first-review', 'held-30', 'early-reviewer'] });
    expect(r.get(A(4).toLowerCase())).toMatchObject({ reviews: 1, sold: 1, rep: 0, badges: ['first-review'] });
    expect(r.get(A(9).toLowerCase())).toMatchObject({ reviews: 0, marks: 1, badges: ['truth-keeper'] });
    // A(3)'s position started 40 days ago and continues through the update
    expect(r.get(A(3).toLowerCase())!.badges).toContain('held-30');
  });
});

describe('feeds', () => {
  it('latest reviews, sellers caught (not yet permanent first), top launches and truth keepers', () => {
    const { w, data, balances } = world();
    const f = buildFeeds(w, reviewerSummaries(w, data, balances, assetOf), balances);
    expect(f.latest.map((v) => v.id)).toEqual([7, 6, 5, 4, 2, 1]);
    expect(f.caught.map((v) => v.id)).toEqual([5, 4]);
    expect(f.topLaunches.map((l) => l.symbol)).toEqual(['MOON']);
    expect(f.truthKeepers.map((t) => t.address)).toEqual([A(9).toLowerCase()]);
    expect(f.topReviewers).toEqual([]); // nobody has 3 reviews yet
    expect(f.gem.map((g) => g.id)).toEqual(f.latest.map((v) => v.id)); // newest first, current only
    expect(f.gem.filter((g) => g.state.kind === 'sold')).toHaveLength(2);
  });
});
