/**
 * Scoring for PrismReviews, pure and deterministic (live balances and "now" come in as inputs).
 *
 * - **Review status**: holding / trimmed X% / SOLD, from the author's live balance against what
 *   they held when posting (`heldAtPost`). SOLD on-chain is final; below half live shows SOLD too
 *   (not yet marked); any smaller drop shows as "trimmed X%".
 * - **True colors**: a token's score, the weighted average rating of reviewers who are still
 *   holding (current reviews only; SOLD ones don't count). Weight = position size × holding time ×
 *   honesty rep:
 *   - position size: what they still hold of what they reviewed (min(balance, heldAtPost)), as a
 *     share of all counted positions, capped so nobody counts more than 10% (with fewer than 10
 *     reviewers that cap would be impossible, so it becomes an equal share: 1/n);
 *   - holding time: 0.25 on the day of posting, rising linearly to 1 at 7 days held;
 *   - honesty rep: (kept + 1) / (decided + 2), so a new reviewer counts half and a long honest
 *     record counts fully.
 *   With few reviews the score is pulled toward a neutral 3 (as if PRIOR_REVIEWS neutral reviews
 *   were added), and `confidence` says how much to trust it.
 * - **Honesty rep**: the share of a reviewer's positions they kept holding for at least 7 days after
 *   reviewing. A position is the run of reviews of one token from a first post until it is SOLD
 *   (updates continue it; a new review after a sale starts a new one). Positions younger than 7
 *   days that are still held are not decided yet.
 */
import type { Address } from 'viem';

export const DAY = 86_400;
export const KEEP_DAYS = 7;
export const WALLET_CAP = 0.1;
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
  heldAtPost: bigint;
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
  /** marked: SOLD on-chain (permanent); else below half right now, not marked yet */
  | { kind: 'sold'; marked: boolean }
  | { kind: 'replaced' };

/** Below half of what was held when posting (exactly half is still holding), as the contract decides. */
export const isBelowHalf = (balance: bigint, held: bigint) => balance < held - held / 2n;

/** What to show on a review, from the author's live balance of the token. */
export function reviewState(r: Pick<ReviewRecord, 'status' | 'heldAtPost'>, balance: bigint | null): ReviewState {
  if (r.status === 'sold') return { kind: 'sold', marked: true };
  if (r.status === 'replaced') return { kind: 'replaced' };
  if (balance === null || r.heldAtPost === 0n) return { kind: 'holding' }; // unknown balance: don't accuse
  if (isBelowHalf(balance, r.heldAtPost)) return { kind: 'sold', marked: false };
  if (balance >= r.heldAtPost) return { kind: 'holding' };
  // whole percent dropped, never shown as 0 for a real drop
  const percent = Math.max(1, Number(((r.heldAtPost - balance) * 100n) / r.heldAtPost));
  return { kind: 'trimmed', percent };
}

export const stateLabel = (s: ReviewState) =>
  s.kind === 'holding' ? 'Holding' : s.kind === 'trimmed' ? `Trimmed ${s.percent}%` : s.kind === 'sold' ? 'SOLD' : 'Replaced';

/** Live balances by `${author}:${token}` (lower case). */
export type Balances = ReadonlyMap<string, bigint | null>;
export const balanceKey = (author: string, token: string) => `${author.toLowerCase()}:${token.toLowerCase()}`;
const balanceOf = (b: Balances, r: Pick<ReviewRecord, 'author' | 'token'>) => b.get(balanceKey(r.author, r.token)) ?? null;

// ------------------------------------------------------------------ honesty rep

export interface Position {
  author: Address;
  token: Address;
  start: number;
  /** when it ended in a sale (marked on-chain, or seen below half now), else null */
  soldAt: number | null;
  /** true: kept ≥ 7 days; false: sold within 7 days; null: still held, younger than 7 days */
  kept: boolean | null;
}

/** An author's positions: each run of reviews of one token until it ends in a sale. */
export function positionsOf(reviews: readonly ReviewRecord[], balances: Balances, now: number): Position[] {
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const replacedBy = new Set(reviews.map((r) => r.previous).filter((p) => p !== 0));
  const out: Position[] = [];
  // walk back from each chain's latest review, splitting the chain at every sale
  for (const last of reviews.filter((r) => !replacedBy.has(r.id))) {
    const chain: ReviewRecord[] = [];
    for (let r: ReviewRecord | undefined = last; r; r = r.previous ? byId.get(r.previous) : undefined) chain.unshift(r);
    let start: number | null = null;
    for (const r of chain) {
      start ??= r.postedAt;
      const live = r === last ? reviewState(r, balanceOf(balances, r)) : null;
      const soldAt = r.status === 'sold' ? (r.soldAt ?? now) : live?.kind === 'sold' ? now : null;
      if (soldAt !== null) {
        out.push({ author: r.author, token: r.token, start, soldAt, kept: soldAt - start >= KEEP_DAYS * DAY });
        start = null;
      }
    }
    if (start !== null) out.push({ author: last.author, token: last.token, start, soldAt: null, kept: now - start >= KEEP_DAYS * DAY ? true : null });
  }
  return out;
}

export interface HonestyRep {
  kept: number;
  decided: number;
  /** kept / decided, or null with nothing decided yet */
  rep: number | null;
  /** (kept + 1) / (decided + 2): 0.5 for someone new, toward 1 for a long honest record */
  weight: number;
}

/** Honesty rep from all of one author's reviews (any tokens). */
export function honestyRep(authorReviews: readonly ReviewRecord[], balances: Balances, now: number): HonestyRep {
  const decided = positionsOf(authorReviews, balances, now).filter((p) => p.kept !== null);
  const kept = decided.filter((p) => p.kept).length;
  return { kept, decided: decided.length, rep: decided.length ? kept / decided.length : null, weight: (kept + 1) / (decided.length + 2) };
}

// ------------------------------------------------------------------ true colors

/** Holding time factor: MIN_TIME_FACTOR on the day of posting, 1 from 7 days held. */
export function timeFactor(heldSeconds: number): number {
  const t = Math.min(1, Math.max(0, heldSeconds) / (KEEP_DAYS * DAY));
  return MIN_TIME_FACTOR + (1 - MIN_TIME_FACTOR) * t;
}

/**
 * Cap shares so none is above `cap` of the total (water-filling: the excess is shared by the
 * rest in proportion). With fewer than 1/cap entries the cap becomes 1/n (equal shares).
 */
export function capShares(values: readonly number[], cap = WALLET_CAP): number[] {
  const n = values.length;
  if (n === 0) return [];
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 1 / n);
  const limit = Math.max(cap, 1 / n);
  const shares = values.map((v) => Math.max(0, v) / total);
  const capped = new Set<number>();
  for (;;) {
    const over = shares.findIndex((s, i) => !capped.has(i) && s > limit + 1e-12);
    if (over === -1) break;
    for (let i = 0; i < n; i++) if (!capped.has(i) && shares[i]! > limit) capped.add(i);
    const free = 1 - capped.size * limit;
    const rest = values.reduce((s, v, i) => (capped.has(i) ? s : s + Math.max(0, v)), 0);
    for (let i = 0; i < n; i++) shares[i] = capped.has(i) ? limit : rest > 0 ? (Math.max(0, values[i]!) / rest) * free : free / (n - capped.size);
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
 * A token's true colors score. `reviews`: every review of the token; `repOf(author)`: that
 * author's honesty rep (from all their reviews: see honestyRep).
 */
export function trueColors(reviews: readonly ReviewRecord[], balances: Balances, now: number, repOf: (author: Address) => HonestyRep): TrueColors {
  const current = reviews.filter((r) => r.status !== 'replaced');
  const states = current.map((r) => ({ r, s: reviewState(r, balanceOf(balances, r)) }));
  const holding = states.filter(({ s }) => s.kind === 'holding' || s.kind === 'trimmed');
  const sold = states.length - holding.length;
  if (holding.length === 0) return { score: null, average: null, reviewers: 0, sold, confidence: 'none', counted: [] };

  // position size: what they still hold of what they reviewed
  const size = holding.map(({ r }) => {
    const b = balanceOf(balances, r);
    const held = b === null || b > r.heldAtPost ? r.heldAtPost : b;
    return Number(held);
  });
  const shares = capShares(size);
  const raw = holding.map(({ r }, i) => shares[i]! * timeFactor(now - r.postedAt) * repOf(r.author).weight);
  const sum = raw.reduce((s, w) => s + w, 0);
  const weights = raw.map((w) => w / sum);
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
