/**
 * Read-only Uniswap V4 liquidity + price report for every token in tokens.ts on
 * Robinhood Chain Testnet (46630), fully on-chain. PoolManager address from the
 * vibe/vibe chain config (https://testnet.vibevibe.fun/api/v1/chains/46630/config).
 *
 *   npx tsx packages/core/scripts/check-liquidity.ts
 */
import { createPublicClient, http, type PublicClient } from 'viem';
import { robinhoodChainTestnet } from '../src/chain';
import { TESTNET_TOKENS } from '../src/tokens';
import { ethToMovePrice, virtualReserves } from '../src/pool';
import { marketSnapshot, readPoolSpot } from '../src/market';

const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http(undefined, { batch: { batchSize: 20 } }) }) as PublicClient;

async function main() {
  const snap = await marketSnapshot(client, TESTNET_TOKENS);
  console.log(`ETH/USD (on-chain, ETH/USDG pool): ${snap.get('WETH')?.usd?.toFixed(2) ?? 'n/a'}`);
  const rows = [];
  for (const t of TESTNET_TOKENS) {
    const spot = await readPoolSpot(client, t).catch(() => null);
    const m = snap.get(t.id)!;
    const res = spot ? virtualReserves(spot.liquidity, spot.sqrtPriceX96, t.decimals) : null;
    rows.push({
      id: t.id,
      pool: spot ? spot.poolId.slice(0, 10) + '…' : 'none',
      poolEthPerToken: spot?.ethPerToken?.toPrecision(4) ?? '-',
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
