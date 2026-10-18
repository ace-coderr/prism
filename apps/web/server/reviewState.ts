/**
 * PrismReviews as the site shows it: both contracts read incrementally (new blocks only; the first,
 * retired one as history), live balances and supplies at the same block, the smallest position that
 * counts per token, creators from the launch index, the sold-and-bought-back replay, then every
 * derived view (scores, reps, badges, feeds). Cached for FRESH_MS.
 *
 * Fresh reads: right after posting, the app asks for a state that includes the block its transaction
 * landed in (`minBlock`). A state that already includes it is served as is; otherwise one chain read
 * is made, shared by everyone asking at the time, and at most one every MIN_FRESH_MS per instance.
 * Anyone can ask, so asking can't make the server read the chain more often than that.
 */
import type { Address } from 'viem';
import {
  balanceKey,
  buildFeeds,
  buildWorld,
  getDeployment,
  readReviewBalances,
  readReviewChain,
  readReviewSupplies,
  reviewerSummaries,
  robinhoodChainTestnet,
  runsOf,
  toRecords,
  type AssetInfo,
  type Balances,
  type Feeds,
  type MinPosition,
  type ReviewChainState,
  type ReviewWorld,
  type ReviewerSummary,
} from '@prism/core';
import { client } from './chain';
import { floorsFor } from './floors';
import { freshGate } from './freshGate';
import { currentIndex, type LiveIndex } from './launchIndex';
import { replaySoldBack, type RunToReplay } from './replayCache';

const FRESH_MS = 20_000;
const MIN_FRESH_MS = 3_000;
/** How long a refresh may spend reading transfer history for the replay. */
const REPLAY_BUDGET_MS = 4_000;

export interface ReviewState {
  at: number;
  /** the block everything was read at */
  block: bigint;
  index: LiveIndex;
  balances: Balances;
  world: ReviewWorld;
  reviewers: Map<string, ReviewerSummary>;
  feeds: Feeds;
  assetInfo: (token: Address) => AssetInfo | null;
  floors: Map<string, MinPosition | null>;
}

let v2: ReviewChainState | null = null;
let v1: ReviewChainState | null = null;

export function assetInfoFrom(idx: LiveIndex) {
  return (token: Address): AssetInfo | null => {
    const a = idx.assetByToken.get(token.toLowerCase());
    if (!a) return null;
    const launch = idx.launchByToken.get(token.toLowerCase());
    return { symbol: a.symbol, name: a.name, kind: a.kind, graduatedBlock: launch?.graduatedBlock ?? null, creator: launch?.creator ?? null };
  };
}

async function read(): Promise<ReviewState> {
  const d = getDeployment(robinhoodChainTestnet.id);
  if (!d?.prismReviews || d.prismReviewsFromBlock === undefined) throw new Error('PrismReviews is not deployed.');
  const head = await client.getBlockNumber();
  const old = d.retiredReviews;
  const [index, next, retired] = await Promise.all([
    currentIndex(),
    readReviewChain(client, { contract: d.prismReviews, version: 2, fromBlock: d.prismReviewsFromBlock }, v2, head),
    old ? readReviewChain(client, { contract: old.address, version: 1, fromBlock: old.fromBlock, lastId: old.lastId, postBlocks: old.postBlocks }, v1, head).catch(() => v1) : Promise.resolve(null),
  ]);
  v2 = next;
  v1 = retired;
  const sets = retired ? [next, retired] : [next];
  const [balances, supplies] = await Promise.all([readReviewBalances(client, sets, head), readReviewSupplies(client, sets)]);
  const assetInfo = assetInfoFrom(index);

  // the smallest position that counts, for each listed token reviewed on the current contract
  const listed = [...new Set([...next.stored.values()].map((s) => s.token.toLowerCase()))]
    .map((t) => index.assetByToken.get(t))
    .filter((a) => !!a)
    .map((asset) => ({ asset: asset!, launch: index.launchByToken.get(asset!.token.toLowerCase()) ?? null, supply: supplies.get(asset!.token.toLowerCase())?.supply ?? null }));
  const floors = await floorsFor(listed);

  // runs to replay: listed, still active, not below half right now
  const runs: RunToReplay[] = [];
  for (const run of runsOf(toRecords(next))) {
    const last = run.reviews.at(-1)!;
    if (last.status !== 'active' || !index.assetByToken.has(last.token.toLowerCase())) continue;
    const live = balances.get(balanceKey(last.author, last.token));
    if (live === null || live === undefined || live < last.baseline - last.baseline / 2n) continue;
    const reviews = run.reviews.map((r) => {
      const p = next.posted.get(r.id);
      return p ? { block: p.block, logIndex: p.logIndex, heldAtPost: r.heldAtPost, baseline: r.baseline } : null;
    });
    if (reviews.some((r) => r === null)) continue;
    runs.push({ token: last.token, author: last.author, currentId: last.id, reviews: reviews as RunToReplay['reviews'], live });
  }
  const soldBack = await replaySoldBack(runs, head, REPLAY_BUDGET_MS).catch(() => new Map<number, { at: number }>());

  const now = Math.floor(Date.now() / 1000);
  const world = buildWorld({
    data: next,
    retired,
    balances,
    supplies,
    assetOf: assetInfo,
    floorOf: (t) => floors.get(t.toLowerCase())?.units ?? null,
    soldBack,
    now,
  });
  const reviewers = reviewerSummaries(world, next, balances, assetInfo);
  return { at: Date.now(), block: head, index, balances, world, reviewers, feeds: buildFeeds(world, reviewers, balances), assetInfo, floors };
}

/**
 * The current state. `minBlock`: the caller needs a state that includes this block (right after
 * posting); 0 = any state younger than FRESH_MS. Reads are shared and rate-limited (freshGate.ts).
 */
export const reviewState: (minBlock?: bigint) => Promise<ReviewState> = freshGate(read, { freshMs: FRESH_MS, minGapMs: MIN_FRESH_MS });
