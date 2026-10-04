/**
 * Read-only market data for testnet tokens: vibe/vibe API prices and Uniswap V4
 * pool state / swap history. Takes a viem PublicClient so web and scripts share it.
 * No transactions, no keys.
 */
import { parseAbiItem, type Hex, type PublicClient } from 'viem';
import {
  NATIVE_ETH,
  POOL_MANAGER,
  ethPerToken,
  poolIdOf,
  poolStateSlot,
  priceStats,
  sqrtPriceFromSlot0,
  type PricePoint,
} from './pool';
import type { TestnetToken } from './tokens';

export const VIBE_API = 'https://testnet.vibevibe.fun/api/v1/chains/46630';

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

export interface VibePrices {
  usdPerEth: number | null;
  /** lower-cased token address → ETH per token (vibe/vibe v6/pair-prices) */
  ethPerTokenByAddress: Record<string, number>;
  /** lower-cased quote address → USD (vibe/vibe market/quote-usd-rates) */
  usdByQuoteAddress: Record<string, number>;
}

/** vibe/vibe public market endpoints. `base` lets the web app go through a proxy. */
export async function fetchVibePrices(fetchImpl: typeof fetch, base = VIBE_API): Promise<VibePrices> {
  const get = async (path: string) => {
    const r = await fetchImpl(`${base}/${path}`);
    if (!r.ok) throw new Error(`vibe/vibe API ${path}: HTTP ${r.status}`);
    return r.json();
  };
  const [eth, pairs, quotes] = await Promise.all([
    get('market/eth-usd'),
    get('v6/pair-prices'),
    get('market/quote-usd-rates').catch(() => null),
  ]);
  const usdPerEth = eth?.data?.usdPerEthCents ? Number(eth.data.usdPerEthCents) / 100 : null;
  const ethPerTokenByAddress: Record<string, number> = {};
  for (const p of pairs?.data?.items ?? []) {
    if (p.priceEthWad) ethPerTokenByAddress[String(p.pairAddress).toLowerCase()] = Number(BigInt(p.priceEthWad)) / 1e18;
  }
  const usdByQuoteAddress: Record<string, number> = {};
  for (const q of quotes?.data?.items ?? []) {
    if (q.usdPerQuoteCents) usdByQuoteAddress[String(q.quoteAddress).toLowerCase()] = Number(q.usdPerQuoteCents) / 100;
  }
  return { usdPerEth, ethPerTokenByAddress, usdByQuoteAddress };
}

export type PriceSource = 'vibe/vibe API' | 'V4 pool spot' | 'WETH = 1 ETH' | 'none';
export type HistorySource = 'V4 pool swaps (24h)' | 'none';

export interface TokenMarket {
  id: string;
  /** USD price, or null when unknown. */
  usd: number | null;
  /** ETH per token, or null. */
  eth: number | null;
  priceSource: PriceSource;
  /** % change over 24h from real history, null when not computable. */
  change24h: number | null;
  /** 0..1 from real history, null → caller uses a stated default. */
  volatility: number | null;
  historySource: HistorySource;
  swaps24h: number;
}

/** Price from (a) vibe/vibe API, else (b) V4 pool spot. Never invents a price. */
async function priceOf(client: PublicClient, token: TestnetToken, vibe: VibePrices | null) {
  const addr = token.address.toLowerCase();
  let eth: number | null = null;
  let usd: number | null = null;
  let priceSource: PriceSource = 'none';
  if (token.kind === 'crypto' && token.symbol === 'WETH') {
    eth = 1;
    priceSource = 'WETH = 1 ETH';
  } else if (vibe && vibe.usdByQuoteAddress[addr] !== undefined) {
    usd = vibe.usdByQuoteAddress[addr]!;
    eth = vibe.usdPerEth ? usd / vibe.usdPerEth : null;
    priceSource = 'vibe/vibe API';
  } else if (vibe && vibe.ethPerTokenByAddress[addr] !== undefined) {
    eth = vibe.ethPerTokenByAddress[addr]!;
    priceSource = 'vibe/vibe API';
  } else {
    const spot = await readPoolSpot(client, token).catch(() => null);
    if (spot?.ethPerToken) {
      eth = spot.ethPerToken;
      priceSource = 'V4 pool spot';
    }
  }
  if (usd === null && eth !== null && vibe?.usdPerEth) usd = eth * vibe.usdPerEth;
  return { eth, usd, priceSource };
}

/**
 * Market snapshot for many tokens: prices per token, plus 24h change and
 * volatility from one batched read of their pools' swap history.
 * 24h change is measured in ETH terms (the pools are ETH-paired).
 */
export async function marketSnapshot(
  client: PublicClient,
  tokens: readonly TestnetToken[],
  vibe: VibePrices | null,
): Promise<Map<string, TokenMarket>> {
  const pooled = tokens.filter((t) => t.pool);
  const [prices, histories] = await Promise.all([
    Promise.all(tokens.map((t) => priceOf(client, t, vibe))),
    historyContext(client)
      .then((ctx) => readSwapHistories(client, pooled, ctx).then((h) => ({ ctx, h })))
      .catch(() => null),
  ]);
  const spots = await Promise.all(pooled.map((t) => readPoolSpot(client, t).catch(() => null)));
  const live = new Set(pooled.filter((_, i) => spots[i]).map((t) => t.id));

  const out = new Map<string, TokenMarket>();
  tokens.forEach((t, i) => {
    const p = prices[i]!;
    let change24h: number | null = null;
    let volatility: number | null = null;
    let historySource: HistorySource = 'none';
    let swaps24h = 0;
    const pts = histories?.h.get(t.id);
    if (histories && pts && live.has(t.id)) {
      const inWindow = pts.filter((x) => x.t > histories.ctx.nowSec - 86400).length;
      if (pts.length === 0) {
        // V4 prices only move on swaps: no swaps in the whole window = unchanged
        change24h = 0;
        volatility = 0;
        historySource = 'V4 pool swaps (24h)';
      } else {
        const stats = priceStats(pts, histories.ctx.nowSec);
        change24h = stats.change24h;
        volatility = stats.volatility ?? (inWindow === 0 ? 0 : null);
        if (change24h !== null) historySource = 'V4 pool swaps (24h)';
      }
      swaps24h = inWindow;
    }
    out.set(t.id, { id: t.id, ...p, change24h, volatility, historySource, swaps24h });
  });
  return out;
}
