/**
 * Everything PRISM shows about reviews, computed from the chain: PrismReviews' stored reviews
 * (getReview), their text (ReviewPosted events), who made sales permanent (markSold callers), live
 * balances and token supplies. Pure: ./reviewsChain.ts does the reads. JSON-safe output (bigints as
 * decimal strings) so the server can send it as is.
 */
import type { Address, Hex } from 'viem';
import {
  DAY,
  balanceKey,
  honestyRep,
  positionsOf,
  reviewState,
  trueColors,
  type Balances,
  type HonestyRep,
  type OnchainStatus,
  type ReviewRecord,
  type ReviewState,
  type TrueColors,
} from './scoring';

/** Minimum holding reviewers before a token shows a true colors score. */
export const MIN_SCORE_REVIEWERS = 3;
/** Minimum reviews before a reviewer appears on the honesty leaderboard. */
export const MIN_LEADERBOARD_REVIEWS = 3;
export const HELD_LONG_DAYS = 30;
export const EARLY_REVIEWERS = 10;

/** What PrismReviews.getReview returns (status as its enum number). */
export interface StoredReview {
  author: Address;
  rating: number;
  status: number;
  postedAt: number;
  soldAt: number;
  token: Address;
  previous: number;
  heldAtPost: bigint;
}

export interface ReviewChainData {
  /** id → stored review (ids 1..n) */
  stored: ReadonlyMap<number, StoredReview>;
  /** id → text, block and transaction from its ReviewPosted event */
  posted: ReadonlyMap<number, { text: string; block: number; txHash: Hex }>;
  /** id → who called markSold on it (absent: not marked, or marked while its author posted an update) */
  markedBy: ReadonlyMap<number, Address>;
}

/** What PRISM knows about a reviewed token (from the launch index or the test stock list). */
export interface AssetInfo {
  symbol: string;
  name: string;
  kind: 'stock' | 'launch';
  /** launches only: graduation block, null while on its curve */
  graduatedBlock: number | null;
}

const STATUS: Record<number, OnchainStatus | null> = { 0: null, 1: 'active', 2: 'replaced', 3: 'sold' };

export function toRecords(data: Pick<ReviewChainData, 'stored'>): ReviewRecord[] {
  const out: ReviewRecord[] = [];
  for (const [id, s] of data.stored) {
    const status = STATUS[s.status];
    if (!status) continue;
    out.push({
      id,
      author: s.author,
      token: s.token,
      rating: s.rating,
      heldAtPost: s.heldAtPost,
      postedAt: s.postedAt,
      status,
      soldAt: s.soldAt > 0 ? s.soldAt : null,
      previous: s.previous,
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

// ------------------------------------------------------------------ views

export interface ReviewView {
  id: number;
  author: Address;
  token: Address;
  symbol: string;
  name: string;
  kind: 'stock' | 'launch';
  rating: number;
  text: string;
  /** base units, as decimal strings */
  heldAtPost: string;
  balance: string | null;
  decimals: number;
  /** what they hold now (or held, once sold) as a share of supply, 0..1 */
  supplyShare: number | null;
  postedAt: number;
  soldAt: number | null;
  status: OnchainStatus;
  state: ReviewState;
  /** marked or seen SOLD: days between reviewing and selling (rounded down); else days held so far */
  days: number;
  previous: number;
  replacedBy: number | null;
  /** the author's honesty rep */
  rep: number | null;
  block: number | null;
  txHash: Hex | null;
}

export interface Supply {
  supply: bigint;
  decimals: number;
}

export interface ReviewWorld {
  now: number;
  records: ReviewRecord[];
  views: ReviewView[];
  byId: Map<number, ReviewView>;
  reps: Map<string, HonestyRep>;
}

/** Every review as the app shows it, plus each author's honesty rep. */
export function buildWorld(
  data: ReviewChainData,
  balances: Balances,
  supplies: ReadonlyMap<string, Supply | null>,
  assetOf: (token: Address) => AssetInfo | null,
  now: number,
): ReviewWorld {
  const records = toRecords(data);
  const byAuthor = new Map<string, ReviewRecord[]>();
  for (const r of records) byAuthor.set(r.author.toLowerCase(), [...(byAuthor.get(r.author.toLowerCase()) ?? []), r]);
  const reps = new Map([...byAuthor].map(([a, rs]) => [a, honestyRep(rs, balances, now)]));
  const replacedBy = new Map(records.filter((r) => r.previous).map((r) => [r.previous, r.id]));
  const views = records.map((r): ReviewView => {
    const balance = balances.get(balanceKey(r.author, r.token)) ?? null;
    const state = reviewState(r, r.status === 'active' ? balance : null);
    const asset = assetOf(r.token);
    const supply = supplies.get(r.token.toLowerCase()) ?? null;
    const sold = state.kind === 'sold';
    const held = sold || r.status === 'replaced' || balance === null ? r.heldAtPost : balance;
    const until = r.status === 'sold' && r.soldAt ? r.soldAt : now;
    const post = data.posted.get(r.id);
    return {
      id: r.id,
      author: r.author,
      token: r.token,
      symbol: asset?.symbol ?? `${r.token.slice(0, 6)}…`,
      name: asset?.name ?? 'Unknown token',
      kind: asset?.kind ?? 'launch',
      rating: r.rating,
      text: post?.text ?? '',
      heldAtPost: r.heldAtPost.toString(),
      balance: balance === null ? null : balance.toString(),
      decimals: supply?.decimals ?? 18,
      supplyShare: supply && supply.supply > 0n ? Number((held * 1_000_000n) / supply.supply) / 1_000_000 : null,
      postedAt: r.postedAt,
      soldAt: r.soldAt,
      status: r.status,
      state,
      days: Math.max(0, Math.floor((until - r.postedAt) / DAY)),
      previous: r.previous,
      replacedBy: replacedBy.get(r.id) ?? null,
      rep: reps.get(r.author.toLowerCase())?.rep ?? null,
      block: post?.block ?? null,
      txHash: post?.txHash ?? null,
    };
  });
  return { now, records, views, byId: new Map(views.map((v) => [v.id, v])), reps };
}

export const filterKinds = ['holding', 'trimmed', 'sold', 'all'] as const;
export type ReviewFilter = (typeof filterKinds)[number];

/** Current reviews (not replaced) matching a filter; SOLD ones stay in "sold" and "all". */
export function filterReviews(views: readonly ReviewView[], filter: ReviewFilter): ReviewView[] {
  const current = views.filter((v) => v.status !== 'replaced');
  if (filter === 'all') return current;
  return current.filter((v) => v.state.kind === filter);
}

export interface ScoreSummary {
  /** null until MIN_SCORE_REVIEWERS holders still holding have reviewed it */
  score: number | null;
  reviewers: number;
  sold: number;
  confidence: TrueColors['confidence'];
  total: number;
}

/** A token's true colors, hidden below MIN_SCORE_REVIEWERS holding reviewers. */
export function tokenScore(world: ReviewWorld, token: Address, balances: Balances): ScoreSummary {
  const records = world.records.filter((r) => r.token.toLowerCase() === token.toLowerCase());
  const t = trueColors(records, balances, world.now, (a) => world.reps.get(a.toLowerCase()) ?? { kept: 0, decided: 0, rep: null, weight: 0.5 });
  return {
    score: t.reviewers >= MIN_SCORE_REVIEWERS ? t.score : null,
    reviewers: t.reviewers,
    sold: t.sold,
    confidence: t.confidence,
    total: records.filter((r) => r.status !== 'replaced').length,
  };
}

// ------------------------------------------------------------------ reviewers and badges

export type BadgeId = 'first-review' | 'truth-keeper' | 'held-30' | 'early-reviewer';

export const BADGES: Record<BadgeId, { title: string; how: string }> = {
  'first-review': { title: 'First review', how: 'Posted a review' },
  'truth-keeper': { title: 'Truth keeper', how: 'Made a sale permanent with “Make it permanent”' },
  'held-30': { title: 'Held 30 days', how: 'Kept holding at least 30 days after reviewing' },
  'early-reviewer': { title: 'Early reviewer', how: 'One of the first 10 reviewers of a launch that later graduated' },
};

export interface ReviewerSummary {
  address: Address;
  rep: number | null;
  kept: number;
  decided: number;
  reviews: number;
  holding: number;
  trimmed: number;
  sold: number;
  marks: number;
  badges: BadgeId[];
}

/** First EARLY_REVIEWERS distinct authors of each token, by review id. */
function earlyAuthors(records: readonly ReviewRecord[]): Map<string, { authors: Map<string, number> }> {
  const out = new Map<string, { authors: Map<string, number> }>();
  for (const r of records) {
    const k = r.token.toLowerCase();
    const e = out.get(k) ?? { authors: new Map() };
    if (e.authors.size < EARLY_REVIEWERS && !e.authors.has(r.author.toLowerCase())) e.authors.set(r.author.toLowerCase(), r.id);
    out.set(k, e);
  }
  return out;
}

export function reviewerSummaries(
  world: ReviewWorld,
  data: Pick<ReviewChainData, 'markedBy' | 'posted'>,
  balances: Balances,
  assetOf: (token: Address) => AssetInfo | null,
): Map<string, ReviewerSummary> {
  const marks = new Map<string, number>();
  for (const by of data.markedBy.values()) marks.set(by.toLowerCase(), (marks.get(by.toLowerCase()) ?? 0) + 1);
  const early = earlyAuthors(world.records);
  const authors = new Set([...world.records.map((r) => r.author.toLowerCase()), ...marks.keys()]);
  const out = new Map<string, ReviewerSummary>();
  for (const a of authors) {
    const mine = world.records.filter((r) => r.author.toLowerCase() === a);
    const views = filterReviews(
      world.views.filter((v) => v.author.toLowerCase() === a),
      'all',
    );
    const rep = world.reps.get(a) ?? { kept: 0, decided: 0, rep: null, weight: 0.5 };
    const badges: BadgeId[] = [];
    if (mine.length > 0) badges.push('first-review');
    if ((marks.get(a) ?? 0) > 0) badges.push('truth-keeper');
    const positions = positionsOf(mine, balances, world.now);
    if (positions.some((p) => ((p.soldAt ?? world.now) - p.start) >= HELD_LONG_DAYS * DAY)) badges.push('held-30');
    const isEarly = [...early].some(([token, e]) => {
      const id = e.authors.get(a);
      if (id === undefined) return false;
      const asset = assetOf(token as Address);
      const block = data.posted.get(id)?.block;
      return asset?.kind === 'launch' && asset.graduatedBlock !== null && block !== undefined && asset.graduatedBlock > block;
    });
    if (isEarly) badges.push('early-reviewer');
    out.set(a, {
      address: (mine[0]?.author ?? (a as Address)) as Address,
      rep: rep.rep,
      kept: rep.kept,
      decided: rep.decided,
      reviews: views.length,
      holding: views.filter((v) => v.state.kind === 'holding').length,
      trimmed: views.filter((v) => v.state.kind === 'trimmed').length,
      sold: views.filter((v) => v.state.kind === 'sold').length,
      marks: marks.get(a) ?? 0,
      badges,
    });
  }
  return out;
}

// ------------------------------------------------------------------ feeds and leaderboards

export interface LaunchRank {
  token: Address;
  symbol: string;
  name: string;
  kind: 'stock' | 'launch';
  score: number;
  reviewers: number;
  sold: number;
}

export interface Feeds {
  latest: ReviewView[];
  /** turned SOLD: not yet permanent first, then by when they were marked */
  caught: ReviewView[];
  topLaunches: LaunchRank[];
  topReviewers: ReviewerSummary[];
  truthKeepers: ReviewerSummary[];
  /** for the hero prism: average score of scored tokens (null: none yet) and share of current reviews that are SOLD */
  sentiment: { score: number | null; soldShare: number; reviews: number };
}

export function buildFeeds(
  world: ReviewWorld,
  reviewers: ReadonlyMap<string, ReviewerSummary>,
  balances: Balances,
  limit = 10,
): Feeds {
  const current = filterReviews(world.views, 'all');
  const latest = [...current].sort((a, b) => b.id - a.id).slice(0, limit);
  const caught = current
    .filter((v) => v.state.kind === 'sold')
    .sort((a, b) => {
      const ua = a.status !== 'sold' ? 1 : 0;
      const ub = b.status !== 'sold' ? 1 : 0;
      return ub - ua || (b.soldAt ?? world.now) - (a.soldAt ?? world.now) || b.id - a.id;
    })
    .slice(0, limit);
  const tokens = [...new Map(world.views.map((v) => [v.token.toLowerCase(), v])).values()];
  const topLaunches = rankLaunches(world, tokens, balances).slice(0, limit);
  const ranked = [...reviewers.values()].filter((r) => r.reviews >= MIN_LEADERBOARD_REVIEWS && r.rep !== null);
  const topReviewers = ranked.sort((a, b) => b.rep! - a.rep! || b.decided - a.decided || b.reviews - a.reviews).slice(0, limit);
  const truthKeepers = [...reviewers.values()].filter((r) => r.marks > 0).sort((a, b) => b.marks - a.marks).slice(0, limit);
  const scored = rankLaunches(world, tokens, balances);
  return {
    latest,
    caught,
    topLaunches,
    topReviewers,
    truthKeepers,
    sentiment: {
      score: scored.length ? scored.reduce((s, l) => s + l.score, 0) / scored.length : null,
      soldShare: current.length ? current.filter((v) => v.state.kind === 'sold').length / current.length : 0,
      reviews: current.length,
    },
  };
}

/** Tokens with a score (at least MIN_SCORE_REVIEWERS holding reviewers), best first. */
export function rankLaunches(world: ReviewWorld, tokens: readonly Pick<ReviewView, 'token' | 'symbol' | 'name' | 'kind'>[], balances: Balances): LaunchRank[] {
  const out: LaunchRank[] = [];
  for (const t of tokens) {
    const s = tokenScore(world, t.token, balances);
    if (s.score !== null) out.push({ token: t.token, symbol: t.symbol, name: t.name, kind: t.kind, score: s.score, reviewers: s.reviewers, sold: s.sold });
  }
  return out.sort((a, b) => b.score - a.score || b.reviewers - a.reviewers);
}

/** Days since a unix time, for "sold X days after reviewing" and the like. */
export const daysBetween = (from: number, to: number) => Math.max(0, Math.floor((to - from) / DAY));
