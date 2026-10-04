import { formatUnits, type Address } from 'viem';
import { valueWeights, type Holding } from '@prism/core';
import type { LiveToken } from './chain';
import type { CrystalAsset } from './crystals';

/** Shape-only default when there is no price history to measure how jumpy a price is. */
export const DEFAULT_VOLATILITY = 0.4;

/**
 * A real crystal's contents → weighted holdings for the 3D crystal. Weights follow
 * value in ETH (live on-chain prices); anything without a price gets an average share.
 */
export function holdingsFromAssets(
  assets: CrystalAsset[],
  marketOf: (token: Address | null) => LiveToken | undefined,
): { holdings: Holding[]; rows: Array<{ asset: CrystalAsset; ethValue: number | null; market?: LiveToken }>; totalEth: number } {
  const rows = assets.map((asset) => {
    const market = marketOf(asset.token);
    const qty = Number(formatUnits(asset.amount, asset.decimals));
    const ethValue = market?.market.eth != null ? qty * market.market.eth : null;
    return { asset, ethValue, market };
  });
  const weights = valueWeights(rows.map((r) => r.ethValue));
  const holdings = rows.map((r, i) => ({
    symbol: r.asset.symbol,
    weight: weights[i]!,
    change24h: r.market?.market.change24h ?? Number.NaN,
    volatility: r.market?.market.volatility ?? DEFAULT_VOLATILITY,
  }));
  const totalEth = rows.reduce((s, r) => s + (r.ethValue ?? 0), 0);
  return { holdings, rows, totalEth };
}

/** Look up live market data by token address (null = native ETH → WETH's market). */
export function marketLookup(tokens: LiveToken[] | undefined) {
  const byAddress = new Map((tokens ?? []).map((t) => [t.address.toLowerCase(), t]));
  const weth = tokens?.find((t) => t.id === 'WETH');
  return (token: Address | null) => (token ? byAddress.get(token.toLowerCase()) : weth);
}
