/**
 * Pure helpers for on-chain flows (forge / add / withdraw / seal) that can be tested
 * without a wallet: amount parsing, pre-flight balance checks, approval planning,
 * and crystal ownership from Transfer logs (readable errors: ./errors).
 */
import { parseUnits, type Address } from 'viem';

// ------------------------------------------------------------------ amounts

/** Parse a user-typed token amount ("1.5") into base units. Returns null for invalid / non-positive input. */
export function parseTokenAmount(input: string, decimals: number): bigint | null {
  const s = input.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const [, frac = ''] = s.split('.');
  if (frac.length > decimals) return null; // more precision than the token supports
  try {
    const v = parseUnits(s, decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ forge planning

export interface PlanItem {
  token: Address;
  symbol: string;
  amount: bigint;
  balance: bigint;
  allowance: bigint;
}

export interface ForgePlan {
  ok: boolean;
  /** human-readable blockers, shown before anything is sent */
  problems: string[];
  /** tokens that need an approve() before forge/addTo */
  approvals: PlanItem[];
}

/** ETH kept aside for gas when checking the ETH balance (approvals + forge on an L2 are cheap). */
export const GAS_RESERVE_WEI = 2_000_000_000_000_000n; // 0.002 ETH

/**
 * Pre-flight checks for forge / addTo: enough of every token, enough ETH for the
 * deposit plus a gas reserve, no duplicates, at most `maxAssets`, and which tokens
 * still need approval. Nothing is sent if `ok` is false.
 */
export function planDeposit(
  items: PlanItem[],
  eth: { amount: bigint; balance: bigint },
  maxAssets = 8,
  existingAssets = 0,
): ForgePlan {
  const problems: string[] = [];
  if (items.length === 0 && eth.amount === 0n) problems.push('Add at least one token amount or some ETH.');
  const seen = new Set<string>();
  for (const it of items) {
    const key = it.token.toLowerCase();
    if (seen.has(key)) problems.push(`${it.symbol} is listed twice.`);
    seen.add(key);
    if (it.amount <= 0n) problems.push(`Enter an amount for ${it.symbol}.`);
    else if (it.amount > it.balance) problems.push(`Not enough ${it.symbol} in your wallet.`);
  }
  if (eth.amount + GAS_RESERVE_WEI > eth.balance) {
    problems.push(
      eth.amount > 0n
        ? 'Not enough ETH for this deposit plus gas (keep ~0.002 ETH for fees).'
        : 'Not enough ETH to pay gas (keep ~0.002 ETH for fees).',
    );
  }
  const assets = existingAssets + items.length + (eth.amount > 0n ? 1 : 0);
  if (assets > maxAssets) problems.push(`A crystal holds at most ${maxAssets} assets (ETH counts as one).`);
  const approvals = items.filter((it) => it.amount > 0n && it.allowance < it.amount);
  return { ok: problems.length === 0, problems, approvals };
}

// ------------------------------------------------------------------ ownership from logs

export interface TransferLog {
  from: Address;
  to: Address;
  tokenId: bigint;
  blockNumber: bigint;
  logIndex: number;
}

/** Ids `owner` holds after replaying ERC-721 Transfer logs in chain order. */
export function ownedFromTransfers(logs: TransferLog[], owner: Address): bigint[] {
  const me = owner.toLowerCase();
  const sorted = [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  const holder = new Map<bigint, string>();
  for (const l of sorted) holder.set(l.tokenId, l.to.toLowerCase());
  return [...holder].filter(([, h]) => h === me).map(([id]) => id).sort((a, b) => (a < b ? -1 : 1));
}

/** Split [from, to] into inclusive block ranges of at most `size` blocks (for getLogs limits). */
export function blockRanges(from: bigint, to: bigint, size: bigint): Array<[bigint, bigint]> {
  if (to < from || size <= 0n) return [];
  const out: Array<[bigint, bigint]> = [];
  for (let a = from; a <= to; a += size) out.push([a, a + size - 1n > to ? to : a + size - 1n]);
  return out;
}

// ------------------------------------------------------------------ crystal weights

/**
 * Weights (0..1) of a crystal's holdings by value in ETH. A value of 0 means "none"
 * (weight 0). Assets with an unknown price (null / NaN) get the average priced share
 * rather than a guessed price.
 */
export function valueWeights(values: Array<number | null>): number[] {
  const known = values.map((v) => (v !== null && Number.isFinite(v) ? Math.max(0, v) : null));
  const priced = known.filter((v): v is number => v !== null);
  const total = priced.reduce((s, v) => s + v, 0);
  const unpriced = known.length - priced.length;
  if (total === 0) {
    // nothing priced has value: split evenly across the unpriced ones (or everything)
    return unpriced > 0 ? known.map((v) => (v === null ? 1 / unpriced : 0)) : values.map(() => (values.length ? 1 / values.length : 0));
  }
  const pricedNonZero = priced.filter((v) => v > 0).length;
  const avg = total / pricedNonZero;
  const raw = known.map((v) => (v === null ? avg : v));
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map((v) => v / sum);
}

/** "2026-10-04T12:00" (datetime-local, user's timezone) → unix seconds; null if invalid. */
export function localDateTimeToUnix(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
