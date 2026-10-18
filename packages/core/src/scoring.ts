/**
 * Scoring for PrismReviews, pure and deterministic (live balances and "now" come in as inputs).
 *
 * - **Runs**: an author's reviews of one token, from a first review until one ends SOLD (updates
 *   continue the run; a new review after a SOLD one starts a new run). Each v2 review stores the
 *   run's `baseline`: the most the author has held since the run began (v1 reviews: their
 *   `heldAtPost`).
 * - **Review status**: holding / trimmed X% / SOLD, from the author's balance against the baseline.
 *   SOLD on-chain is final; below half right now shows SOLD too (not yet marked); so does a run
 *   whose balance went below half at any moment and came back (`soldBack`, from a replay of the
 *   author's transfers: it can't be marked on-chain, because they hold again). Any smaller drop
 *   shows as "trimmed X%".
 * - **True colors**: a token's score, the weighted average rating of reviewers who are still
 *   holding and count (see reviews.ts: listed tokens only, not the creator, at least $1).
 *   Weight = position size × holding time × honesty rep:
 *   - position size: min(balance, baseline). With 10 or more counted reviewers no wallet counts
 *     for more than 10%; with fewer, sizes count as they are (no equal shares: dust can't outweigh
 *     real holders);
 *   - holding time: 0.25 when the current baseline was set, rising linearly to 1 at 7 days (an
 *     update that doesn't raise the baseline keeps the clock; buying more and updating restarts it);
 *   - honesty rep: (kept + 1) / (decided + 2), so a new reviewer counts half and a long honest
 *     record counts fully.
 *   With few reviews the score is pulled toward a neutral 3 (as if PRIOR_REVIEWS neutral reviews
 *   were added), and `confidence` says how much to trust it.
 * - **Honesty rep**: the share of a reviewer's positions (runs) they kept holding for at least 7
 *   days after reviewing. Runs younger than 7 days that are still held are not decided yet.
 */
import type { Address } from 'viem';

export const DAY = 86_400;
export const KEEP_DAYS = 7;
export const WALLET_CAP = 0.1;
/** The cap applies only from this many counted reviewers (below it, 10% each is impossible). */
export const CAP_FROM_REVIEWERS = 10;
export const MIN_TIME_FACTOR = 0.25;
/** Neutral rating and how many neutral reviews a score starts with. */
export const NEUTRAL_RATING = 3;
export const PRIOR_REVIEWS = 2;

export type OnchainStatus = 'active' | 'replaced' | 'sold';

/** A review as stored by PrismReviews (plus its id). */
export interface ReviewRecord {
  id: number;
  author: Address;
  token: Address;
  rating: number;
  /** the author's balance when posting */
  heldAtPost: bigint;
  /** the most held since the run began (v1: heldAtPost) */
  baseline: bigint;
  /** unix seconds */
  postedAt: number;
  status: OnchainStatus;
  /** unix seconds, when marked SOLD on-chain */
  soldAt: number | null;
  /** the review it replaced, 0 = none */
  previous: number;
}

export type ReviewState =
  | { kind: 'holding' }
  | { kind: 'trimmed'; percent: number }
  /**
   * marked: SOLD on-chain (permanent); else below half of the baseline, not marked yet. `boughtBack`:
   * the balance went below half at `at` (unix seconds) and they hold again, so it can't be marked.
   */
  | { kind: 'sold'; marked: boolean; boughtBack?: { at: number } }
  | { kind: 'replaced' };

/** Below half of the baseline (exactly half is still holding), as the contract decides. */
export const isBelowHalf = (balance: bigint, baseline: bigint) => balance < baseline - baseline / 2n;

/**
 * What to show on a review, from the author's live balance of the token (and, for the run's
 * current review, a replay that found a dip below half).
 */
export function reviewState(r: Pick<ReviewRecord, 'status' | 'baseline'>, balance: bigint | null, soldBack: { at: number } | null = null): ReviewState {
  if (r.status === 'sold') return { kind: 'sold', marked: true };
  if (r.status === 'replaced') return { kind: 'replaced' };
  if (balance === null || r.baseline === 0n) return { kind: 'holding' }; // unknown balance: don't accuse
  if (isBelowHalf(balance, r.baseline)) return { kind: 'sold', marked: false };
  if (soldBack) return { kind: 'sold', marked: false, boughtBack: soldBack };
  if (balance >= r.baseline) return { kind: 'holding' };
  // whole percent dropped, never shown as 0 for a real drop
  const percent = Math.max(1, Math.round(Number(((r.baseline - balance) * 1000n) / r.baseline) / 10));
  return { kind: 'trimmed', percent };
}

export const stateLabel = (s: ReviewState) =>
  s.kind === 'holding' ? 'Holding' : s.kind === 'trimmed' ? `Trimmed ${s.percent}%` : s.kind === 'sold' ? 'SOLD' : 'Replaced';

/** Live balances by `${author}:${token}` (lower case). */
export type Balances = ReadonlyMap<string, bigint | null>;
export const balanceKey = (author: string, token: string) => `${author.toLowerCase()}:${token.toLowerCase()}`;
const balanceOf = (b: Balances, r: Pick<ReviewRecord, 'author' | 'token'>) => b.get(balanceKey(r.author, r.token)) ?? null;

/** Runs whose balance went below half and came back, by the id of the run's current review. */
export type SoldBack = ReadonlyMap<number, { at: number }>;

// ------------------------------------------------------------------ runs

export interface Run {
  author: Address;
  token: Address;
  /** oldest first */
  reviews: ReviewRecord[];
  /** when the run began (its first review) */
  start: number;
  /** when its current baseline was set: the first review, or the last update that raised it */
  baselineSince: number;
}

/** An author's reviews split into runs (a SOLD review ends one; the next review starts a new one). */
export function runsOf(reviews: readonly ReviewRecord[]): Run[] {
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const replacedBy = new Set(reviews.map((r) => r.previous).filter((p) => p !== 0));
  const out: Run[] = [];
  for (const last of reviews.filter((r) => !replacedBy.has(r.id))) {
    const chain: ReviewRecord[] = [];
    for (let r: ReviewRecord | undefined = last; r; r = r.previous ? byId.get(r.previous) : undefined) chain.unshift(r);
    let run: Run | null = null;
    for (const r of chain) {
      if (!run) run = { author: r.author, token: r.token, reviews: [], start: r.postedAt, baselineSince: r.postedAt };
      else if (r.baseline > run.reviews.at(-1)!.baseline) run.baselineSince = r.postedAt;
      run.reviews.push(r);
      if (r.status === 'sold') {
        out.push(run);
        run = null;
      }
    }
    if (run) out.push(run);
  }
  return out;
}

/** The run's state now (its current review against the live balance, and any replayed dip). */
export function runState(run: Run, balances: Balances, soldBack: SoldBack = new Map()): ReviewState {
  const last = run.reviews.at(-1)!;
  return reviewState(last, balanceOf(balances, last), soldBack.get(last.id) ?? null);
}

/** When a run ended in a sale (marked on-chain, a replayed dip, or below half now), else null. */
export function runSoldAt(run: Run, balances: Balances, now: number, soldBack: SoldBack = new Map()): number | null {
  const last = run.reviews.at(-1)!;
  if (last.status === 'sold') return last.soldAt ?? now;
  const s = runState(run, balances, soldBack);
  if (s.kind !== 'sold') return null;
  return s.boughtBack ? s.boughtBack.at : now;
}

// ------------------------------------------------------------------ honesty rep

export interface Position {
  author: Address;
  token: Address;
  start: number;
  /** when it ended in a sale (marked, replayed or seen below half now), else null */
  soldAt: number | null;
  /** true: kept ≥ 7 days; false: sold within 7 days; null: still held, younger than 7 days */
  kept: boolean | null;
}

/** An author's positions: each run of reviews of one token until it ends in a sale. */
export function positionsOf(reviews: readonly ReviewRecord[], balances: Balances, now: number, soldBack: SoldBack = new Map()): Position[] {
  return runsOf(reviews).map((run) => {
    const soldAt = runSoldAt(run, balances, now, soldBack);
    const kept = soldAt !== null ? soldAt - run.start >= KEEP_DAYS * DAY : now - run.start >= KEEP_DAYS * DAY ? true : null;
    return { author: run.author, token: run.token, start: run.start, soldAt, kept };
  });
}

export interface HonestyRep {
  kept: number;
  decided: number;
  /** kept / decided, or null with nothing decided yet */
  rep: number | null;
  /** (kept + 1) / (decided + 2): 0.5 for someone new, toward 1 for a long honest record */
  weight: number;
}

export const NEW_REP: HonestyRep = { kept: 0, decided: 0, rep: null, weight: 0.5 };

/** Honesty rep from one author's counted reviews (any tokens). */
export function honestyRep(authorReviews: readonly ReviewRecord[], balances: Balances, now: number, soldBack: SoldBack = new Map()): HonestyRep {
  const decided = positionsOf(authorReviews, balances, now, soldBack).filter((p) => p.kept !== null);
  const kept = decided.filter((p) => p.kept).length;
  return { kept, decided: decided.length, rep: decided.length ? kept / decided.length : null, weight: (kept + 1) / (decided.length + 2) };
}

// ------------------------------------------------------------------ true colors

/** Holding time factor: MIN_TIME_FACTOR when the baseline was set, 1 from 7 days later. */
export function timeFactor(heldSeconds: number): number {
  const t = Math.min(1, Math.max(0, heldSeconds) / (KEEP_DAYS * DAY));
  return MIN_TIME_FACTOR + (1 - MIN_TIME_FACTOR) * t;
}

/**
 * Shares in proportion to `values`, none above `cap` of the total (water-filling: the excess is
 * shared by the rest in proportion). The cap only applies with at least 1/cap values; with fewer
 * it can't be met, and the values are used as they are.
 */
export function capShares(values: readonly number[], cap = WALLET_CAP): number[] {
  const n = values.length;
  if (n === 0) return [];
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 1 / n);
  const shares = values.map((v) => Math.max(0, v) / total);
  if (n * cap < 1 - 1e-12) return shares;
  const capped = new Set<number>();
  for (;;) {
    const over = shares.findIndex((s, i) => !capped.has(i) && s > cap + 1e-12);
    if (over === -1) break;
    for (let i = 0; i < n; i++) if (!capped.has(i) && shares[i]! > cap) capped.add(i);
    const free = 1 - capped.size * cap;
    const rest = values.reduce((s, v, i) => (capped.has(i) ? s : s + Math.max(0, v)), 0);
    for (let i = 0; i < n; i++) shares[i] = capped.has(i) ? cap : rest > 0 ? (Math.max(0, values[i]!) / rest) * free : free / (n - capped.size);
  }
  return shares;
}

export interface Contribution {
  review: ReviewRecord;
  state: ReviewState;
  /** share of the score (0..1), after the cap, time and rep */
  weight: number;
}

export interface TrueColors {
  /** null until someone still holding has reviewed it */
  score: number | null;
  /** the weighted average before pulling toward neutral */
  average: number | null;
  /** current reviewers still holding (counted) */
  reviewers: number;
  /** current reviews marked or seen SOLD (not counted) */
  sold: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
  counted: Contribution[];
}

/**
 * A token's true colors score. `reviews`: the token's counted reviews (every review of its counted
 * runs); `repOf(author)`: that author's honesty rep (see honestyRep).
 */
export function trueColors(
  reviews: readonly ReviewRecord[],
  balances: Balances,
  now: number,
  repOf: (author: Address) => HonestyRep,
  soldBack: SoldBack = new Map(),
): TrueColors {
  const byAuthor = new Map<string, ReviewRecord[]>();
  for (const r of reviews) byAuthor.set(r.author.toLowerCase(), [...(byAuthor.get(r.author.toLowerCase()) ?? []), r]);
  // each author once: their current run (the one ending in their latest review)
  const current = [...byAuthor.values()].map((rs) => runsOf(rs).reduce((a, b) => (b.reviews.at(-1)!.id > a.reviews.at(-1)!.id ? b : a)));
  const states = current.map((run) => ({ run, r: run.reviews.at(-1)!, s: runState(run, balances, soldBack) }));
  const holding = states.filter(({ s }) => s.kind === 'holding' || s.kind === 'trimmed');
  const sold = states.length - holding.length;
  if (holding.length === 0) return { score: null, average: null, reviewers: 0, sold, confidence: 'none', counted: [] };

  // position size: what they still hold, up to the baseline
  const size = holding.map(({ r }) => {
    const b = balanceOf(balances, r);
    return Number(b === null || b > r.baseline ? r.baseline : b);
  });
  const shares = holding.length >= CAP_FROM_REVIEWERS ? capShares(size) : capShares(size, 1);
  const raw = holding.map(({ run, r }, i) => shares[i]! * timeFactor(now - run.baselineSince) * repOf(r.author).weight);
  const sum = raw.reduce((s, w) => s + w, 0);
  const weights = raw.map((w) => (sum > 0 ? w / sum : 1 / raw.length));
  const average = holding.reduce((s, { r }, i) => s + r.rating * weights[i]!, 0);
  const n = holding.length;
  const score = (average * n + NEUTRAL_RATING * PRIOR_REVIEWS) / (n + PRIOR_REVIEWS);
  return {
    score,
    average,
    reviewers: n,
    sold,
    confidence: n < 3 ? 'low' : n < 10 ? 'medium' : 'high',
    counted: holding.map(({ r, s }, i) => ({ review: r, state: s, weight: weights[i]! })),
  };
}

// ------------------------------------------------------------------ the honesty leaderboard

/** Decided positions before someone appears on the honesty leaderboard. */
export const MIN_DECIDED_FOR_LEADERBOARD = 3;

/** The honesty leaderboard's order: (kept + 1) / (decided + 2), so 1 of 1 doesn't top 9 of 10. */
export const leaderboardRank = (rep: Pick<HonestyRep, 'kept' | 'decided'>) => (rep.kept + 1) / (rep.decided + 2);
