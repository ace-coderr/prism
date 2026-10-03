import { useMemo, useState } from 'react';
import { normalizeTo100, rebalance, totalOf } from '@prism/core';
import { Crystal } from '../components/Crystal';
import { Stage } from '../components/Stage';
import { Change, Panel } from '../components/ui';
import { CORRELATIONS, TOKENS, TOKEN_BY_SYMBOL, toHoldings } from '../data/mock';

const MAX_PICKS = 8;

export default function Forge() {
  const [picks, setPicks] = useState<string[]>(['NVDA', 'AAPL', 'ETH']);
  const [weights, setWeights] = useState<number[]>([40, 30, 30]);

  const toggle = (symbol: string) => {
    const i = picks.indexOf(symbol);
    if (i >= 0) {
      if (picks.length === 1) return;
      setPicks(picks.filter((_, k) => k !== i));
      setWeights(normalizeTo100(weights.filter((_, k) => k !== i)));
    } else if (picks.length < MAX_PICKS) {
      const n = picks.length + 1;
      setPicks([...picks, symbol]);
      setWeights(rebalance([...weights, 0], n - 1, Math.round(100 / n)));
    }
  };

  const total = totalOf(weights);
  const holdings = useMemo(
    () => toHoldings(Object.fromEntries(picks.map((s, i) => [s, weights[i]!]))),
    [picks, weights],
  );
  const change = holdings.reduce((s, h) => s + h.weight * h.change24h, 0);

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 overflow-y-auto p-4 lg:grid lg:grid-cols-[380px_1fr] lg:overflow-hidden">
      <div className="relative order-1 h-[42vh] min-h-[280px] shrink-0 overflow-hidden rounded-2xl border border-line lg:order-2 lg:h-auto">
        <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
          <Crystal holdings={holdings} correlation={CORRELATIONS} size={1.7} spin={0.2} />
        </Stage>
        <div className="pointer-events-none absolute left-4 top-4 text-xs text-mist">
          Live preview · basket 24h <Change value={change} />
        </div>
      </div>

      <Panel className="order-2 flex shrink-0 flex-col lg:order-1 lg:min-h-0 lg:overflow-hidden">
        <div className="border-b border-line p-4">
          <h1 className="font-display text-xl font-semibold">Forge a crystal</h1>
          <p className="mt-1 text-sm text-mist">Pick up to {MAX_PICKS} tokens, then shape the weights.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TOKENS.map((t) => {
              const on = picks.includes(t.symbol);
              return (
                <button
                  key={t.symbol}
                  onClick={() => toggle(t.symbol)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    on ? 'border-white/40 bg-white/10 text-white' : 'border-line text-mist hover:border-white/20 hover:text-white'
                  }`}
                >
                  {t.symbol}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {picks.map((symbol, i) => {
            const t = TOKEN_BY_SYMBOL[symbol]!;
            const w = weights[i]!;
            return (
              <div key={symbol}>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span>
                    <span className="font-medium">{symbol}</span>{' '}
                    <span className="text-mist">{t.name}</span>
                  </span>
                  <span className="flex items-baseline gap-3">
                    <span className="text-xs"><Change value={t.change24h} /></span>
                    <span className="w-10 text-right font-display tabular-nums">{w}%</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={w}
                  aria-label={`${symbol} weight`}
                  className="prism-range"
                  style={{ ['--fill' as string]: `${w}%` }}
                  onChange={(e) => setWeights(rebalance(weights, i, Number(e.target.value)))}
                />
              </div>
            );
          })}
        </div>

        <div className="border-t border-line p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-mist">Total</span>
            <span className={`font-display tabular-nums ${total === 100 ? 'text-up' : 'text-down'}`}>{total}%</span>
          </div>
          <button
            disabled
            title="Minting arrives with the contracts (step 2)"
            className="w-full cursor-not-allowed rounded-full bg-white/10 py-2.5 text-sm text-mist"
          >
            Forge on-chain · coming soon
          </button>
        </div>
      </Panel>
    </div>
  );
}
