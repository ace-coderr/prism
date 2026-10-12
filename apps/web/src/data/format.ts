import { formatUnits } from 'viem';
import { MIN_SCORE_REVIEWERS, type GemFacet } from '@prism/core';

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

const daysShort = (d: number) => (d === 0 ? '<1d' : `${d}d`);

/** A gem facet's status: "holding 12d", "trimmed 30% · 4d", "SOLD after 3d". */
export function facetStatus(f: Pick<GemFacet, 'state' | 'days'>): string {
  const s = f.state;
  if (s.kind === 'sold') return f.days === 0 ? 'SOLD within a day' : `SOLD after ${f.days}d`;
  if (s.kind === 'trimmed') return `trimmed ${s.percent}% · ${daysShort(f.days)}`;
  return `holding ${daysShort(f.days)}`;
}

const compact = (n: number, digits = 3) =>
  n >= 1000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : n.toLocaleString('en-US', { maximumSignificantDigits: digits });

/** An ETH amount: "12.4 ETH", "0.0031 ETH", "<0.0001 ETH". */
export function formatEth(eth: number | null | undefined): string {
  if (eth === null || eth === undefined || !Number.isFinite(eth)) return '–';
  if (eth === 0) return '0 ETH';
  if (eth < 0.0001) return '<0.0001 ETH';
  return `${compact(eth)} ETH`;
}

/** The testnet USD value of an ETH amount: "$9.2k" (null when either is unknown). */
export function formatUsd(eth: number | null | undefined, usdPerEth: number | null | undefined): string | null {
  if (eth === null || eth === undefined || !usdPerEth || !Number.isFinite(eth)) return null;
  const usd = eth * usdPerEth;
  if (usd < 0.01) return '<$0.01';
  return `$${usd >= 1000 ? compact(usd) : usd.toLocaleString('en-US', { maximumFractionDigits: usd < 10 ? 2 : 0 })}`;
}

/** A change as a signed percent: "+12.4%", "−3.1%", "0%". */
export function formatChange(change: number | null | undefined): string {
  if (change === null || change === undefined || !Number.isFinite(change)) return '–';
  const p = change * 100;
  if (Math.abs(p) < 0.05) return '0%';
  const v = Math.abs(p) >= 1000 ? compact(Math.abs(p)) : Math.abs(p).toFixed(Math.abs(p) >= 100 ? 0 : 1);
  return `${p > 0 ? '+' : '−'}${v}%`;
}

/** Why there's no score yet, with the token's real holder count when it's known. */
export function noScoreText(reviewers: number, symbol: string, holders: number | null | undefined): string {
  const after = `The score appears once ${MIN_SCORE_REVIEWERS} current holders review.`;
  const of = holders != null ? ` of its ${holders.toLocaleString('en-US')} holder${holders === 1 ? '' : 's'}` : '';
  if (reviewers === 0) return `No reviews yet${holders != null ? ` from its ${holders.toLocaleString('en-US')} holder${holders === 1 ? '' : 's'}` : ''}. ${after}`;
  return `${reviewers}${of} ${reviewers === 1 ? 'has' : 'have'} reviewed $${symbol}. ${after}`;
}
