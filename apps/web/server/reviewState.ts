/**
 * PrismReviews as the site shows it: the chain read incrementally (new blocks only), live balances
 * and supplies, then every derived view (scores, reps, badges, feeds). Cached for FRESH_MS; a
 * `fresh` read (after someone posts) refreshes at most every MIN_FRESH_MS.
 */
import type { Address } from 'viem';
import {
  buildFeeds,
  buildWorld,
  getDeployment,
  readReviewBalances,
  readReviewChain,
  readReviewSupplies,
  reviewerSummaries,
  robinhoodChainTestnet,
  type AssetInfo,
  type Balances,
  type Feeds,
  type ReviewChainState,
  type ReviewWorld,
  type ReviewerSummary,
} from '@prism/core';
import { client } from './chain';
import { currentIndex, type LiveIndex } from './launchIndex';

const FRESH_MS = 20_000;
const MIN_FRESH_MS = 3_000;

export interface ReviewState {
  at: number;
  index: LiveIndex;
  balances: Balances;
  world: ReviewWorld;
  reviewers: Map<string, ReviewerSummary>;
  feeds: Feeds;
  assetInfo: (token: Address) => AssetInfo | null;
}

let chain: ReviewChainState | null = null;
let state: ReviewState | null = null;
let loading: Promise<ReviewState> | null = null;

export function assetInfoFrom(idx: LiveIndex) {
  return (token: Address): AssetInfo | null => {
    const a = idx.assetByToken.get(token.toLowerCase());
    if (!a) return null;
    return { symbol: a.symbol, name: a.name, kind: a.kind, graduatedBlock: idx.launchByToken.get(token.toLowerCase())?.graduatedBlock ?? null };
  };
}

export async function reviewState(fresh = false): Promise<ReviewState> {
  const age = state ? Date.now() - state.at : Infinity;
  if (state && age < (fresh ? MIN_FRESH_MS : FRESH_MS)) return state;
  loading ??= (async () => {
    const d = getDeployment(robinhoodChainTestnet.id);
    if (!d?.prismReviews || d.prismReviewsFromBlock === undefined) throw new Error('PrismReviews is not deployed.');
    const [index, next] = await Promise.all([currentIndex(), readReviewChain(client, d.prismReviews, d.prismReviewsFromBlock, chain)]);
    chain = next;
    const [balances, supplies] = await Promise.all([readReviewBalances(client, next), readReviewSupplies(client, next)]);
    const assetInfo = assetInfoFrom(index);
    const now = Math.floor(Date.now() / 1000);
    const world = buildWorld(next, balances, supplies, assetInfo, now);
    const reviewers = reviewerSummaries(world, next, balances, assetInfo);
    const s: ReviewState = { at: Date.now(), index, balances, world, reviewers, feeds: buildFeeds(world, reviewers, balances), assetInfo };
    state = s;
    return s;
  })().finally(() => {
    loading = null;
  });
  return loading;
}
