import { formatUnits, type Address } from 'viem';
import {
  crystalHistory,
  priceAt,
  tokenById,
  usdHistory,
  valueWeights,
  type CrystalHistory,
  type Holding,
  type MarketHistory,
  type PricePoint,
} from '@prism/core';
import type { LiveToken, LiveTokens } from './chain';
import type { CrystalAsset, OnchainCrystal } from './crystals';

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

/** USD price history of a crystal asset (native ETH uses WETH's = ETH/USD). */
function assetSeries(history: MarketHistory, asset: CrystalAsset, marketOf: (token: Address | null) => LiveToken | undefined) {
  const token = asset.token ? marketOf(asset.token) : tokenById('WETH');
  return token ? usdHistory(history, token) : [];
}

/** When a crystal was forged (unix s), when its forge block is inside the loaded history. */
export function forgedAt(history: MarketHistory | null, crystal: OnchainCrystal): number | null {
  if (!history || crystal.forgedBlock === null || crystal.forgedBlock < history.fromBlock) return null;
  return history.clock(crystal.forgedBlock);
}

/**
 * Cracks and gold seams for a real crystal: each holding's real price drops since the
 * crystal's forge block. Undefined until the history covering that block has loaded.
 */
export function realCrystalHistory(
  live: LiveTokens,
  crystal: OnchainCrystal,
  marketOf: (token: Address | null) => LiveToken | undefined,
): CrystalHistory | undefined {
  const history = live.status === 'live' ? live.history : null;
  const since = forgedAt(history, crystal);
  if (!history || since === null) return undefined;
  const series = new Map<string, PricePoint[]>();
  for (const a of crystal.assets) series.set(a.symbol, assetSeries(history, a, marketOf));
  return crystalHistory(series, since);
}

/**
 * Weights at forge time: what went in (the Forged event), valued at the prices in
 * effect at the forge block. Null until the history covering that block has loaded.
 */
export function forgeWeights(
  live: LiveTokens,
  crystal: OnchainCrystal,
  marketOf: (token: Address | null) => LiveToken | undefined,
): Map<string, number> | null {
  const history = live.status === 'live' ? live.history : null;
  const since = forgedAt(history, crystal);
  if (!history || since === null || crystal.forgedWith.length === 0) return null;
  const values = crystal.forgedWith.map((a) => {
    const usd = priceAt(assetSeries(history, a, marketOf), since);
    return usd === null ? null : Number(formatUnits(a.amount, a.decimals)) * usd;
  });
  const w = valueWeights(values);
  return new Map(crystal.forgedWith.map((a, i) => [a.symbol, w[i]!]));
}

/** The live Home basket: equal parts of each real testnet asset. */
export const LIVE_BASKET = ['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI', 'WETH'] as const;

/**
 * Holdings + history for the live Home crystal, all from real testnet data: 24h moves
 * and jumpiness from the pools, cracks / gold seams from the pools' real drops over
 * the loaded history. Null until the history has loaded.
 */
export function liveBasket(live: LiveTokens): { holdings: Holding[]; history: CrystalHistory; hours: number } | null {
  if (live.status !== 'live' || !live.history) return null;
  const tokens = LIVE_BASKET.map((id) => live.tokens.find((t) => t.id === id)).filter((t): t is LiveToken => !!t);
  if (tokens.length === 0) return null;
  const history = live.history;
  const holdings: Holding[] = tokens.map((t) => ({
    symbol: t.id,
    weight: 1 / tokens.length,
    change24h: t.market.change24h ?? Number.NaN,
    volatility: t.market.volatility ?? DEFAULT_VOLATILITY,
  }));
  const start = history.clock(history.fromBlock);
  const series = new Map(tokens.map((t) => [t.id, usdHistory(history, t)]));
  return { holdings, history: crystalHistory(series, start), hours: Math.round((history.nowSec - start) / 3600) };
}
