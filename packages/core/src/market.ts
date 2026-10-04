/**
 * Read-only market data for testnet tokens, entirely on-chain: Uniswap V4 pool
 * state and swap history via the public RPC. Takes a viem PublicClient so web and
 * scripts share it. No transactions, no keys, no third-party APIs.
 *
 * vibe/vibe API blocks third-party origins; we read prices on-chain only. Ask
 * vibe/vibe to allowlist PRISM's domain before using the API.
 */
import { parseAbiItem, type Hex, type PublicClient } from 'viem';
import {
  NATIVE_ETH,
  invertSeries,
  multiplySeries,
  POOL_MANAGER,
  ethPerToken,
  poolIdOf,
  poolStateSlot,
  priceStats,
  sqrtPriceFromSlot0,
  type PricePoint,
} from './pool';
import { tokenById, type TestnetToken } from './tokens';

const extsloadAbi = [
  {
    type: 'function',
    name: 'extsload',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
  },
] as const;

const swapEvent = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
);

export function ethPoolId(token: TestnetToken): Hex | null {
  if (!token.pool) return null;
  return poolIdOf({ currency0: NATIVE_ETH, currency1: token.address, ...token.pool });
}

export interface PoolSpot {
  poolId: Hex;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  ethPerToken: number | null;
}

/** Current pool price + in-range liquidity, via PoolManager.extsload. */
export async function readPoolSpot(client: PublicClient, token: TestnetToken): Promise<PoolSpot | null> {
  const poolId = ethPoolId(token);
  if (!poolId) return null;
  const slot = poolStateSlot(poolId);
  const liqSlot = `0x${(BigInt(slot) + 3n).toString(16).padStart(64, '0')}` as Hex;
  const [slot0, liq] = await Promise.all([
    client.readContract({ address: POOL_MANAGER, abi: extsloadAbi, functionName: 'extsload', args: [slot] }),
    client.readContract({ address: POOL_MANAGER, abi: extsloadAbi, functionName: 'extsload', args: [liqSlot] }),
  ]);
  const sqrtPriceX96 = sqrtPriceFromSlot0(slot0);
  if (sqrtPriceX96 === 0n) return null; // pool not initialized
  return {
    poolId,
    sqrtPriceX96,
    liquidity: BigInt(liq) & ((1n << 128n) - 1n),
    ethPerToken: ethPerToken(sqrtPriceX96, token.decimals),
  };
}

/**
 * Block → timestamp estimator from a handful of real block headers
 * (this RPC's logs carry no timestamps). Piecewise-linear between anchors.
 */
export async function blockClock(client: PublicClient, from: bigint, to: bigint, anchors = 24) {
  const nums = Array.from({ length: anchors + 1 }, (_, i) => from + ((to - from) * BigInt(i)) / BigInt(anchors));
  const blocks = await Promise.all(nums.map((n) => client.getBlock({ blockNumber: n })));
  const pts = blocks.map((b) => [Number(b.number), Number(b.timestamp)] as const);
  return (bn: bigint) => {
    const x = Number(bn);
    for (let i = 1; i < pts.length; i++) {
      const [x0, t0] = pts[i - 1]!;
      const [x1, t1] = pts[i]!;
      if (x <= x1 || i === pts.length - 1) return t0 + ((x - x0) * (t1 - t0)) / Math.max(1, x1 - x0);
    }
    return pts[pts.length - 1]![1];
  };
}

export interface HistoryContext {
  from: bigint;
  to: bigint;
  nowSec: number;
  clock: (bn: bigint) => number;
}

/** One shared block window (24h + 25% lookback) and block→time clock for all pools. */
export async function historyContext(client: PublicClient, windowSec = 86400): Promise<HistoryContext> {
  const head = await client.getBlock();
  const probe = await client.getBlock({ blockNumber: head.number - 50_000n });
  const spb = Number(head.timestamp - probe.timestamp) / 50_000 || 0.25;
  const span = BigInt(Math.ceil((windowSec * 1.25) / spb));
  const from = head.number > span ? head.number - span : 0n;
  const clock = await blockClock(client, from, head.number);
  return { from, to: head.number, nowSec: Number(head.timestamp), clock };
}

/**
 * Price history (ETH per token) for several tokens from their pools' Swap events,
 * fetched with a single getLogs over all pool ids.
 */
export async function readSwapHistories(
  client: PublicClient,
  tokens: readonly TestnetToken[],
  ctx: HistoryContext,
): Promise<Map<string, PricePoint[]>> {
  const ids = new Map<string, TestnetToken>();
  for (const t of tokens) {
    const id = ethPoolId(t);
    if (id) ids.set(id.toLowerCase(), t);
  }
  const out = new Map<string, PricePoint[]>(tokens.map((t) => [t.id, []]));
  if (ids.size === 0) return out;
  const logs = await getLogsChunked(client, [...ids.keys()] as Hex[], ctx.from, ctx.to);
  for (const l of logs) {
    const t = ids.get(String(l.args.id).toLowerCase());
    if (!t) continue;
    out.get(t.id)!.push({ t: ctx.clock(l.blockNumber!), price: ethPerToken(l.args.sqrtPriceX96!, t.decimals) ?? 0 });
  }
  return out;
}

async function getLogsChunked(
  client: PublicClient,
  id: Hex | Hex[],
  from: bigint,
  to: bigint,
): Promise<Awaited<ReturnType<typeof fetchSwapLogs>>> {
  try {
    return await fetchSwapLogs(client, id, from, to);
  } catch {
    // provider range limit — split in halves
    if (to - from < 1000n) throw new Error('getLogs failed on a small range');
    const mid = (from + to) / 2n;
    const [a, b] = await Promise.all([getLogsChunked(client, id, from, mid), getLogsChunked(client, id, mid + 1n, to)]);
    return [...a, ...b];
  }
}

function fetchSwapLogs(client: PublicClient, id: Hex | Hex[], from: bigint, to: bigint) {
  return client.getLogs({ address: POOL_MANAGER, event: swapEvent, args: { id }, fromBlock: from, toBlock: to });
}

export type PriceSource = 'On-chain pool price' | 'none';
export type HistorySource = 'On-chain swaps (24h)' | 'none';

export interface TokenMarket {
  id: string;
  /** USD price (token/ETH pool × ETH/USDG pool), or null when unknown. */
  usd: number | null;
  /** ETH per token, or null. */
  eth: number | null;
  priceSource: PriceSource;
  /** % change over 24h in USD terms, from real swap history; null when not computable. */
  change24h: number | null;
  /** 0..1 from real USD price history; null → caller uses a stated default. */
  volatility: number | null;
  historySource: HistorySource;
  /** swaps in the last 24h across the pools behind this price */
  swaps24h: number;
}

/** USDG (6 decimals) prices ETH in USD via the ETH/USDG pool. */
export const USD_REFERENCE_ID = 'USDG';

const isWeth = (t: TestnetToken) => t.kind === 'crypto' && t.symbol === 'WETH';

/**
 * Market snapshot, fully on-chain:
 * - token price in ETH = its ETH-paired V4 pool spot
 * - ETH in USD = 1 / (ETH per USDG) from the ETH/USDG pool
 * - token USD = token ETH × ETH USD; WETH = 1 ETH
 * - 24h change + volatility from the pools' Swap events, combined into a USD series
 *   (token/ETH × ETH/USD), so they are USD moves, not ETH moves.
 *
 * `history: false` skips the swap logs (the slow part): prices only, 24h fields null.
 */
export async function marketSnapshot(
  client: PublicClient,
  tokens: readonly TestnetToken[],
  { history = true }: { history?: boolean } = {},
): Promise<Map<string, TokenMarket>> {
  const usdRef = tokenById(USD_REFERENCE_ID)!;
  const pooled = [...new Map([...tokens, usdRef].filter((t) => t.pool).map((t) => [t.id, t])).values()];

  const [spots, histories] = await Promise.all([
    Promise.all(pooled.map((t) => readPoolSpot(client, t).catch(() => null))),
    history
      ? historyContext(client)
          .then((ctx) => readSwapHistories(client, pooled, ctx).then((h) => ({ ctx, h })))
          .catch(() => null)
      : null,
  ]);
  const spotById = new Map(pooled.map((t, i) => [t.id, spots[i] ?? null]));
  const ethPerUsdg = spotById.get(usdRef.id)?.ethPerToken ?? null;
  const usdPerEth = ethPerUsdg ? 1 / ethPerUsdg : null;

  // USD per ETH over time (forward-filled), from the ETH/USDG pool's swaps
  const usdgPts = histories?.h.get(usdRef.id) ?? [];
  const ethUsdSeries = invertSeries(usdgPts);
  const nowSec = histories?.ctx.nowSec ?? 0;
  const in24h = (pts: { t: number }[]) => pts.filter((x) => x.t > nowSec - 86400).length;

  const out = new Map<string, TokenMarket>();
  for (const t of tokens) {
    let eth: number | null = null;
    let priceSource: PriceSource = 'none';
    if (isWeth(t)) {
      eth = 1; // wrapped 1:1
      priceSource = usdPerEth ? 'On-chain pool price' : 'none';
    } else if (t.id === usdRef.id) {
      eth = ethPerUsdg;
      priceSource = eth ? 'On-chain pool price' : 'none';
    } else {
      eth = spotById.get(t.id)?.ethPerToken ?? null;
      if (eth) priceSource = 'On-chain pool price';
    }
    const usd = t.id === usdRef.id ? (eth ? 1 : null) : eth !== null && usdPerEth ? eth * usdPerEth : null;

    // history in USD terms
    let change24h: number | null = null;
    let volatility: number | null = null;
    let historySource: HistorySource = 'none';
    let swaps24h = 0;
    if (histories && usdPerEth) {
      const usdSeries = (() => {
        if (t.id === usdRef.id) return null; // USDG is the unit — no USD history of its own
        if (isWeth(t)) return ethUsdSeries;
        if (!spotById.get(t.id)) return null;
        return multiplySeries(histories.h.get(t.id) ?? [], ethUsdSeries);
      })();
      if (usdSeries) {
        swaps24h = in24h(usdgPts) + (isWeth(t) ? 0 : in24h(histories.h.get(t.id) ?? []));
        if (usdSeries.length === 0) {
          // V4 prices only move on swaps: no swaps in either pool over the window = unchanged
          change24h = 0;
          volatility = 0;
        } else {
          const stats = priceStats(usdSeries, nowSec);
          change24h = stats.change24h;
          volatility = stats.volatility ?? (swaps24h === 0 ? 0 : null);
        }
        if (change24h !== null) historySource = 'On-chain swaps (24h)';
      }
    }
    out.set(t.id, { id: t.id, usd, eth, priceSource, change24h, volatility, historySource, swaps24h });
  }
  return out;
}
