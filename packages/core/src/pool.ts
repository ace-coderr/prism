/**
 * Uniswap V4 helpers for ETH-paired pools (currency0 = native ETH), pure math only.
 * Used to price vibe/vibe test stocks from their pools and to derive 24h change
 * and volatility from real swap history.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { clamp } from './math';

export const NATIVE_ETH: Address = '0x0000000000000000000000000000000000000000';
/** Uniswap V4 PoolManager on Robinhood Chain Testnet, from https://testnet.vibevibe.fun/api/v1/chains/46630/config */
export const POOL_MANAGER: Address = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
/** StateLibrary.POOLS_SLOT in v4-core. */
export const POOLS_SLOT = 6n;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

const Q96 = 2n ** 96n;

/** keccak256(abi.encode(PoolKey)) — the V4 PoolId. */
export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Storage slot of Pool.State for `poolId` inside the PoolManager (read via extsload). */
export function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, POOLS_SLOT]));
}

/** Unpack sqrtPriceX96 (low 160 bits) from the packed slot0 word. */
export function sqrtPriceFromSlot0(slot0: Hex | bigint): bigint {
  const v = typeof slot0 === 'bigint' ? slot0 : BigInt(slot0);
  return v & ((1n << 160n) - 1n);
}

/**
 * ETH per token for an ETH/token pool (ETH is currency0).
 * sqrtPriceX96² / 2⁹⁶² = raw token1 per raw token0 (tokens per ETH, before decimals).
 */
export function ethPerToken(sqrtPriceX96: bigint, tokenDecimals: number): number | null {
  if (sqrtPriceX96 <= 0n) return null;
  const s = Number(sqrtPriceX96) / Number(Q96);
  const tokensPerEth = s * s * 10 ** (18 - tokenDecimals);
  return tokensPerEth > 0 ? 1 / tokensPerEth : null;
}

/**
 * In-range virtual reserves for liquidity L at the current price:
 * eth = L / √P, token = L · √P (raw units → human with decimals).
 */
export function virtualReserves(liquidity: bigint, sqrtPriceX96: bigint, tokenDecimals: number) {
  const s = Number(sqrtPriceX96) / Number(Q96);
  const L = Number(liquidity);
  if (s <= 0) return { eth: 0, token: 0 };
  return { eth: L / s / 1e18, token: (L * s) / 10 ** tokenDecimals };
}

/**
 * ETH needed to push the token price up by `pct` (e.g. 0.02 = 2%), assuming the
 * current liquidity stays in range. A rough depth gauge, not a quote.
 */
export function ethToMovePrice(liquidity: bigint, sqrtPriceX96: bigint, pct: number): number {
  const s = Number(sqrtPriceX96) / Number(Q96);
  if (s <= 0) return 0;
  // token price in ETH = 1/s² ; raising it by pct means s' = s / √(1+pct). ΔETH = L·(1/s' − 1/s)
  const s2 = s / Math.sqrt(1 + pct);
  return (Number(liquidity) * (1 / s2 - 1 / s)) / 1e18;
}

export interface PricePoint {
  /** unix seconds */
  t: number;
  /** price in any fixed unit (ETH per token here) */
  price: number;
}

/** Daily stdev of log returns at which volatility saturates to 1 for the crystal. */
export const VOLATILITY_FULL_DAILY = 0.1;

/**
 * 24h change and a 0..1 volatility from a price history.
 * - change24h: last price vs the price in effect 24h before `nowSec` (the latest
 *   point at or before that moment, else the first point inside the window).
 * - volatility: stdev of hourly log returns (last-price-per-hour, forward-filled),
 *   scaled to a daily figure, mapped so VOLATILITY_FULL_DAILY → 1.
 * Returns nulls when there is not enough data.
 */
export function priceStats(points: PricePoint[], nowSec: number) {
  const pts = points.filter((p) => p.price > 0 && Number.isFinite(p.price)).sort((a, b) => a.t - b.t);
  if (pts.length === 0) return { change24h: null, volatility: null, dailyVol: null, samples: 0 };
  const start = nowSec - 86400;
  const before = pts.filter((p) => p.t <= start);
  const ref = before.length ? before[before.length - 1]! : pts[0]!;
  const last = pts[pts.length - 1]!;
  const change24h = ref === last && before.length === 0 && pts.length === 1 ? null : ((last.price - ref.price) / ref.price) * 100;

  // hourly closes over the 24h window, forward-filled from the reference price
  const closes: number[] = [];
  let k = 0;
  let cur = ref.price;
  for (let h = 1; h <= 24; h++) {
    const edge = start + h * 3600;
    while (k < pts.length && pts[k]!.t <= edge) {
      if (pts[k]!.t > start) cur = pts[k]!.price;
      k++;
    }
    closes.push(cur);
  }
  const rets: number[] = [];
  let prev = ref.price;
  for (const c of closes) {
    rets.push(Math.log(c / prev));
    prev = c;
  }
  const inWindow = pts.filter((p) => p.t > start).length;
  if (inWindow < 2) return { change24h, volatility: null, dailyVol: null, samples: inWindow };
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const dailyVol = Math.sqrt(variance) * Math.sqrt(24);
  return {
    change24h,
    volatility: clamp(dailyVol / VOLATILITY_FULL_DAILY, 0, 1),
    dailyVol,
    samples: inWindow,
  };
}
