import type { ReactNode } from 'react';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-panel ${className}`}>{children}</div>;
}

export function Change({ value }: { value: number }) {
  return (
    <span className={`font-mono tabular-nums ${value >= 0 ? 'text-up' : 'text-down'}`}>
      {value >= 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  );
}

export function SoonButton({ children }: { children: ReactNode }) {
  return (
    <button disabled className="btn btn-secondary">
      {children}
      <span className="rounded-sm bg-lime/10 px-1.5 py-0.5 text-[9px]">soon</span>
    </button>
  );
}

/** ETH amount, e.g. "0.1187 ETH" / "0.001 ETH" / "4.620 ETH". */
export const formatEth = (v: number) =>
  `${v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : String(Number(v.toPrecision(4)))} ETH`;

export const TESTNET_USD_NOTE = 'Testnet USD from the ETH/USDG test pool, not a market price.';

/**
 * ETH-first price: ETH is the main figure. Testnet USD (from the unpegged ETH/USDG
 * test pool) is only a small grey secondary label with an explanatory tooltip.
 */
export function EthPrice({ eth, usd, className = '' }: { eth: number; usd?: number | null; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="font-mono text-xs text-white">{formatEth(eth)}</span>
      {usd != null && (
        <span className="cursor-help font-mono text-[10px] text-mist/60" title={TESTNET_USD_NOTE} aria-label={`about ${usd.toFixed(2)} testnet US dollars. ${TESTNET_USD_NOTE}`}>
          ≈${usd >= 100 ? usd.toFixed(0) : usd.toFixed(2)} testnet
        </span>
      )}
    </span>
  );
}
