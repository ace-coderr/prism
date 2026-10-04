import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Holding } from '@prism/core';
import { Crystal } from '../components/Crystal';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stage, useRowLayout } from '../components/Stage';
import { LiveBadge, Panel } from '../components/ui';
import { LoadingStage } from '../components/LoadingStage';
import { ViberGuide } from '../components/Viber';
import { analyzeCrystal, type Analysis } from '../data/agent';
import { useTestnetTokens, type LiveTokens } from '../data/chain';
import { forgeWeights, holdingsFromAssets, marketLookup } from '../data/crystalHoldings';
import { earliestForge, useMyCrystals, type OnchainCrystal } from '../data/crystals';
import { WalletButton, useWallet } from '../wallet/WalletButton';

export default function Agent() {
  const { address, isConnected } = useWallet();
  const crystals = useMyCrystals(address);
  const live = useTestnetTokens(earliestForge(crystals.data));
  const list = crystals.data ?? [];
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const selected = list.find((c) => c.id === selectedId) ?? list[0];

  return (
    <PageScroll>
      <PageHeader
        label="Agent"
        lead="A second look"
        accent="at your crystal."
        subtitle="A read-only look at your real crystals: how each one has drifted since you forged it, and what to do about it."
      >
        <span className="whitespace-nowrap rounded-full bg-amber-400/15 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
          Rebalancing: soon
        </span>
      </PageHeader>

      {!isConnected && (
        <div className="card flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between md:p-10">
          <ViberGuide index={9} size={88}>
            I watch your crystals and suggest changes, like trimming a stock that grew too big. Connect your wallet and
            I’ll look at yours. I can never move your tokens on my own.
          </ViberGuide>
          <div className="flex flex-wrap gap-2">
            <WalletButton variant="hero" />
            <Link to="/forge" className="btn btn-outline">
              Forge a crystal
            </Link>
          </div>
        </div>
      )}

      {isConnected && crystals.isLoading && <LoadingStage label="Reading your crystals from the chain…" />}
      {isConnected && crystals.isError && <p className="text-sm text-down">Couldn’t read your crystals right now. Try again in a moment.</p>}
      {isConnected && crystals.isSuccess && list.length === 0 && (
        <div className="card flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between md:p-10">
          <ViberGuide index={10} size={88}>
            You don’t have a crystal yet, so there’s nothing for me to look at. Forge one and come back.
          </ViberGuide>
          <Link to="/forge" className="btn btn-primary btn-lg">
            Forge a crystal
          </Link>
        </div>
      )}

      {list.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {list.map((c) => (
            <button key={c.id.toString()} onClick={() => setSelectedId(c.id)} className={`chip ${selected?.id === c.id ? 'chip-on' : ''}`}>
              #{c.id.toString()}
            </button>
          ))}
        </div>
      )}
      {selected && <CrystalAnalysis key={selected.id.toString()} crystal={selected} live={live} />}
    </PageScroll>
  );
}

function CrystalAnalysis({ crystal, live }: { crystal: OnchainCrystal; live: LiveTokens }) {
  const marketOf = useMemo(() => marketLookup(live.status === 'live' ? live.tokens : undefined), [live]);
  const holdings = useMemo(() => holdingsFromAssets(crystal.assets, marketOf).holdings, [crystal, marketOf]);
  const analysis = useMemo(() => {
    if (live.status !== 'live') return null;
    const now = new Map(holdings.map((h) => [h.symbol, h.weight]));
    return analyzeCrystal(crystal.id, now, forgeWeights(live, crystal));
  }, [live, holdings, crystal, marketOf]);
  const after = useMemo(
    () => (analysis ? holdings.map((h) => ({ ...h, weight: analysis.target.get(h.symbol) ?? 0 })) : holdings),
    [analysis, holdings],
  );

  if (!analysis) return <LoadingStage label="Reading live prices…" />;
  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="font-display text-4xl font-bold tracking-[-0.03em]">Crystal #{crystal.id.toString()}</h2>
        <LiveBadge />
      </div>
      <ViberGuide index={10} size={88} className="max-w-3xl">
        {analysis.suggestion}
      </ViberGuide>
      <div className="relative h-[48vh] min-h-[340px] overflow-hidden rounded-[32px] border border-white/[0.08]">
        <Stage className="!absolute inset-0" camera={{ position: [0, 0, 8], fov: 40 }}>
          <BeforeAfter before={holdings} after={after} same={!analysis.actionable} />
        </Stage>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-3 sm:flex-row sm:items-start">
          <span className="label rounded-full bg-ink/80 px-3 py-1 text-lime">Now</span>
          {analysis.actionable && <span className="label rounded-full bg-ink/80 px-3 py-1 text-lime">After trimming</span>}
        </div>
      </div>
      <Panel className="grid gap-8 rounded-3xl p-8 md:grid-cols-[1fr_auto] md:items-start">
        <WeightsTable analysis={analysis} crystal={crystal} />
        <div className="flex flex-col items-start gap-2">
          <button disabled className="btn btn-primary" title="Rebalancing inside PRISM is coming soon">
            Approve
          </button>
          <p className="label text-[10px] text-mist">Rebalancing: soon</p>
        </div>
      </Panel>
    </section>
  );
}

function BeforeAfter({ before, after, same }: { before: Holding[]; after: Holding[]; same: boolean }) {
  const { positions, size } = useRowLayout(same ? 1 : 2, 1.15);
  return (
    <>
      <Crystal holdings={before} position={positions[0]} size={size} spin={0.15} />
      {!same && <Crystal holdings={after} position={positions[1]} size={size} spin={0.15} />}
    </>
  );
}

const share = (w: number | undefined) => (w === undefined ? '—' : `${Math.round(w * 100)}%`);

function WeightsTable({ analysis, crystal }: { analysis: Analysis; crystal: OnchainCrystal }) {
  return (
    <table className="w-full text-sm">
      <thead className="label text-left text-mist">
        <tr>
          <th className="pb-2 font-normal">Asset</th>
          <th className="pb-2 text-right font-normal">When forged</th>
          <th className="pb-2 text-right font-normal">Now</th>
        </tr>
      </thead>
      <tbody>
        {crystal.assets.map((a) => (
          <tr key={a.token ?? 'eth'} className="border-t border-line">
            <td className="py-2 font-medium">{a.symbol}</td>
            <td className="py-2 text-right font-mono tabular-nums text-mist">{analysis.forged ? share(analysis.forged.get(a.symbol)) : '…'}</td>
            <td className={`py-2 text-right font-mono tabular-nums ${analysis.grew?.symbol === a.symbol && analysis.actionable ? 'text-lime' : ''}`}>
              {share(analysis.now.get(a.symbol))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
