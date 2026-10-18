/**
 * "Sold below half and bought back": a reviewer can dump below half of their baseline and buy back
 * before anyone calls markSold, and the review would read Holding again. The app replays the
 * author's Transfer events for the token across the whole run (from its first review), against the
 * baseline in force at each moment, and treats a dip below half as SOLD at that moment. It can't be
 * made permanent on-chain (markSold only sees today's balance, and they hold again).
 *
 * The replay must agree with the chain to accuse anyone: starting from the balance the first review
 * recorded, it has to arrive at each later review's recorded balance and at the live balance.
 * Tokens whose balances change without Transfer events (rebasing, reflections, some fee-on-transfer
 * designs) fail that check, and the app falls back to the live rule. Pure; the server reads the logs.
 */
import { isBelowHalf } from './scoring';

/** Where something happened in the chain: transfers and review posts are ordered by this. */
export interface ChainPosition {
  block: number;
  logIndex: number;
}

/** One Transfer log as it moves the author's balance (negative out, positive in). */
export interface BalanceMove extends ChainPosition {
  delta: bigint;
}

/** A review of the run, where it was posted, with what it recorded. */
export interface ReplayReview extends ChainPosition {
  heldAtPost: bigint;
  baseline: bigint;
}

export type ReplayResult =
  /** the balance never went below half of the baseline in force */
  | { kind: 'clean' }
  /** it went below half at this transfer, and the replay agrees with the chain */
  | { kind: 'dipped'; at: ChainPosition }
  /** the transfers don't add up to the recorded or live balances: don't judge from them */
  | { kind: 'mismatch'; reason: string };

const before = (a: ChainPosition, b: ChainPosition) => a.block < b.block || (a.block === b.block && a.logIndex < b.logIndex);

/**
 * Merge moves that share a log (a transfer from the author to themselves is read once as "out" and
 * once as "in"): one log is one step, so it can't fake a dip.
 */
export function mergeMoves(moves: readonly BalanceMove[]): BalanceMove[] {
  const byLog = new Map<string, BalanceMove>();
  for (const m of moves) {
    const k = `${m.block}:${m.logIndex}`;
    const prev = byLog.get(k);
    byLog.set(k, prev ? { ...prev, delta: prev.delta + m.delta } : { ...m });
  }
  return [...byLog.values()].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
}

/**
 * Replay one run. `reviews`: the run's reviews, oldest first (at least one); `moves`: the author's
 * transfers of the token from the first review on (any order, duplicates merged); `live`: the
 * balance now, read at the same block the moves were read up to.
 */
export function replayRun(reviews: readonly ReplayReview[], moves: readonly BalanceMove[], live: bigint): ReplayResult {
  const first = reviews[0];
  if (!first) return { kind: 'mismatch', reason: 'no reviews' };
  let balance = first.heldAtPost;
  let baseline = first.baseline;
  let next = 1;
  let dip: ChainPosition | null = null;
  const reach = (pos: ChainPosition | null): ReplayResult | null => {
    // apply the reviews posted before `pos` (all of them when pos is null)
    while (next < reviews.length && (pos === null || before(reviews[next]!, pos))) {
      const r = reviews[next++]!;
      if (r.heldAtPost !== balance) return { kind: 'mismatch', reason: `review at block ${r.block} recorded ${r.heldAtPost}, the transfers give ${balance}` };
      baseline = r.baseline;
    }
    return null;
  };
  for (const m of mergeMoves(moves)) {
    if (!before(first, m)) continue; // before (or in the same transaction as) the first review
    const off = reach(m);
    if (off) return off;
    balance += m.delta;
    if (balance < 0n) return { kind: 'mismatch', reason: `balance below zero at block ${m.block}` };
    if (dip === null && isBelowHalf(balance, baseline)) dip = { block: m.block, logIndex: m.logIndex };
  }
  const off = reach(null);
  if (off) return off;
  if (balance !== live) return { kind: 'mismatch', reason: `the transfers give ${balance}, the token says ${live}` };
  return dip ? { kind: 'dipped', at: dip } : { kind: 'clean' };
}
