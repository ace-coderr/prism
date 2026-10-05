import { formatUnits, type Address } from 'viem';
import { valueWeights, type Holding } from '@prism/core';
import type { LiveToken } from './chain';
import type { OnchainCrystal } from './crystals';
import { DEFAULT_VOLATILITY } from './crystalHoldings';

export type MarketOf = (token: Address | null) => LiveToken | undefined;

/** One crystal's contents valued at live prices: rows, 3D holdings, total and its 24h move. */
export function valueCrystal(crystal: OnchainCrystal, marketOf: MarketOf) {
  const rows = crystal.assets.map((a) => {
    const m = marketOf(a.token);
    const qty = Number(formatUnits(a.amount, a.decimals));
    const ethValue = m?.market.eth != null ? qty * m.market.eth : null;
    const usdValue = m?.market.usd != null ? qty * m.market.usd : null;
    return { a, m, ethValue, usdValue };
  });
  const weights = valueWeights(rows.map((r) => r.ethValue));
  const holdings: Holding[] = rows.map((r, i) => ({
    symbol: r.a.symbol,
    weight: weights[i]!,
    change24h: r.m?.market.change24h ?? Number.NaN,
    volatility: r.m?.market.volatility ?? DEFAULT_VOLATILITY,
  }));
  const totalEth = rows.reduce((s, r) => s + (r.ethValue ?? 0), 0);
  const totalUsd = rows.reduce((s, r) => s + (r.usdValue ?? 0), 0);
  // value-weighted 24h move of what is inside (null until prices are in)
  const priced = rows
    .map((r, i) => ({ w: weights[i]!, c: r.m?.market.change24h }))
    .filter((x): x is { w: number; c: number } => x.c != null && Number.isFinite(x.c));
  const wsum = priced.reduce((s, x) => s + x.w, 0);
  const change24h = priced.length && wsum > 0 ? priced.reduce((s, x) => s + x.w * x.c, 0) / wsum : null;
  return { rows, holdings, totalEth, totalUsd, change24h };
}
export type Valued = ReturnType<typeof valueCrystal>;
