/**
 * "Sold below half and bought back" on the server: the authors' Transfer logs of each reviewed token,
 * read once from the start of their runs and then only for new blocks (kept while this instance is
 * warm), replayed by @prism/core replay.ts. Reading is time-boxed per refresh: a run whose history
 * isn't read yet simply keeps the live rule until a later refresh has read it.
 */
import type { Address } from 'viem';
import { blockTime, readAuthorMoves, replayRun, type BalanceMove, type ReplayReview } from '@prism/core';
import { client } from './chain';

/** One run to check: its reviews (oldest first, with where they were posted) and the live balance at `head`. */
export interface RunToReplay {
  token: Address;
  author: Address;
  /** the run's current review (where a dip is reported) */
  currentId: number;
  reviews: ReplayReview[];
  live: bigint;
}

interface Entry {
  authors: Set<string>;
  from: bigint;
  /** read up to and including this block */
  to: bigint;
  moves: Map<string, BalanceMove[]>;
}

/** Blocks read per step (the RPC answers 100k a call; each step is a few calls per direction). */
const STEP = 1_000_000n;
const entries = new Map<string, Entry>();
const times = new Map<number, number>();

async function timeOf(block: number) {
  let t = times.get(block);
  if (t === undefined) {
    t = await blockTime(client, block);
    times.set(block, t);
    if (times.size > 10_000) times.delete(times.keys().next().value!);
  }
  return t;
}

/** Dips found, by the id of each run's current review. Runs not fully read within `budgetMs` are left out. */
export async function replaySoldBack(runs: readonly RunToReplay[], head: bigint, budgetMs = 4000): Promise<Map<number, { at: number }>> {
  const deadline = Date.now() + budgetMs;
  const byToken = new Map<string, RunToReplay[]>();
  for (const r of runs) byToken.set(r.token.toLowerCase(), [...(byToken.get(r.token.toLowerCase()) ?? []), r]);
  const out = new Map<number, { at: number }>();
  for (const [token, list] of byToken) {
    const authors = new Set(list.map((r) => r.author.toLowerCase()));
    const from = BigInt(Math.min(...list.map((r) => r.reviews[0]!.block)));
    let e = entries.get(token);
    if (!e || e.from > from || [...authors].some((a) => !e!.authors.has(a))) {
      // a new reviewer, or an earlier run: read this token's history again for everyone
      const all = new Set([...(e?.authors ?? []), ...authors]);
      e = { authors: all, from: e && e.from < from ? e.from : from, to: (e && e.from < from ? e.from : from) - 1n, moves: new Map([...all].map((a) => [a, []])) };
      entries.set(token, e);
    }
    while (e.to < head && Date.now() < deadline) {
      const a = e.to + 1n;
      const b = a + STEP - 1n < head ? a + STEP - 1n : head;
      try {
        const moves = await readAuthorMoves(client, token as Address, [...e.authors] as Address[], a, b);
        for (const [who, list2] of moves) e.moves.get(who)!.push(...list2);
        e.to = b;
      } catch {
        break; // try again next refresh
      }
    }
    if (e.to < head) continue;
    for (const run of list) {
      const r = replayRun(run.reviews, e.moves.get(run.author.toLowerCase()) ?? [], run.live);
      if (r.kind === 'dipped') {
        try {
          out.set(run.currentId, { at: await timeOf(r.at.block) });
        } catch {
          /* no time yet: leave it to the live rule this time */
        }
      }
    }
  }
  if (entries.size > 2000) entries.delete(entries.keys().next().value!);
  return out;
}
