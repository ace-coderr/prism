/**
 * Market details for a launch or a test stock, read from the chain only (public RPC, read-only):
 *
 * - On its curve: v6 curves report `sold`, `pairPrincipal` and `targetPairUnits`; market cap is
 *   vibe/vibe's curve formula 80·T·S² / (16·S − 15·sold)² (S = 1B tokens, T = the target), progress
 *   is pairPrincipal / T. Gen 0/1/2 curves report `fdvWei`, `realEthReserve` and
 *   `NET_GRADUATION_TARGET` themselves.
 * - Graduated (and test stocks): the Uniswap V4 pool's price (PoolManager.extsload), market cap =
 *   price × total supply, liquidity = both sides of the in-range position.
 * - 24h: the curve's own trade events (v6 CurveBuy/CurveSell, gen 0/1/2 Bought/Sold) and the pool's
 *   Swap events. The change is exact on a curve (the curve state 24h ago is rebuilt from the trades
 *   since), and from the last swap before the window in a pool.
 * - Holders: every Transfer of the token since its launch; addresses with a balance, minus the
 *   curve, the PoolManager, the token itself (v6 tokens hold their holder rewards) and the zero
 *   and dead addresses.
 * - USD: the real ETH price, from Chainlink's ETH / USD feed on Robinhood Chain mainnet (ETH_USD_FEED).
 *
 * The maths is pure and tested; the readers take a viem PublicClient.
 */
import { encodeAbiParameters, keccak256, parseAbi, parseAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import { blockRanges } from './onchain';
import { AGGREGATOR_V3_ABI, type TestnetToken } from './tokens';

export const POOL_MANAGER: Address = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
/** StateLibrary.POOLS_SLOT in v4-core. */
const POOLS_SLOT = 6n;
const NATIVE: Address = '0x0000000000000000000000000000000000000000';
const DEAD: Address = '0x000000000000000000000000000000000000dEaD';
/** A v6 launch's supply, as vibe/vibe's formula uses it: 1B tokens of 18 decimals. */
export const V6_SUPPLY = 10n ** 27n;
const Q96 = 2n ** 96n;
const Q192 = 2n ** 192n;

// ------------------------------------------------------------------ pure maths

/** vibe/vibe's v6 curve market cap, in the pair's base units: 80·T·S² / (16·S − 15·sold)². */
export function v6CurveCap(sold: bigint, target: bigint, supply = V6_SUPPLY): bigint | null {
  const n = 16n * supply - 15n * sold;
  if (target <= 0n || n <= 0n) return null;
  return (80n * target * supply * supply) / (n * n);
}

/** keccak256(abi.encode(PoolKey)): a V4 pool's id. */
export function poolIdOf(key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Storage slot of a pool's state inside the PoolManager (read with extsload). */
export const poolStateSlot = (poolId: Hex): Hex => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, POOLS_SLOT]));

/** In a V4 pool, currency0 is the lower address (native ETH, address 0, is always currency0). */
export const tokenIsCurrency1 = (token: Address, pair: Address | null) => token.toLowerCase() > (pair ?? NATIVE).toLowerCase();

/** Market cap in the pair's base units from a pool price: supply × (pair per token). */
export function poolCap(sqrtPriceX96: bigint, token: Address, pair: Address | null, supply: bigint): bigint | null {
  if (sqrtPriceX96 <= 0n) return null;
  const p2 = sqrtPriceX96 * sqrtPriceX96;
  return tokenIsCurrency1(token, pair) ? (supply * Q192) / p2 : (supply * p2) / Q192;
}

/** The pair side of an in-range position (base units): what the pool holds of the pair, roughly. */
export function poolPairReserve(liquidity: bigint, sqrtPriceX96: bigint, token: Address, pair: Address | null): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  return tokenIsCurrency1(token, pair) ? (liquidity * Q96) / sqrtPriceX96 : (liquidity * sqrtPriceX96) / Q96;
}

/** Pair base units per token base unit, as a float, from a pool price. */
export function poolPrice(sqrtPriceX96: bigint, token: Address, pair: Address | null): number {
  const s = Number(sqrtPriceX96) / Number(Q96);
  const p = s * s;
  return tokenIsCurrency1(token, pair) ? (p > 0 ? 1 / p : 0) : p;
}

export const ratio = (part: bigint, whole: bigint) => (whole > 0n ? Math.min(1, Number((part * 10000n) / whole) / 10000) : null);

/** A trade, normalized: pair amount (base units), tokens (base units), side. */
export interface Trade {
  block: number;
  side: 'buy' | 'sell';
  pair: bigint;
  tokens: bigint;
}

/** 24h figures from the trades in the window. `change` is a fraction (0.12 = +12%), null if unknown. */
export interface DayStats {
  volume: bigint;
  buys: number;
  sells: number;
  change: number | null;
}

/** v6 curve 24h change: the cap now vs the cap at `sold` before the window's trades. */
export function v6DayChange(soldNow: bigint, target: bigint, trades: readonly Trade[]): number | null {
  let soldThen = soldNow;
  for (const t of trades) soldThen += t.side === 'buy' ? -t.tokens : t.tokens;
  if (soldThen < 0n) soldThen = 0n;
  const now = v6CurveCap(soldNow, target);
  const then = v6CurveCap(soldThen, target);
  return now !== null && then !== null && then > 0n ? Number(now - then) / Number(then) : null;
}

/** Gen 0/1/2 curve (constant product): price ∝ 1/tokenReserve², and the window's trades moved the reserve. */
export function constantProductDayChange(tokenReserveNow: bigint, trades: readonly Trade[]): number | null {
  let then = tokenReserveNow;
  for (const t of trades) then += t.side === 'buy' ? t.tokens : -t.tokens;
  if (then <= 0n || tokenReserveNow <= 0n) return null;
  const r = Number(then) / Number(tokenReserveNow);
  return r * r - 1;
}

export function dayStats(trades: readonly Trade[], change: number | null): DayStats {
  let volume = 0n;
  let buys = 0;
  let sells = 0;
  for (const t of trades) {
    volume += t.pair;
    if (t.side === 'buy') buys++;
    else sells++;
  }
  return { volume, buys, sells, change: trades.length === 0 ? 0 : change };
}

/** Balances from Transfer events (in order), then how many addresses hold some, minus `exclude`. */
export function applyTransfers(balances: Map<string, bigint>, transfers: ReadonlyArray<{ from: string; to: string; value: bigint }>) {
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (from !== NATIVE) balances.set(from, (balances.get(from) ?? 0n) - t.value);
    balances.set(to, (balances.get(to) ?? 0n) + t.value);
  }
}

export function holderCount(balances: ReadonlyMap<string, bigint>, exclude: readonly string[]): number {
  const skip = new Set([NATIVE, DEAD.toLowerCase(), ...exclude.map((a) => a.toLowerCase())]);
  let n = 0;
  for (const [a, b] of balances) if (b > 0n && !skip.has(a)) n++;
  return n;
}

// ------------------------------------------------------------------ chain reads

const extsloadAbi = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)']);
const erc20 = parseAbi(['function totalSupply() view returns (uint256)']);
const v6Curve = parseAbi([
  'function sold() view returns (uint120)',
  'function pairPrincipal() view returns (uint128)',
  'function targetPairUnits() view returns (uint256)',
  'function complete() view returns (bool)',
  'function poolId() view returns (bytes32)',
]);
const feeCurve = parseAbi([
  'function fdvWei() view returns (uint256)',
  'function realEthReserve() view returns (uint256)',
  'function NET_GRADUATION_TARGET() view returns (uint256)',
  'function virtualTokenReserve() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function graduatedPoolId() view returns (bytes32)',
]);

export const EVENTS = {
  transfer: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
  v6Buy: parseAbiItem('event CurveBuy(address indexed buyer, address indexed recipient, uint256 grossTokens, uint256 netTokens, uint256 tokenFee, uint256 pairCost, uint256 pairFee, uint256 rateBps)'),
  v6Sell: parseAbiItem('event CurveSell(address indexed seller, address indexed recipient, uint256 grossTokens, uint256 netTokens, uint256 tokenFee, uint256 pairProceeds, uint256 pairFee)'),
  bought: parseAbiItem('event Bought(address indexed buyer, address indexed recipient, uint256 grossEthUsed, uint256 curveQuote, uint256 tokenAmount, uint256 creatorFee, uint256 protocolFee)'),
  sold: parseAbiItem('event Sold(address indexed seller, uint256 tokenAmount, uint256 grossCurveQuote, uint256 ethReceived, uint256 creatorFee, uint256 protocolFee)'),
  swap: parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)'),
} as const;

/** The public RPC answers getLogs with an address over at most 100k blocks. */
const LOG_BLOCKS = 100_000n;

/** Run `jobs` with at most `n` at a time, in order. */
async function pool<T>(jobs: Array<() => Promise<T>>, n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]!();
      }
    }),
  );
  return out;
}

type AnyEvent = (typeof EVENTS)[keyof typeof EVENTS];

type Log = { eventName: string; args: Record<string, unknown>; blockNumber: bigint; logIndex: number };
const TOO_MANY = /exceeds limit|too many|too large|response size/i;

/** One getLogs call; a range with more logs than the node returns is halved until it fits. */
async function logsIn(client: PublicClient, address: Address, events: readonly AnyEvent[], a: bigint, b: bigint, args?: Record<string, unknown>): Promise<Log[]> {
  try {
    // a single event can filter on its indexed args; several can't
    const q = events.length === 1 ? { event: events[0] as AnyEvent, args: args as never } : { events: events as AnyEvent[] };
    return (await client.getLogs({ address, ...q, fromBlock: a, toBlock: b, strict: true } as never)) as unknown as Log[];
  } catch (e) {
    const text = `${(e as Error).message} ${(e as { details?: string }).details ?? ''}`;
    if (b <= a || !TOO_MANY.test(text)) throw e;
    const m = (a + b) / 2n;
    return [...(await logsIn(client, address, events, a, m, args)), ...(await logsIn(client, address, events, m + 1n, b, args))];
  }
}

/** Logs of one or more events at `address` over [from, to], 100k blocks a call, a few calls at once. */
async function logsOf(client: PublicClient, address: Address, events: readonly AnyEvent[], from: bigint, to: bigint, args?: Record<string, unknown>) {
  if (to < from) return [];
  const chunks = await pool(
    blockRanges(from, to, LOG_BLOCKS).map(([a, b]) => () => logsIn(client, address, events, a, b, args)),
    10,
  );
  return chunks.flat();
}

/** A V4 pool's price and in-range liquidity. */
export async function readPool(client: PublicClient, poolId: Hex): Promise<{ sqrtPriceX96: bigint; liquidity: bigint } | null> {
  const slot = poolStateSlot(poolId);
  const liqSlot = `0x${(BigInt(slot) + 3n).toString(16).padStart(64, '0')}` as Hex;
  const r = await client.multicall({
    contracts: [
      { address: POOL_MANAGER, abi: extsloadAbi, functionName: 'extsload', args: [slot] },
      { address: POOL_MANAGER, abi: extsloadAbi, functionName: 'extsload', args: [liqSlot] },
    ],
    allowFailure: false,
  });
  const sqrtPriceX96 = BigInt(r[0]) & ((1n << 160n) - 1n);
  return sqrtPriceX96 === 0n ? null : { sqrtPriceX96, liquidity: BigInt(r[1]) & ((1n << 128n) - 1n) };
}

/** ETH per base unit of a test token with an ETH pool (WETH = 1), else null. */
export async function ethPerUnit(client: PublicClient, t: TestnetToken): Promise<number | null> {
  if (t.id === 'WETH') return 1;
  if (!t.pool) return null;
  const p = await readPool(client, poolIdOf({ currency0: NATIVE, currency1: t.address, ...t.pool })).catch(() => null);
  // currency0 = ETH: price = token1 per token0, so ETH per token unit is its inverse
  return p ? 1 / poolPrice(p.sqrtPriceX96, NATIVE, t.address) : null;
}

/**
 * The real ETH/USD price: Chainlink's ETH / USD feed on Robinhood Chain mainnet (chain 4663), read
 * with a plain eth_call. Address from Chainlink's own feed directory for Robinhood Chain mainnet
 * (https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json, the data behind
 * https://data.chain.link): "ETH / USD", path eth-usd-shared-svr, 8 decimals, 24h heartbeat.
 * Testnet tokens have no real value; this only turns their ETH figures into familiar dollars.
 */
export const ETH_USD_FEED = {
  chainId: 4663,
  proxy: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9' as Address,
  heartbeatSec: 86_400,
  source: 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json',
} as const;

/** A Chainlink answer as a price, or null if it isn't positive or is older than two heartbeats. */
export function ethUsdFromRound(answer: bigint, decimals: number, updatedAt: bigint, nowSec = Math.floor(Date.now() / 1000)): number | null {
  if (answer <= 0n || decimals < 0 || decimals > 36) return null;
  if (nowSec - Number(updatedAt) > 2 * ETH_USD_FEED.heartbeatSec) return null;
  return Number(answer) / 10 ** decimals;
}

/** USD per ETH from the Chainlink feed above; `mainnet` must be a Robinhood Chain mainnet client. */
export async function readEthUsd(mainnet: PublicClient): Promise<number | null> {
  const [decimals, round] = await Promise.all([
    mainnet.readContract({ address: ETH_USD_FEED.proxy, abi: AGGREGATOR_V3_ABI, functionName: 'decimals' }),
    mainnet.readContract({ address: ETH_USD_FEED.proxy, abi: AGGREGATOR_V3_ABI, functionName: 'latestRoundData' }),
  ]);
  return ethUsdFromRound(round[1], Number(decimals), round[3]);
}

/** Blocks in the last 24h, measured from the chain's own clock. */
export async function blocksPerDay(client: PublicClient, head: bigint): Promise<bigint> {
  const span = 200_000n;
  const [a, b] = await Promise.all([client.getBlock({ blockNumber: head }), client.getBlock({ blockNumber: head - span })]);
  const secs = Number(a.timestamp - b.timestamp);
  return secs > 0 ? BigInt(Math.round((86400 * Number(span)) / secs)) : 700_000n;
}

/** What a market reader needs to know about the asset. */
export interface MarketSubject {
  token: Address;
  kind: 'launch' | 'stock';
  /** launches */
  gen?: 0 | 1 | 2 | 6;
  curve?: Address;
  block?: number;
  graduatedBlock?: number | null;
  /** null = ETH */
  pair: Address | null;
  pairDecimals: number;
}

export interface MarketState {
  status: 'curve' | 'graduated' | 'stock';
  /** 0..1, curves only (graduated = 1) */
  progress: number | null;
  /** market cap and liquidity in the pair's base units */
  cap: bigint | null;
  liquidity: bigint | null;
  supply: bigint | null;
  poolId: Hex | null;
  sqrtPriceX96: bigint | null;
  /** v6 */
  sold: bigint | null;
  target: bigint | null;
  /** gen 0/1/2 */
  tokenReserve: bigint | null;
}

/** The asset's state right now: one multicall, plus the pool when it has one. */
export async function readMarketState(client: PublicClient, s: MarketSubject): Promise<MarketState> {
  const base: MarketState = { status: 'curve', progress: null, cap: null, liquidity: null, supply: null, poolId: null, sqrtPriceX96: null, sold: null, target: null, tokenReserve: null };
  const supply = await client.readContract({ address: s.token, abi: erc20, functionName: 'totalSupply' }).catch(() => null);
  const fromPool = async (poolId: Hex | null, status: MarketState['status'], st: MarketState): Promise<MarketState> => {
    const p = poolId && !/^0x0{64}$/.test(poolId) ? await readPool(client, poolId).catch(() => null) : null;
    if (!p) return { ...st, status, poolId, progress: status === 'graduated' ? 1 : null, supply };
    return {
      ...st,
      status,
      poolId,
      progress: status === 'graduated' ? 1 : null,
      supply,
      sqrtPriceX96: p.sqrtPriceX96,
      cap: supply !== null ? poolCap(p.sqrtPriceX96, s.token, s.pair, supply) : null,
      liquidity: 2n * poolPairReserve(p.liquidity, p.sqrtPriceX96, s.token, s.pair),
    };
  };
  if (s.kind === 'stock' || !s.curve) return { ...base, status: 'stock', supply }; // stocks: readStockState
  if (s.gen === 6) {
    const r = await client.multicall({
      contracts: (['sold', 'pairPrincipal', 'targetPairUnits', 'complete', 'poolId'] as const).map((functionName) => ({ address: s.curve!, abi: v6Curve, functionName })),
      allowFailure: true,
    });
    const [sold, principal, target, complete, poolId] = r.map((x) => (x.status === 'success' ? x.result : null)) as [bigint | null, bigint | null, bigint | null, boolean | null, Hex | null];
    const st = { ...base, sold, target, supply };
    if (complete) return fromPool(poolId, 'graduated', st);
    return { ...st, status: 'curve', progress: principal !== null && target !== null ? ratio(principal, target) : null, cap: sold !== null && target !== null ? v6CurveCap(sold, target) : null };
  }
  const r = await client.multicall({
    contracts: (['fdvWei', 'realEthReserve', 'NET_GRADUATION_TARGET', 'virtualTokenReserve', 'graduated', 'graduatedPoolId'] as const).map((functionName) => ({ address: s.curve!, abi: feeCurve, functionName })),
    allowFailure: true,
  });
  const [fdv, real, target, vTok, graduated, poolId] = r.map((x) => (x.status === 'success' ? x.result : null)) as [bigint | null, bigint | null, bigint | null, bigint | null, boolean | null, Hex | null];
  const st = { ...base, tokenReserve: vTok, supply };
  if (graduated) return fromPool(poolId, 'graduated', st);
  return { ...st, status: 'curve', progress: real !== null && target !== null ? ratio(real, target) : null, cap: fdv };
}

/** A test stock's state: its ETH pool. */
export async function readStockState(client: PublicClient, t: TestnetToken): Promise<MarketState> {
  const supply = await client.readContract({ address: t.address, abi: erc20, functionName: 'totalSupply' }).catch(() => null);
  const empty: MarketState = { status: 'stock', progress: null, cap: null, liquidity: null, supply, poolId: null, sqrtPriceX96: null, sold: null, target: null, tokenReserve: null };
  if (!t.pool) return empty;
  const poolId = poolIdOf({ currency0: NATIVE, currency1: t.address, ...t.pool });
  const p = await readPool(client, poolId).catch(() => null);
  if (!p) return { ...empty, poolId };
  return {
    ...empty,
    poolId,
    sqrtPriceX96: p.sqrtPriceX96,
    cap: supply !== null ? poolCap(p.sqrtPriceX96, t.address, null, supply) : null,
    liquidity: 2n * poolPairReserve(p.liquidity, p.sqrtPriceX96, t.address, null),
  };
}

/** The curve's trades in [from, to] (v6 or gen 0/1/2 events). */
export async function readCurveTrades(client: PublicClient, s: MarketSubject, from: bigint, to: bigint): Promise<Trade[]> {
  if (!s.curve) return [];
  const v6 = s.gen === 6;
  const logs = await logsOf(client, s.curve, v6 ? [EVENTS.v6Buy, EVENTS.v6Sell] : [EVENTS.bought, EVENTS.sold], from, to);
  return logs.map((l): Trade => {
    const a = l.args as Record<string, bigint>;
    const block = Number(l.blockNumber);
    if (l.eventName === 'CurveBuy') return { block, side: 'buy', pair: a.pairCost!, tokens: a.grossTokens! };
    if (l.eventName === 'CurveSell') return { block, side: 'sell', pair: a.pairProceeds!, tokens: a.grossTokens! };
    if (l.eventName === 'Bought') return { block, side: 'buy', pair: a.curveQuote!, tokens: a.tokenAmount! };
    return { block, side: 'sell', pair: a.grossCurveQuote!, tokens: a.tokenAmount! };
  });
}

/**
 * A pool's swaps in [from, to] as trades (the swapper's delta: paying the pair = buying the token),
 * with the price after each.
 */
export async function readPoolTrades(client: PublicClient, poolId: Hex, token: Address, pair: Address | null, from: bigint, to: bigint) {
  const logs = await logsOf(client, POOL_MANAGER, [EVENTS.swap], from, to, { id: poolId });
  const tokenIs1 = tokenIsCurrency1(token, pair);
  return logs
    .sort((x, y) => Number(x.blockNumber - y.blockNumber) || x.logIndex - y.logIndex)
    .map((l) => {
      const a = l.args as { amount0: bigint; amount1: bigint; sqrtPriceX96: bigint };
      const pairDelta = tokenIs1 ? a.amount0 : a.amount1;
      const tokenDelta = tokenIs1 ? a.amount1 : a.amount0;
      const trade: Trade = { block: Number(l.blockNumber), side: pairDelta < 0n ? 'buy' : 'sell', pair: pairDelta < 0n ? -pairDelta : pairDelta, tokens: tokenDelta < 0n ? -tokenDelta : tokenDelta };
      return { trade, sqrtPriceX96: a.sqrtPriceX96 };
    });
}

/** The price in effect at `block`: the last swap at or before it, looking back at most `lookback` blocks. */
export async function poolPriceBefore(client: PublicClient, poolId: Hex, block: bigint, lookback: bigint, floor: bigint): Promise<bigint | null> {
  const step = LOG_BLOCKS * 4n;
  for (let to = block; to > floor && block - to < lookback; to -= step) {
    const from = to - step + 1n > floor ? to - step + 1n : floor;
    const logs = await logsOf(client, POOL_MANAGER, [EVENTS.swap], from, to, { id: poolId });
    if (logs.length) {
      const last = logs.sort((x, y) => Number(x.blockNumber - y.blockNumber) || x.logIndex - y.logIndex).at(-1)!;
      return (last.args as { sqrtPriceX96: bigint }).sqrtPriceX96;
    }
  }
  return null;
}

/**
 * Holder balances from every Transfer of `token` in [from, to], added onto `balances` (pass the
 * previous result and the next block to update incrementally).
 */
export async function readTransfers(client: PublicClient, token: Address, from: bigint, to: bigint, balances = new Map<string, bigint>()) {
  const logs = await logsOf(client, token, [EVENTS.transfer], from, to);
  logs.sort((x, y) => Number(x.blockNumber - y.blockNumber) || x.logIndex - y.logIndex);
  applyTransfers(
    balances,
    logs.map((l) => {
      const a = l.args as { from: string; to: string; value: bigint };
      return { from: a.from, to: a.to, value: a.value };
    }),
  );
  return balances;
}

export { NATIVE as NATIVE_ETH, DEAD as DEAD_ADDRESS };
