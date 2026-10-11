/**
 * Pure helpers for reading and writing on-chain that can be tested without a wallet:
 * amount parsing and getLogs block ranges (readable errors: ./errors).
 */
import { parseUnits } from 'viem';

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

/** Split [from, to] into inclusive block ranges of at most `size` blocks (for getLogs limits). */
export function blockRanges(from: bigint, to: bigint, size: bigint): Array<[bigint, bigint]> {
  if (to < from || size <= 0n) return [];
  const out: Array<[bigint, bigint]> = [];
  for (let a = from; a <= to; a += size) out.push([a, a + size - 1n > to ? to : a + size - 1n]);
  return out;
}
