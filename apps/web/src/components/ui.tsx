import type { ReactNode } from 'react';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-panel/80 backdrop-blur ${className}`}>{children}</div>
  );
}

export function Change({ value }: { value: number }) {
  return (
    <span className={`tabular-nums ${value >= 0 ? 'text-up' : 'text-down'}`}>
      {value >= 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  );
}

export function SoonButton({ children }: { children: ReactNode }) {
  return (
    <button
      disabled
      className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm text-mist"
    >
      {children}
      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider">coming soon</span>
    </button>
  );
}

export const usd = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
