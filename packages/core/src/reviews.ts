/**
 * Everything PRISM shows about reviews, computed from the chain: PrismReviews' stored reviews
 * (getReview), their text (ReviewPosted events), who made sales permanent (markSold callers), live
 * balances, token supplies and prices. Pure: ./reviewsChain.ts and the server do the reads. JSON-safe
 * output (bigints as decimal strings) so the server can send it as is.
 *
 * What counts. Every review shows, but only some count toward scores, honesty rep, badges,
 * leaderboards, truth keeper marks and the gem. A run of reviews (see scoring.ts) counts unless:
 * - retired: it was posted on PRISM's first contract (history only, its live status by the old rules);
 * - unlisted: its token isn't a test stock or an indexed vibe/vibe launch (those reviews don't appear
 *   at all, except on their own /r/ page);
 * - creator: its author created the launch (labelled "Creator");
 * - small: the position is worth less than $1 at the current price (or, unpriced, less than a
 *   millionth of the supply): min(balance, baseline) while holding, the baseline once sold.
 */
import type { Address, Hex } from 'viem';
import {
  DAY,
  NEW_REP,
  balanceKey,
  honestyRep,
  leaderboardRank,
  MIN_DECIDED_FOR_LEADERBOARD,
  reviewState,
  runSoldAt,
  runsOf,
  trueColors,
  type Balances,
  type HonestyRep,
  type OnchainStatus,
  type ReviewRecord,
  type ReviewState,
  type Run,
  type SoldBack,
  type TrueColors,
} from './scoring';
import { gemFacets, type GemFacet } from './gem';
import { cleanShown } from './text';

/** Minimum holding reviewers before a token shows a true colors score. */
export const MIN_SCORE_REVIEWERS = 3;
/** @deprecated the honesty leaderboard now needs MIN_DECIDED_FOR_LEADERBOARD decided positions */
export const MIN_LEADERBOARD_REVIEWS = MIN_DECIDED_FOR_LEADERBOARD;
export const HELD_LONG_DAYS = 30;
export const EARLY_REVIEWERS = 10;

/** What PrismReviews.getReview returns (status as its enum number). v1 had no baseline: its heldAtPost. */
export interface StoredReview {
  author: Address;
  rating: number;
  status: number;
  postedAt: number;
  soldAt: number;
  token: Address;
  previous: number;
  heldAtPost: bigint;
  baseline: bigint;
}

export interface ReviewChainData {
  /** id → stored review */
  stored: ReadonlyMap<number, StoredReview>;
  /** id → text, and where its ReviewPosted event is (block, log index, transaction) */
  posted: ReadonlyMap<number, { text: string; block: number; logIndex: number; txHash: Hex }>;
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
  /** launches only: who launched it (from its launch event) */
  creator: Address | null;
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
      baseline: s.baseline,
      postedAt: s.postedAt,
      status,
      soldAt: s.soldAt > 0 ? s.soldAt : null,
      previous: s.previous,
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

// ------------------------------------------------------------------ views

/** Why a review doesn't count (null: it counts). */
export type Excluded = 'retired' | 'unlisted' | 'creator' | 'small' | null;

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
  /** the most held since the run began (what SOLD is measured from) */
  baseline: string;
  balance: string | null;
  decimals: number;
  /** what they hold now (or held, once sold) as a share of supply, 0..1 */
  supplyShare: number | null;
  postedAt: number;
  soldAt: number | null;
  status: OnchainStatus;
  state: ReviewState;
  /** sold: days between the run's start and the sale; else days held since the run began */
  days: number;
  previous: number;
  replacedBy: number | null;
  /** the author's honesty rep (null: nothing decided yet) */
  rep: number | null;
  block: number | null;
  txHash: Hex | null;
  /** posted on PRISM's first contract: history only */
  retired: boolean;
  /** the token is a test stock or an indexed vibe/vibe launch */
  listed: boolean;
  /** the author created this launch */
  creator: boolean;
  /** why it doesn't count, or null */
  excluded: Excluded;
  /** the smallest position that counts (base units), when known */
  floor: string | null;
}

export interface Supply {
  supply: bigint;
  decimals: number;
}

export interface ReviewWorld {
  now: number;
  /** every review on the current contract */
  records: ReviewRecord[];
  /** the reviews of counted runs (scores, rep, badges, leaderboards use only these) */
  counted: ReviewRecord[];
  /** every review shown anywhere (current and retired), by id */
  views: ReviewView[];
  byId: Map<number, ReviewView>;
  /** honesty rep by lower-case author, from counted runs */
  reps: Map<string, HonestyRep>;
  soldBack: SoldBack;
}

export interface WorldInput {
  /** the current contract */
  data: ReviewChainData;
  /** PRISM's first contract: shown as history, never counted */
  retired?: ReviewChainData | null;
  balances: Balances;
  supplies: ReadonlyMap<string, Supply | null>;
  assetOf: (token: Address) => AssetInfo | null;
  /** the smallest position that counts for a token, in base units (null: no floor known) */
  floorOf?: (token: Address) => bigint | null;
  /** current-contract runs whose balance went below half and came back, by the run's current review */
  soldBack?: SoldBack;
  now: number;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Why a run doesn't count, or null when it does. */
export function runExclusion(run: Run, input: Pick<WorldInput, 'assetOf' | 'floorOf' | 'balances' | 'soldBack' | 'now'>): Excluded {
  const asset = input.assetOf(run.token);
  if (!asset) return 'unlisted';
  if (same(asset.creator, run.author)) return 'creator';
  const floor = input.floorOf?.(run.token) ?? null;
  if (floor !== null && floor > 0n) {
    const last = run.reviews.at(-1)!;
    const balance = input.balances.get(balanceKey(last.author, last.token)) ?? null;
    const sold = runSoldAt(run, input.balances, input.now, input.soldBack) !== null;
    // once sold, the position is what they held (else selling would make every seller "too small")
    const size = sold || balance === null || balance > last.baseline ? last.baseline : balance;
    if (size < floor) return 'small';
  }
  return null;
}

/** Every review as the app shows it, which ones count, and each author's honesty rep. */
export function buildWorld(input: WorldInput): ReviewWorld {
  const { data, balances, supplies, assetOf, now } = input;
  const soldBack = input.soldBack ?? new Map();
  const records = toRecords(data);

  // runs, and whether each counts
  const byAuthor = new Map<string, ReviewRecord[]>();
  for (const r of records) byAuthor.set(r.author.toLowerCase(), [...(byAuthor.get(r.author.toLowerCase()) ?? []), r]);
  const runOf = new Map<number, Run>();
  const excludedOf = new Map<number, Excluded>();
  for (const rs of byAuthor.values()) {
    // runs per token (runsOf follows `previous`, which never crosses tokens)
    for (const run of runsOf(rs)) {
      const why = runExclusion(run, { ...input, soldBack });
      for (const r of run.reviews) {
        runOf.set(r.id, run);
        excludedOf.set(r.id, why);
      }
    }
  }
  const counted = records.filter((r) => excludedOf.get(r.id) === null);
  const countedByAuthor = new Map<string, ReviewRecord[]>();
  for (const r of counted) countedByAuthor.set(r.author.toLowerCase(), [...(countedByAuthor.get(r.author.toLowerCase()) ?? []), r]);
  const reps = new Map([...countedByAuthor].map(([a, rs]) => [a, honestyRep(rs, balances, now, soldBack)]));

  const views: ReviewView[] = [];
  const view = (r: ReviewRecord, chain: ReviewChainData, opts: { retired: boolean; run: Run | null; excluded: Excluded; replacedBy: Map<number, number> }): ReviewView => {
    const balance = balances.get(balanceKey(r.author, r.token)) ?? null;
    const isCurrent = opts.run ? opts.run.reviews.at(-1)!.id === r.id : true;
    const state = reviewState(r, r.status === 'active' ? balance : null, r.status === 'active' && isCurrent && !opts.retired ? (soldBack.get(r.id) ?? null) : null);
    const asset = assetOf(r.token);
    const supply = supplies.get(r.token.toLowerCase()) ?? null;
    const sold = state.kind === 'sold';
    const held = sold || r.status === 'replaced' || balance === null ? r.baseline : balance < r.baseline ? balance : r.baseline;
    const start = opts.run?.start ?? r.postedAt;
    const until = r.status === 'sold' && r.soldAt ? r.soldAt : state.kind === 'sold' && state.boughtBack ? state.boughtBack.at : now;
    const post = chain.posted.get(r.id);
    const floor = input.floorOf?.(r.token) ?? null;
    return {
      id: r.id,
      author: r.author,
      token: r.token,
      symbol: cleanShown(asset?.symbol ?? `${r.token.slice(0, 6)}…`),
      name: cleanShown(asset?.name ?? 'Unknown token'),
      kind: asset?.kind ?? 'launch',
      rating: r.rating,
      text: cleanShown(post?.text ?? ''),
      heldAtPost: r.heldAtPost.toString(),
      baseline: r.baseline.toString(),
      balance: balance === null ? null : balance.toString(),
      decimals: supply?.decimals ?? 18,
      supplyShare: supply && supply.supply > 0n ? Number((held * 1_000_000n) / supply.supply) / 1_000_000 : null,
      postedAt: r.postedAt,
      soldAt: r.soldAt,
      status: r.status,
      state,
      days: Math.max(0, Math.floor((until - start) / DAY)),
      previous: r.previous,
      replacedBy: opts.replacedBy.get(r.id) ?? null,
      rep: opts.retired ? null : (reps.get(r.author.toLowerCase())?.rep ?? null),
      block: post?.block ?? null,
      txHash: post?.txHash ?? null,
      retired: opts.retired,
      listed: !!asset,
      creator: same(asset?.creator, r.author),
      excluded: opts.excluded,
      floor: floor === null ? null : floor.toString(),
    };
  };

  const replacedBy = new Map(records.filter((r) => r.previous).map((r) => [r.previous, r.id]));
  for (const r of records) views.push(view(r, data, { retired: false, run: runOf.get(r.id) ?? null, excluded: excludedOf.get(r.id) ?? null, replacedBy }));
  if (input.retired) {
    const old = toRecords(input.retired);
    const oldReplacedBy = new Map(old.filter((r) => r.previous).map((r) => [r.previous, r.id]));
    const oldRuns = new Map<number, Run>();
    for (const run of runsOf(old)) for (const r of run.reviews) oldRuns.set(r.id, run);
    for (const r of old) views.push(view(r, input.retired, { retired: true, run: oldRuns.get(r.id) ?? null, excluded: 'retired', replacedBy: oldReplacedBy }));
  }
  views.sort((a, b) => a.id - b.id);
  return { now, records, counted, views, byId: new Map(views.map((v) => [v.id, v])), reps, soldBack };
}

export const filterKinds = ['holding', 'trimmed', 'sold', 'all'] as const;
export type ReviewFilter = (typeof filterKinds)[number];

/** Current reviews (not replaced) matching a filter; SOLD ones stay in "sold" and "all". */
export function filterReviews(views: readonly ReviewView[], filter: ReviewFilter): ReviewView[] {
  const current = views.filter((v) => v.status !== 'replaced');
  if (filter === 'all') return current;
  return current.filter((v) => v.state.kind === filter);
}

/** Reviews that appear in lists: listed tokens only (retired ones too, as history). */
export const shownReviews = (views: readonly ReviewView[]) => views.filter((v) => v.listed);

export interface ScoreSummary {
  /** null until MIN_SCORE_REVIEWERS holders still holding have reviewed it */
  score: number | null;
  reviewers: number;
  sold: number;
  confidence: TrueColors['confidence'];
  /** current reviews shown on the token's page (counted or not, retired ones excluded) */
  total: number;
}

/** A token's true colors, from counted reviews only, hidden below MIN_SCORE_REVIEWERS holding reviewers. */
export function tokenScore(world: ReviewWorld, token: Address, balances: Balances): ScoreSummary {
  const k = token.toLowerCase();
  const records = world.counted.filter((r) => r.token.toLowerCase() === k);
  const t = trueColors(records, balances, world.now, (a) => world.reps.get(a.toLowerCase()) ?? NEW_REP, world.soldBack);
  return {
    score: t.reviewers >= MIN_SCORE_REVIEWERS ? t.score : null,
    reviewers: t.reviewers,
    sold: t.sold,
    confidence: t.confidence,
    total: world.views.filter((v) => v.token.toLowerCase() === k && !v.retired && v.status !== 'replaced').length,
  };
}

// ------------------------------------------------------------------ reviewers and badges

export type BadgeId = 'first-review' | 'truth-keeper' | 'held-30' | 'early-reviewer';

export const BADGES: Record<BadgeId, { title: string; how: string }> = {
  'first-review': { title: 'First review', how: 'Posted a review that counts' },
  'truth-keeper': { title: 'Truth keeper', how: 'Made someone else’s sale permanent with “Make it permanent”' },
  'held-30': { title: 'Held 30 days', how: 'Kept holding at least 30 days after reviewing' },
  'early-reviewer': { title: 'Early reviewer', how: 'One of the first 10 reviewers of a launch that later graduated' },
};

export interface ReviewerSummary {
  address: Address;
  rep: number | null;
  kept: number;
  decided: number;
  /** current reviews of listed tokens on the current contract (counted or not) */
  reviews: number;
  holding: number;
  trimmed: number;
  sold: number;
  /** sales they made permanent that count (not their own, listed tokens, at least the floor) */
  marks: number;
  badges: BadgeId[];
}

/** First EARLY_REVIEWERS distinct authors of each token among counted reviews, by review id. */
function earlyAuthors(records: readonly ReviewRecord[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of records) {
    const k = r.token.toLowerCase();
    const e = out.get(k) ?? new Map<string, number>();
    if (e.size < EARLY_REVIEWERS && !e.has(r.author.toLowerCase())) e.set(r.author.toLowerCase(), r.id);
    out.set(k, e);
  }
  return out;
}

/** Marks that count: on counted reviews of someone else. */
export function countedMarks(world: ReviewWorld, markedBy: ReadonlyMap<number, Address>): Map<string, number> {
  const counted = new Set(world.counted.map((r) => r.id));
  const marks = new Map<string, number>();
  for (const [id, by] of markedBy) {
    const r = world.byId.get(id);
    if (!r || !counted.has(id) || same(r.author, by)) continue;
    marks.set(by.toLowerCase(), (marks.get(by.toLowerCase()) ?? 0) + 1);
  }
  return marks;
}

export function reviewerSummaries(
  world: ReviewWorld,
  data: Pick<ReviewChainData, 'markedBy' | 'posted'>,
  balances: Balances,
  assetOf: (token: Address) => AssetInfo | null,
): Map<string, ReviewerSummary> {
  const marks = countedMarks(world, data.markedBy);
  const early = earlyAuthors(world.counted);
  const shown = world.views.filter((v) => v.listed && !v.retired);
  const authors = new Set([...shown.map((v) => v.author.toLowerCase()), ...marks.keys()]);
  const out = new Map<string, ReviewerSummary>();
  for (const a of authors) {
    const mine = world.counted.filter((r) => r.author.toLowerCase() === a);
    const views = filterReviews(
      shown.filter((v) => v.author.toLowerCase() === a),
      'all',
    );
    const rep = world.reps.get(a) ?? NEW_REP;
    const badges: BadgeId[] = [];
    if (mine.length > 0) badges.push('first-review');
    if ((marks.get(a) ?? 0) > 0) badges.push('truth-keeper');
    if (runsOf(mine).some((run) => (runSoldAt(run, balances, world.now, world.soldBack) ?? world.now) - run.start >= HELD_LONG_DAYS * DAY)) badges.push('held-30');
    const isEarly = [...early].some(([token, authorsOf]) => {
      const id = authorsOf.get(a);
      if (id === undefined) return false;
      const asset = assetOf(token as Address);
      const block = data.posted.get(id)?.block;
      return asset?.kind === 'launch' && asset.graduatedBlock !== null && block !== undefined && asset.graduatedBlock > block;
    });
    if (isEarly) badges.push('early-reviewer');
    out.set(a, {
      address: (views[0]?.author ?? mine[0]?.author ?? (a as Address)) as Address,
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
  /** for the hero's living gem: the latest counted reviews, one facet each */
  gem: GemFacet[];
}

/** Reviewers on the honesty leaderboard: enough decided positions, best smoothed rep first. */
export function rankReviewers(reviewers: Iterable<ReviewerSummary>): ReviewerSummary[] {
  return [...reviewers]
    .filter((r) => r.decided >= MIN_DECIDED_FOR_LEADERBOARD)
    .sort((a, b) => leaderboardRank(b) - leaderboardRank(a) || b.decided - a.decided || b.reviews - a.reviews);
}

export function buildFeeds(world: ReviewWorld, reviewers: ReadonlyMap<string, ReviewerSummary>, balances: Balances, limit = 10): Feeds {
  // lists show reviews of listed tokens on the current contract (creator and small ones labelled)
  const current = filterReviews(
    world.views.filter((v) => v.listed && !v.retired),
    'all',
  );
  // "latest" also shows the first contract's reviews, tagged Retired: they are PRISM's own history,
  // and an empty home page is worse than showing them clearly labelled. Nothing else here includes them.
  const latest = filterReviews(
    world.views.filter((v) => v.listed),
    'all',
  )
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
  const caught = current
    .filter((v) => v.state.kind === 'sold' && v.excluded !== 'small')
    .sort((a, b) => {
      const ua = a.status !== 'sold' ? 1 : 0;
      const ub = b.status !== 'sold' ? 1 : 0;
      const at = (v: ReviewView) => v.soldAt ?? (v.state.kind === 'sold' && v.state.boughtBack ? v.state.boughtBack.at : world.now);
      return ub - ua || at(b) - at(a) || b.id - a.id;
    })
    .slice(0, limit);
  const tokens = [...new Map(world.counted.map((r) => [r.token.toLowerCase(), world.byId.get(r.id)!])).values()];
  const topLaunches = rankLaunches(world, tokens, balances).slice(0, limit);
  const topReviewers = rankReviewers(reviewers.values()).slice(0, limit);
  const truthKeepers = [...reviewers.values()].filter((r) => r.marks > 0).sort((a, b) => b.marks - a.marks).slice(0, limit);
  return { latest, caught, topLaunches, topReviewers, truthKeepers, gem: gemFacets(current.filter((v) => v.excluded === null)) };
}

/** Tokens with a score (at least MIN_SCORE_REVIEWERS counted holding reviewers), best first. */
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
