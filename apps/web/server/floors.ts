/**
 * The smallest position that counts for each reviewed token (@prism/core market.ts minPosition):
 * worth $1 at the current price, or a millionth of the supply when PRISM can't price it. Uses the
 * cheapest price reads PRISM already has (the curve's or pool's state, one multicall; the ETH price
 * of a test-stock pair; Chainlink's ETH/USD), cached for 10 minutes per token.
 */
import type { Address } from 'viem';
import { TESTNET_TOKENS, minPosition, readMarketState, readStockState, usdPerBaseUnit, type Launch, type MinPosition, type ReviewableAsset } from '@prism/core';
import { client } from './chain';
import { ethPerPairUnit, usd } from './marketData';

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; p: Promise<MinPosition | null> }>();

/** Dollars per base unit right now, or null if PRISM can't price it. */
async function priceOf(asset: ReviewableAsset, launch: Launch | null): Promise<{ usdPerUnit: number | null; supply: bigint | null }> {
  const stock = asset.kind === 'stock' ? (TESTNET_TOKENS.find((t) => t.address.toLowerCase() === asset.token.toLowerCase()) ?? null) : null;
  const pair: Address | null = stock ? null : (asset.quote?.address ?? null);
  const [state, usdEth, pairEth] = await Promise.all([
    stock
      ? readStockState(client, stock)
      : readMarketState(client, {
          token: asset.token,
          kind: asset.kind,
          gen: launch?.gen,
          curve: launch?.curve,
          block: launch?.block,
          graduatedBlock: launch?.graduatedBlock ?? null,
          pair,
          pairDecimals: 18,
        }),
    usd().catch(() => null),
    ethPerPairUnit(pair),
  ]);
  return { usdPerUnit: usdPerBaseUnit(state.cap, state.supply, pairEth, usdEth), supply: state.supply };
}

/** After a failed price read, ask again this soon (the supply rule applies meanwhile). */
const RETRY_MS = 60_000;

/**
 * The floor for one asset (cached); null only when neither a price nor a supply is known. If the
 * price can't be read right now, `knownSupply` (already read with the reviews) gives the supply rule,
 * so a failing RPC never lets dust count.
 */
export function floorFor(asset: ReviewableAsset, launch: Launch | null, knownSupply: bigint | null = null): Promise<MinPosition | null> {
  const key = asset.token.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = priceOf(asset, launch)
    .then(({ usdPerUnit, supply }) => minPosition(usdPerUnit, supply ?? knownSupply))
    .catch(() => {
      // retry soon: keep the fallback for a minute only
      cache.set(key, { at: Date.now() - TTL_MS + RETRY_MS, p });
      return minPosition(null, knownSupply);
    });
  cache.set(key, { at: Date.now(), p });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return p;
}

/** Floors for many assets, a few at a time. */
export async function floorsFor(items: ReadonlyArray<{ asset: ReviewableAsset; launch: Launch | null; supply?: bigint | null }>, parallel = 6): Promise<Map<string, MinPosition | null>> {
  const out = new Map<string, MinPosition | null>();
  const queue = [...items];
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      for (let it = queue.shift(); it; it = queue.shift()) out.set(it.asset.token.toLowerCase(), await floorFor(it.asset, it.launch, it.supply ?? null));
    }),
  );
  return out;
}
