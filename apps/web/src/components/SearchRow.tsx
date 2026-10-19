import { formatScore, scoreColor } from '@prism/core';
import type { SearchItem } from '../data/api';
import { plural } from '../data/format';
import { MarketLine, TokenAvatar } from './token';

const kindLabel = (a: SearchItem) => (a.kind === 'stock' ? 'test stock' : `${a.status === 'graduated' ? 'graduated' : 'on curve'} · ${a.quote?.symbol ?? 'ETH'} pair`);

/** PRISM's own number for a result: the true colors score, else how many reviews. */
function PrismNumbers({ a }: { a: SearchItem }) {
  if (a.score?.score != null) {
    return (
      <span className="font-display text-xl font-bold tabular-nums" style={{ color: scoreColor(a.score.score) }} title="True colors on PRISM">
        {formatScore(a.score.score)}
      </span>
    );
  }
  if (a.reviews === null) return null;
  return <span className="font-mono text-[11px] text-mist">{a.reviews ? plural(a.reviews, 'review') : 'no reviews'}</span>;
}

/** One search result: picture, name, $SYMBOL, pair and status, market cap and holders, PRISM reviews. */
export function SearchRow({ a, size = 'md', flag }: { a: SearchItem; size?: 'md' | 'lg'; flag?: string }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-3">
      <TokenAvatar token={a.token} size={size === 'lg' ? 48 : 36} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={`truncate font-display font-bold text-white ${size === 'lg' ? 'text-lg' : ''}`} title={a.fullName ?? undefined}>
            {a.name}
          </span>
          <span className="shrink-0 font-mono text-[12px] font-bold text-lime">${a.symbol}</span>
        </span>
        <span className="block truncate font-mono text-[10px] uppercase tracking-[0.08em] text-mist">{kindLabel(a)}</span>
        <MarketLine token={a.token} className="block truncate text-[12px] text-mist" />
        {flag && (
          <span className="block truncate font-mono text-[11px] text-gold" title="From the Launch X-ray: read from the chain">
            ◆ {flag}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <PrismNumbers a={a} />
      </span>
    </span>
  );
}
