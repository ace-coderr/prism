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

/** Makes clear whether numbers on screen are real chain data or samples. */
export function DataBadge({ live }: { live: boolean }) {
  return live ? (
    <span className="label inline-flex items-center gap-1.5 rounded border border-lime/50 bg-lime/10 px-2 py-0.5 text-[10px] text-lime">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
      Live testnet data
    </span>
  ) : (
    <span className="label inline-flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-[10px] text-mist">
      <span className="h-1.5 w-1.5 rounded-full bg-mist/60" />
      Sample data
    </span>
  );
}

export const usd = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
