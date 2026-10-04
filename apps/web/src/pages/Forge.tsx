import { useMemo, useState } from 'react';
import { evenWeights, normalizeTo100, rebalance, totalOf, type Holding } from '@prism/core';
import { Crystal } from '../components/Crystal';
import { Stage } from '../components/Stage';
import { Change, DataBadge, Panel } from '../components/ui';
import { explorerAddress, useTestnetTokens } from '../data/chain';
import { CORRELATIONS, TOKENS } from '../data/mock';

const MAX_PICKS = 8;
/** Shape-only default when there is no market data to derive volatility from. */
const DEFAULT_VOLATILITY = 0.4;

interface Option {
  symbol: string;
  name: string;
  /** NaN = unknown (no price feed) → neutral crystal color */
  change24h: number;
  volatility: number;
  price: number | null;
  live: boolean;
  address?: string;
  sourceUrl?: string;
}

type Source = 'testnet' | 'sample';

export default function Forge() {
  const [source, setSource] = useState<Source>('testnet');
  const live = useTestnetTokens();

  const options: Option[] = useMemo(() => {
    if (source === 'sample') {
      return TOKENS.map((t) => ({ ...t, price: t.price, live: false }));
    }
    if (live.status !== 'live') return [];
    return live.tokens.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      change24h: Number.NaN, // no 24h history without a feed — never guessed
      volatility: DEFAULT_VOLATILITY,
      price: t.price,
      live: true,
      address: t.address,
      sourceUrl: t.sourceUrl,
    }));
  }, [source, live]);

  const [picksBySource, setPicksBySource] = useState<Record<Source, string[] | null>>({ testnet: null, sample: null });
  const [weightsBySource, setWeightsBySource] = useState<Record<Source, number[]>>({ testnet: [], sample: [] });

  // default selection per source: the first (up to) three options, evenly weighted
  const defaultPicks = options.slice(0, 3).map((o) => o.symbol);
  const picks = (picksBySource[source] ?? defaultPicks).filter((s) => options.some((o) => o.symbol === s));
  const weights = picksBySource[source] ? weightsBySource[source] : evenWeights(picks.length);

  const setState = (p: string[], w: number[]) => {
    setPicksBySource((s) => ({ ...s, [source]: p }));
    setWeightsBySource((s) => ({ ...s, [source]: w }));
  };

  const toggle = (symbol: string) => {
    const i = picks.indexOf(symbol);
    if (i >= 0) {
      if (picks.length === 1) return;
      setState(
        picks.filter((_, k) => k !== i),
        normalizeTo100(weights.filter((_, k) => k !== i)),
      );
    } else if (picks.length < MAX_PICKS) {
      const n = picks.length + 1;
      setState([...picks, symbol], rebalance([...weights, 0], n - 1, Math.round(100 / n)));
    }
  };

  const bySymbol = useMemo(() => Object.fromEntries(options.map((o) => [o.symbol, o])), [options]);
  const total = totalOf(weights);
  const holdings: Holding[] = useMemo(
    () =>
      picks.map((s, i) => ({
        symbol: s,
        weight: (weights[i] ?? 0) / 100,
        change24h: bySymbol[s]!.change24h,
        volatility: bySymbol[s]!.volatility,
      })),
    [picks, weights, bySymbol],
  );
  const knownChange = holdings.every((h) => Number.isFinite(h.change24h));
  const change = holdings.reduce((s, h) => s + h.weight * h.change24h, 0);
  const isLive = source === 'testnet' && live.status === 'live';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 overflow-y-auto p-4 lg:grid lg:grid-cols-[400px_1fr] lg:overflow-hidden">
      <div className="relative order-1 h-[42vh] min-h-[280px] shrink-0 overflow-hidden rounded-lg border border-line lg:order-2 lg:h-auto">
        <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
          {holdings.length > 0 && <Crystal holdings={holdings} correlation={CORRELATIONS} size={1.6} spin={0.2} />}
        </Stage>
        <div className="pointer-events-none absolute left-4 top-4 flex flex-col items-start gap-2">
          <DataBadge live={isLive} />
          <span className="label text-mist">
            Basket 24h {knownChange ? <Change value={change} /> : <span className="text-mist/70">— no price feed</span>}
          </span>
        </div>
        {source === 'testnet' && (
          <p className="pointer-events-none absolute bottom-3 left-4 right-4 font-mono text-[10px] leading-relaxed text-mist/80">
            Grey = no price data. Shape uses a default volatility until feeds exist on testnet.
          </p>
        )}
      </div>

      <Panel className="order-2 flex shrink-0 flex-col lg:order-1 lg:min-h-0 lg:overflow-hidden">
        <div className="border-b border-line p-4">
          <h1 className="headline text-2xl">Forge a crystal</h1>
          <div className="mt-3 inline-flex rounded border border-line p-0.5" role="tablist">
            {(['testnet', 'sample'] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={source === s}
                onClick={() => setSource(s)}
                className={`label rounded-sm px-3 py-1.5 transition ${source === s ? 'bg-lime text-ink' : 'text-mist hover:text-white'}`}
              >
                {s === 'testnet' ? 'Testnet tokens' : 'Sample tokens'}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-mist">
            {source === 'testnet'
              ? 'Verified tokens on Robinhood Chain Testnet (46630), read live from the RPC.'
              : `Sample stock list with made-up prices, for trying bigger baskets. Up to ${MAX_PICKS} tokens.`}
          </p>
          {source === 'testnet' && live.status === 'loading' && <p className="label mt-3 text-mist">Reading chain…</p>}
          {source === 'testnet' && live.status === 'error' && (
            <p className="mt-3 text-sm text-down">Couldn't reach the testnet RPC ({live.message}). Try Sample tokens.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {options.map((t) => (
              <button key={t.symbol} onClick={() => toggle(t.symbol)} className={`chip ${picks.includes(t.symbol) ? 'chip-on' : ''}`}>
                {t.symbol}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {picks.map((symbol, i) => {
            const t = bySymbol[symbol]!;
            const w = weights[i] ?? 0;
            return (
              <div key={symbol}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{symbol}</span> <span className="text-mist">{t.name}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    {t.live ? (
                      t.price !== null ? (
                        <span className="font-mono text-xs">${t.price.toFixed(2)}</span>
                      ) : (
                        <span className="label rounded-sm border border-line px-1.5 py-0.5 text-[9px] text-mist">no price feed</span>
                      )
                    ) : (
                      <span className="text-xs">
                        <Change value={t.change24h} />
                      </span>
                    )}
                    <span className="w-10 text-right font-mono font-bold tabular-nums">{w}%</span>
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
                  onChange={(e) => setState(picks, rebalance(weights, i, Number(e.target.value)))}
                />
                {t.address && (
                  <div className="mt-1 flex gap-3 font-mono text-[10px] text-mist/70">
                    <a href={explorerAddress(t.address)} target="_blank" rel="noreferrer" className="hover:text-lime">
                      {t.address.slice(0, 6)}…{t.address.slice(-4)} ↗
                    </a>
                    {t.sourceUrl && (
                      <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-lime">
                        source ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-line p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="label text-mist">Total</span>
            <span className={`font-mono font-bold tabular-nums ${total === 100 ? 'text-up' : 'text-down'}`}>{total}%</span>
          </div>
          <button disabled title="Minting arrives with the contracts" className="btn btn-primary w-full">
            Forge on-chain · coming soon
          </button>
        </div>
      </Panel>
    </div>
  );
}
