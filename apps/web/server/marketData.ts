/**
 * GET /api/market?token=0x…: a launch's or test stock's market details, read from the chain only
 * (@prism/core market.ts): price and market cap (in its pair, ETH and USD at the real ETH price from
 * Chainlink on Robinhood Chain mainnet), progress, liquidity, holders and the last 24h (volume,
 * change, buys and sells). Cached in memory for a minute (holder balances are kept and only new
 * blocks are read) and by the CDN for a few minutes.
 */
import type { Address } from 'viem';
import {
  POOL_MANAGER,
  TESTNET_TOKENS,
  blocksPerDay,
  constantProductDayChange,
  dayStats,
  ethPerUnit,
  holderCount,
  poolPrice,
  poolPriceBefore,
  readCurveTrades,
  readEthUsd,
  readMarketState,
  readPoolTrades,
  readStockState,
  readTransfers,
  v6CurveCap,
  v6DayChange,
  type Launch,
  type MarketState,
  type MarketSubject,
  type ReviewableAsset,
  type Trade,
} from '@prism/core';
import { client, mainnetClient } from './chain';

export interface MarketBody {
  token: Address;
  status: 'curve' | 'graduated' | 'stock';
  /** 0..1 of the graduation target raised (curves), 1 once graduated, null for stocks */
  progress: number | null;
  pair: { symbol: string; address: Address | null; decimals: number };
  /** ETH per whole pair token (1 for ETH), null when PRISM can't price the pair */
  ethPerPair: number | null;
  /** market cap in the pair's base units */
  cap: string | null;
  capEth: number | null;
  priceEth: number | null;
  /** both sides of the pool, in ETH (graduated launches and stocks) */
  liquidityEth: number | null;
  /** the real ETH price (Chainlink ETH / USD on Robinhood Chain mainnet), null if unavailable or stale */
  usdPerEth: number | null;
  /** addresses holding some, minus the curve, the pool manager, the token itself (its reward pool) and burn addresses (null: not counted, e.g. test stocks) */
  holders: number | null;
  day: { volume: string; volumeEth: number | null; buys: number; sells: number; change: number | null } | null;
  block: number;
  updatedAt: number;
}

const memo = <T>(ms: number, f: () => Promise<T>) => {
  let v: { at: number; p: Promise<T> } | null = null;
  return () => {
    if (!v || Date.now() - v.at > ms) {
      const p = f().catch((e) => {
        v = null;
        throw e;
      });
      v = { at: Date.now(), p };
    }
    return v.p;
  };
};
/** Dollars per ETH (Chainlink, mainnet), cached 5 minutes. */
export const usd = memo(5 * 60_000, () => readEthUsd(mainnetClient));
const head = memo(15_000, () => client.getBlockNumber());
let dayBlocks: { at: number; n: bigint } | null = null;
async function blocksInDay(h: bigint) {
  if (!dayBlocks || Date.now() - dayBlocks.at > 30 * 60_000) dayBlocks = { at: Date.now(), n: await blocksPerDay(client, h) };
  return dayBlocks.n;
}
const pairPrices = new Map<string, { at: number; p: Promise<number | null> }>();
/** Whole ETH per base unit of a pair (ETH, a test stock or WETH); null for other pairs. */
export function ethPerPairUnit(pair: Address | null): Promise<number | null> {
  if (!pair) return Promise.resolve(1e-18); // wei
  const t = TESTNET_TOKENS.find((x) => x.address.toLowerCase() === pair.toLowerCase());
  if (!t) return Promise.resolve(null); // another launch's token: not priced in ETH
  const hit = pairPrices.get(t.id);
  if (hit && Date.now() - hit.at < 2 * 60_000) return hit.p;
  const p = ethPerUnit(client, t).catch(() => null);
  pairPrices.set(t.id, { at: Date.now(), p });
  return p;
}

/** Holder balances per token, kept between requests: each read only adds the new blocks. */
const holders = new Map<string, { toBlock: bigint; balances: Map<string, bigint> }>();
async function holdersOf(token: Address, from: bigint, to: bigint, exclude: string[]): Promise<number> {
  const key = token.toLowerCase();
  const prev = holders.get(key);
  const start = prev ? prev.toBlock + 1n : from;
  const balances = await readTransfers(client, token, start, to, prev ? new Map(prev.balances) : new Map());
  holders.set(key, { toBlock: to, balances });
  if (holders.size > 2000) holders.delete(holders.keys().next().value!);
  return holderCount(balances, exclude);
}

const results = new Map<string, { at: number; p: Promise<MarketBody> }>();

export function marketOf(asset: ReviewableAsset, launch: Launch | null): Promise<MarketBody> {
  const key = asset.token.toLowerCase();
  const hit = results.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = read(asset, launch).catch((e) => {
    results.delete(key);
    throw e;
  });
  results.set(key, { at: Date.now(), p });
  if (results.size > 2000) results.delete(results.keys().next().value!);
  return p;
}

const toEth = (base: bigint | null, ethPerUnit: number | null) => (base === null || ethPerUnit === null ? null : Number(base) * ethPerUnit);

async function read(asset: ReviewableAsset, launch: Launch | null): Promise<MarketBody> {
  const h = await head();
  const day = await blocksInDay(h);
  const windowStart = h - day;
  const stock = asset.kind === 'stock' ? TESTNET_TOKENS.find((t) => t.address.toLowerCase() === asset.token.toLowerCase()) ?? null : null;
  const pair: Address | null = stock ? null : (asset.quote?.address ?? null);
  const pairInfo = {
    symbol: stock ? 'ETH' : (asset.quote?.symbol ?? 'ETH'),
    address: pair,
    decimals: pair ? (TESTNET_TOKENS.find((t) => t.address.toLowerCase() === pair.toLowerCase())?.decimals ?? 18) : 18,
  };
  const subject: MarketSubject = {
    token: asset.token,
    kind: asset.kind,
    gen: launch?.gen,
    curve: launch?.curve,
    block: launch?.block,
    graduatedBlock: launch?.graduatedBlock ?? null,
    pair,
    pairDecimals: pairInfo.decimals,
  };

  const [state, usdEth, pairEth] = await Promise.all([
    stock ? readStockState(client, stock) : readMarketState(client, subject),
    usd().catch(() => null),
    ethPerPairUnit(pair),
  ]);

  const launchBlock = launch ? BigInt(launch.block) : 0n;
  const from = windowStart > launchBlock ? windowStart : launchBlock;
  const gradBlock = launch?.graduatedBlock != null ? BigInt(launch.graduatedBlock) : null;
  // the curve traded in the window unless it graduated before it started
  const curveInWindow = !!launch && (state.status === 'curve' || gradBlock === null || gradBlock >= windowStart);
  const [curveTrades, swaps, holderN] = await Promise.all([
    curveInWindow ? readCurveTrades(client, subject, from, h).catch(() => null) : Promise.resolve([] as Trade[]),
    state.poolId && state.sqrtPriceX96 ? readPoolTrades(client, state.poolId, asset.token, pair, from, h).catch(() => null) : Promise.resolve([]),
    launch ? holdersOf(asset.token, launchBlock, h, [launch.curve, POOL_MANAGER, asset.token]).catch(() => null) : Promise.resolve(null),
  ]);

  let day24: MarketBody['day'] = null;
  if (curveTrades && swaps) {
    const trades = [...curveTrades, ...swaps.map((s) => s.trade)];
    const change = await dayChange(state, asset.token, pair, launch, curveTrades, swaps, windowStart, day, gradBlock ?? launchBlock).catch(() => null);
    const d = dayStats(trades, change);
    day24 = { volume: d.volume.toString(), volumeEth: toEth(d.volume, pairEth), buys: d.buys, sells: d.sells, change: d.change };
  }

  const capEth = toEth(state.cap, pairEth);
  const supplyTokens = state.supply !== null ? Number(state.supply) / 1e18 : null;
  return {
    token: asset.token,
    status: state.status,
    progress: state.status === 'stock' ? null : state.progress,
    pair: pairInfo,
    ethPerPair: pairEth === null ? null : pairEth * 10 ** pairInfo.decimals,
    cap: state.cap?.toString() ?? null,
    capEth,
    priceEth: capEth !== null && supplyTokens ? capEth / supplyTokens : null,
    liquidityEth: toEth(state.liquidity, pairEth),
    usdPerEth: usdEth,
    holders: holderN,
    day: day24,
    block: Number(h),
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * The 24h change as a fraction. On a curve it is exact: the curve's state 24h ago is rebuilt from
 * the trades since. In a pool, it compares with the last swap before the window (or, if it graduated
 * inside the window, a v6 curve's price before then).
 */
async function dayChange(
  state: MarketState,
  token: Address,
  pair: Address | null,
  launch: Launch | null,
  curveTrades: Trade[],
  swaps: Array<{ trade: Trade; sqrtPriceX96: bigint }>,
  windowStart: bigint,
  day: bigint,
  floor: bigint,
): Promise<number | null> {
  if (curveTrades.length === 0 && swaps.length === 0) return 0;
  if (state.status === 'curve') {
    if (launch?.gen === 6) return state.sold !== null && state.target !== null ? v6DayChange(state.sold, state.target, curveTrades) : null;
    return state.tokenReserve !== null ? constantProductDayChange(state.tokenReserve, curveTrades) : null;
  }
  if (!state.sqrtPriceX96) return null;
  const now = poolPrice(state.sqrtPriceX96, token, pair);
  // graduated inside the window (v6): the curve's price at the window start, from its trades
  if (launch?.gen === 6 && curveTrades.length > 0 && state.sold !== null && state.target !== null && state.supply) {
    let soldThen = state.sold;
    for (const t of curveTrades) soldThen += t.side === 'buy' ? -t.tokens : t.tokens;
    const capThen = v6CurveCap(soldThen < 0n ? 0n : soldThen, state.target);
    const capNow = state.cap;
    return capThen && capNow ? Number(capNow - capThen) / Number(capThen) : null;
  }
  // the last swap before the window (up to a week back); else the first swap inside it
  const ref = (await poolPriceBefore(client, state.poolId!, windowStart - 1n, 7n * day, floor)) ?? swaps[0]?.sqrtPriceX96 ?? null;
  if (!ref) return null;
  const then = poolPrice(ref, token, pair);
  return then > 0 ? now / then - 1 : null;
}
