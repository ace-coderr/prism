import { useMemo } from 'react';
import { holdingShades, normalizeHoldings, type Holding } from '@prism/core';

/** How a holding's symbol is shown (the live basket says ETH for its WETH). */
export type LabelOf = (symbol: string) => string;

/** Sealed-gift frost, mixed in the same way the crystal and thumbnails do it. */
const FROST = [214, 241, 255];
export function frosted(hex: string, amount = 0.62) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${c.map((v, i) => Math.round(v + (FROST[i]! - v) * amount)).join(',')})`;
}

export const weightLabel = (w: number) => (w > 0 && w < 0.005 ? '<1%' : `${Math.round(w * 100)}%`);
/** "+28.6%", "−3.1%", or null without a price. */
export const moveLabel = (change: number) => (Number.isFinite(change) ? `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}%` : null);
/** "NVDA · 40% · +28.6% today" */
export const holdingLabel = (name: string, weight: number, change: number) =>
  `${name} · ${weightLabel(weight)} · ${moveLabel(change) ? `${moveLabel(change)} today` : 'no price yet'}`;

/**
 * The key to a crystal's colours: one dot per asset in the shade it has in the crystal
 * (biggest holding first), with its symbol. Sits under thumbnails and crystals.
 */
export function AssetDots({
  holdings,
  sealed = false,
  labelOf,
  className = '',
}: {
  holdings: Holding[];
  sealed?: boolean;
  labelOf?: LabelOf;
  className?: string;
}) {
  // same slots and the same "small picture" boost as the thumbnails
  const items = useMemo(() => holdingShades(normalizeHoldings(holdings), { boost: true }).sort((a, b) => b.weight - a.weight), [holdings]);
  if (!items.length) return null;
  // spans, not ul/li: it also sits inside buttons (crystal cards)
  return (
    <span role="list" aria-label="Each asset’s colour in the crystal" className={`flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[10px] leading-none text-mist ${className}`}>
      {items.map((it) => {
        const name = labelOf ? labelOf(it.symbol) : it.symbol;
        return (
          <span role="listitem" key={it.symbol} className="inline-flex items-center gap-1" title={holdingLabel(name, it.weight, it.change24h)}>
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/70" style={{ background: sealed ? frosted(it.color) : it.color }} />
            {name}
          </span>
        );
      })}
    </span>
  );
}
