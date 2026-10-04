/**
 * Read-only Uniswap V4 liquidity + price report for every token in tokens.ts on
 * Robinhood Chain Testnet (46630). PoolManager from the vibe/vibe chain config.
 *
 *   npx tsx packages/core/scripts/check-liquidity.ts
 */
import { createPublicClient, http, type PublicClient } from 'viem';
import { robinhoodChainTestnet } from '../src/chain';
import { TESTNET_TOKENS } from '../src/tokens';
import { ethToMovePrice, virtualReserves } from '../src/pool';
import { fetchVibePrices, marketSnapshot, readPoolSpot } from '../src/market';

const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http(undefined, { batch: true }) }) as PublicClient;

async function main() {
  const vibe = await fetchVibePrices(fetch).catch((e) => {
    console.log('vibe/vibe API unavailable:', (e as Error).message);
    return null;
  });
  console.log(`ETH/USD (vibe/vibe API, CoinGecko): ${vibe?.usdPerEth ?? 'n/a'}`);
  const snap = await marketSnapshot(client, TESTNET_TOKENS, vibe);
  const rows = [];
  for (const t of TESTNET_TOKENS) {
    const spot = await readPoolSpot(client, t).catch(() => null);
    const m = snap.get(t.id)!;
    const res = spot ? virtualReserves(spot.liquidity, spot.sqrtPriceX96, t.decimals) : null;
    rows.push({
      id: t.id,
      pool: spot ? spot.poolId.slice(0, 10) + '…' : 'none',
      poolEthPerToken: spot?.ethPerToken?.toPrecision(4) ?? '-',
      apiEth: m.eth?.toPrecision(4) ?? '-',
      usd: m.usd?.toFixed(2) ?? '-',
      priceSource: m.priceSource,
      change24h: m.change24h === null ? '-' : m.change24h.toFixed(2) + '%',
      vol: m.volatility?.toFixed(2) ?? '-',
      swaps24h: m.swaps24h,
      inRangeEth: res ? res.eth.toFixed(3) : '-',
      ethFor2pct: spot ? ethToMovePrice(spot.liquidity, spot.sqrtPriceX96, 0.02).toFixed(4) : '-',
    });
  }
  console.table(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
