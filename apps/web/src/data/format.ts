import { formatUnits } from 'viem';

/** A token amount for people: "1.2M", "48,200", "0.0031". */
export function formatTokens(base: string | bigint | null | undefined, decimals = 18): string {
  if (base === null || base === undefined) return '–';
  const n = Number(formatUnits(BigInt(base), decimals));
  if (n === 0) return '0';
  if (n >= 100_000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return n.toLocaleString('en-US', { maximumSignificantDigits: n >= 1 ? 5 : 3 });
}

/** A share of supply: "0.12%", "<0.01%". */
export function formatShare(share: number | null | undefined): string | null {
  if (share === null || share === undefined) return null;
  const p = share * 100;
  if (p === 0) return '0%';
  if (p < 0.01) return '<0.01%';
  return `${p < 1 ? p.toFixed(2) : p.toFixed(1)}%`;
}

export const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** "today", "1 day", "12 days". */
export const daysText = (days: number) => (days === 0 ? 'less than a day' : plural(days, 'day'));

export const dateText = (unix: number) => new Date(unix * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** "3 min ago", "5 h ago", "2 days ago". */
export function ago(unix: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - unix);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${plural(Math.round(s / 86400), 'day')} ago`;
}

/** A 0..1 share as a whole percent ("80%"); "new" with nothing decided yet. */
export const repText = (rep: number | null | undefined) => (rep === null || rep === undefined ? 'new' : `${Math.round(rep * 100)}%`);
