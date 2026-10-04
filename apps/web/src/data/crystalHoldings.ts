import type { Address } from 'viem';
import {
  crystalHistoryOf,
  forgeWeightsOf,
  holdingsOf,
  liveBasketOf,
  type CrystalAsset,
  type CrystalHistory,
  type Holding,
  type LiveBasket,
  type OnchainCrystal,
} from '@prism/core';
import type { LiveToken, LiveTokens } from './chain';

export { DEFAULT_VOLATILITY, LIVE_BASKET, forgedAt } from '@prism/core';

const historyOf = (live: LiveTokens) => (live.status === 'live' ? live.history : null);

/**
 * A real crystal's contents → weighted holdings for the 3D crystal. Weights follow
 * value in ETH (live on-chain prices); anything without a price gets an average share.
 */
export function holdingsFromAssets(
  assets: CrystalAsset[],
  marketOf: (token: Address | null) => LiveToken | undefined,
): { holdings: Holding[]; totalEth: number } {
  const { holdings, totalEth } = holdingsOf(assets, (a) => marketOf(a.token)?.market);
  return { holdings, totalEth };
}

/** Look up live market data by token address (null = native ETH → WETH's market). */
export function marketLookup(tokens: LiveToken[] | undefined) {
  const byAddress = new Map((tokens ?? []).map((t) => [t.address.toLowerCase(), t]));
  const weth = tokens?.find((t) => t.id === 'WETH');
  return (token: Address | null) => (token ? byAddress.get(token.toLowerCase()) : weth);
}

/** Cracks and gold seams from real prices since the crystal's forge block (once loaded). */
export function realCrystalHistory(live: LiveTokens, crystal: OnchainCrystal): CrystalHistory | undefined {
  return crystalHistoryOf(historyOf(live), crystal);
}

/** Weights at forge time, from the Forged event and the prices of the forge block (once loaded). */
export function forgeWeights(live: LiveTokens, crystal: OnchainCrystal): Map<string, number> | null {
  return forgeWeightsOf(historyOf(live), crystal);
}

/** The live Home crystal from the browser's own chain read, or null until its history loads. */
export function liveBasket(live: LiveTokens): LiveBasket | null {
  const history = historyOf(live);
  if (live.status !== 'live' || !history) return null;
  return liveBasketOf(new Map(live.tokens.map((t) => [t.id, t.market])), history);
}
