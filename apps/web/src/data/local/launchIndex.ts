/**
 * The browser's version of server/launchIndex.ts. The browser never holds the 257,000-launch
 * index. This holds the few launches a live read needs (the reviewed tokens, the one being looked
 * at), filled in from the launch files, so the review state can be read in the browser right after
 * someone posts a review.
 */
import type { Address } from 'viem';
import { fromLaunchRow, type Launch, type LaunchIndex, type LaunchShardRow, type ReviewableAsset } from '@prism/core';

export interface LiveIndex {
  index: LaunchIndex;
  stale: boolean;
  at: number;
  assets: ReviewableAsset[];
  assetByToken: Map<string, ReviewableAsset>;
  launchByToken: Map<string, Launch>;
}

const assets: ReviewableAsset[] = [];
const assetByToken = new Map<string, ReviewableAsset>();
const launchByToken = new Map<string, Launch>();

/** Teach the index these launches (ones it already has are left alone). */
export function primeIndex(rows: readonly LaunchShardRow[]): void {
  for (const row of rows) {
    const k = row[0].toLowerCase();
    if (launchByToken.has(k)) continue;
    const { launch, asset } = fromLaunchRow(row);
    launchByToken.set(k, launch);
    assetByToken.set(k, asset);
    assets.push(asset);
  }
}

/** Also teach it an asset that isn't a launch (a test stock). */
export function primeAsset(asset: ReviewableAsset): void {
  const k = asset.token.toLowerCase();
  if (assetByToken.has(k)) return;
  assetByToken.set(k, asset);
  assets.push(asset);
}

export async function currentIndex(): Promise<LiveIndex> {
  return {
    index: { version: 2, chainId: 46630, toBlock: 0, generatedAt: 0, launches: [...launchByToken.values()], quoteSymbols: {} },
    stale: false,
    at: Date.now(),
    assets,
    assetByToken,
    launchByToken,
  };
}

export const assetOf = (live: LiveIndex, token: Address | string) => live.assetByToken.get(token.toLowerCase()) ?? null;
