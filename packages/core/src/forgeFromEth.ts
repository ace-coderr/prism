/**
 * Forge from ETH: the PrismForgeRouter's fixed settings, Uniswap V4 quotes for "this
 * much ETH buys about this much stock", price impact, and how a single ETH amount is
 * split across the chosen tokens. Pure helpers + read-only quoting (eth_call only).
 */
import type { Address, PublicClient } from 'viem';
import { formatAmount, slippageText } from './errors';
import { POOL_MANAGER } from './pool';
import { BASKET_TOKENS, type TestnetToken } from './tokens';

/**
 * Uniswap V4 periphery on Robinhood Chain Testnet (46630), from vibe/vibe's published
 * deployment config for the chain (verified on-chain 2026-10-04: code at each address,
 * and the quoter quotes every test-stock pool).
 */
export const V4_QUOTER: Address = '0x498928d32bf7649587C4C2D2944038500644c950';
export const UNIVERSAL_ROUTER: Address = '0x8876789976dEcBfCbBbe364623C63652db8C0904';
export const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/** Every test stock's ETH pool: 0.3% fee, tick spacing 60, no hooks. */
export const ROUTER_POOL = { fee: 3000, tickSpacing: 60 } as const;
const ZERO: Address = '0x0000000000000000000000000000000000000000';

/** The tokens the router accepts: the test stocks + pre-IPO assets with an ETH pool, in Forge order. */
export const ROUTER_TOKENS: readonly TestnetToken[] = ['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI']
  .map((id) => BASKET_TOKENS.find((t) => t.id === id))
  .filter(
    (t): t is TestnetToken =>
      !!t && !!t.pool && t.pool.fee === ROUTER_POOL.fee && t.pool.tickSpacing === ROUTER_POOL.tickSpacing && t.pool.hooks === ZERO,
  );

/** Constructor arguments for deploying PrismForgeRouter against a PrismCrystal. */
export function routerDeployArgs(crystal: Address): readonly [Address, Address, Address[], number, number] {
  return [POOL_MANAGER, crystal, ROUTER_TOKENS.map((t) => t.address), ROUTER_POOL.fee, ROUTER_POOL.tickSpacing];
}

export const v4QuoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        name: 'params',
        components: [
          {
            type: 'tuple',
            name: 'poolKey',
            components: [
              { type: 'address', name: 'currency0' },
              { type: 'address', name: 'currency1' },
              { type: 'uint24', name: 'fee' },
              { type: 'int24', name: 'tickSpacing' },
              { type: 'address', name: 'hooks' },
            ],
          },
          { type: 'bool', name: 'zeroForOne' },
          { type: 'uint128', name: 'exactAmount' },
          { type: 'bytes', name: 'hookData' },
        ],
      },
    ],
    outputs: [
      { type: 'uint256', name: 'amountOut' },
      { type: 'uint256', name: 'gasEstimate' },
    ],
  },
] as const;

/** How much of `token` exactly `ethIn` wei buys right now (V4Quoter, eth_call). */
export async function quoteEthToToken(client: PublicClient, token: TestnetToken, ethIn: bigint): Promise<bigint> {
  const { result } = await client.simulateContract({
    address: V4_QUOTER,
    abi: v4QuoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        poolKey: { currency0: ZERO, currency1: token.address, fee: ROUTER_POOL.fee, tickSpacing: ROUTER_POOL.tickSpacing, hooks: ZERO },
        zeroForOne: true,
        exactAmount: ethIn,
        hookData: '0x',
      },
    ],
  });
  return result[0];
}

/**
 * Price impact of a swap, as a fraction (0.032 = 3.2%): how far the quote falls short of
 * the pool's current price, not counting the pool fee. Null without a spot price.
 */
export function priceImpact(
  ethIn: bigint,
  amountOut: bigint,
  ethPerToken: number | null,
  decimals: number,
  feePips: number = ROUTER_POOL.fee,
): number | null {
  if (!ethPerToken || ethIn <= 0n) return null;
  const atSpot = Number(ethIn) / 1e18 / ethPerToken; // tokens at the current price
  const afterFee = atSpot * (1 - feePips / 1_000_000);
  const got = Number(amountOut) / 10 ** decimals;
  return Math.max(0, 1 - got / afterFee);
}

/** Split `total` wei by integer percentages (summing to 100); the remainder goes to the last share. */
export function splitEth(total: bigint, percents: number[]): bigint[] {
  if (percents.length === 0) return [];
  const out = percents.map((p) => (total * BigInt(Math.max(0, Math.round(p)))) / 100n);
  const used = out.reduce((s, x) => s + x, 0n);
  const last = percents.length - 1;
  out[last] = out[last]! + (total - used);
  return out;
}

/**
 * Pools thin enough to jump more than 1% between two swaps (pre-IPO test assets). With one
 * of them in the basket, a 1% minimum fails often (measured on the testnet, 2026-10-05).
 */
export const THIN_POOL_IDS: readonly string[] = ['ANTHROPIC', 'OPENAI'];
export const SLIPPAGE_BPS = 100;
export const THIN_POOL_SLIPPAGE_BPS = 300;

/** Starting slippage for a basket: 3% with a thin pool in it, else 1%. The user can change it. */
export function defaultSlippageBps(tokens: readonly Pick<TestnetToken, 'id'>[]): number {
  return tokens.some((t) => THIN_POOL_IDS.includes(t.id)) ? THIN_POOL_SLIPPAGE_BPS : SLIPPAGE_BPS;
}

/** Why the slippage starts higher, or null when no thin pool is picked. */
export function thinPoolNote(tokens: readonly Pick<TestnetToken, 'id'>[]): string | null {
  const thin = THIN_POOL_IDS.filter((id) => tokens.some((t) => t.id === id));
  if (thin.length === 0) return null;
  return thin.length === 1
    ? `The ${thin[0]} pool is thin and moves fast, so a bit more room avoids failed forges.`
    : `${thin.slice(0, -1).join(', ')} and ${thin.at(-1)} pools are thin and move fast, so a bit more room avoids failed forges.`;
}

/** The least output accepted at `slippageBps` (100 = 1%), rounded down, at least 1. */
export function minOut(amount: bigint, slippageBps: number): bigint {
  const m = (amount * BigInt(10_000 - Math.round(slippageBps))) / 10_000n;
  return m > 0n ? m : 1n;
}

export interface PriceMove {
  /** index into the swaps */
  index: number;
  /** what the same ETH buys now */
  quote: bigint;
  /** the least the user was shown */
  min: bigint;
}

/**
 * Minimums to send, from quotes taken the moment the user presses "Swap & forge".
 * The pools trade every few seconds and the thin ones can jump several percent, so the
 * quote on screen can be stale. When a fresh quote still clears the minimum the user was
 * shown, the swap goes ahead with the full slippage counted from now (Uniswap's interface
 * does the same); when it doesn't, nothing is sent and the user sees the new amounts first.
 */
export function minsAtSend(
  shownMins: readonly bigint[],
  freshQuotes: readonly bigint[],
  slippageBps: number,
): { ok: true; mins: bigint[] } | { ok: false; moved: PriceMove[] } {
  const moved = freshQuotes.flatMap((quote, index) => (quote < shownMins[index]! ? [{ index, quote, min: shownMins[index]! }] : []));
  return moved.length ? { ok: false, moved } : { ok: true, mins: freshQuotes.map((q) => minOut(q, slippageBps)) };
}

/** "ANTHROPIC moved more than 1% since the quote on screen…", for moves found before sending. */
export function priceMovedMessage(moves: ReadonlyArray<PriceMove & { token: TestnetToken }>, slippageBps: number): string {
  const what = moves
    .map((m) => `${m.token.id} now buys about ${formatAmount(m.quote, m.token.decimals)} (your minimum was ${formatAmount(m.min, m.token.decimals)})`)
    .join('; ');
  const who = moves.map((m) => m.token.id);
  const names = who.length === 1 ? who[0] : `${who.slice(0, -1).join(', ')} and ${who.at(-1)}`;
  return `${names} moved more than ${slippageText({ slippageBps })} since the quote on screen: ${what}. Nothing was sent. The amounts are updated: check them and press Swap & forge again, or raise slippage.`;
}

/** Impact above this is worth a plain warning (the thin pre-IPO pools get there quickly). */
export const IMPACT_WARN = 0.03;

/**
 * A smaller total ETH amount that should keep the worst swap's impact around 2.4%
 * (impact grows roughly in step with size for small trades), rounded down to two
 * significant digits. Null when no smaller amount is needed.
 */
export function suggestSmallerEth(totalWei: bigint, worstImpact: number): bigint | null {
  if (worstImpact <= IMPACT_WARN || totalWei <= 0n) return null;
  const target = (Number(totalWei) / 1e18) * ((IMPACT_WARN * 0.8) / worstImpact);
  if (!(target > 0)) return null;
  const mag = 10 ** (Math.floor(Math.log10(target)) - 1);
  const rounded = Math.floor(target / mag) * mag;
  return BigInt(Math.round(rounded * 1e18));
}
