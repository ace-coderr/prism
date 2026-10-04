import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Address } from 'viem';
import type { Holding } from '@prism/core';
import { Crystal } from '../components/Crystal';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stage, useRowLayout } from '../components/Stage';
import { LoadingStage } from '../components/LoadingStage';
import { GuideNote } from '../components/Viber';
import { analyzeCrystal, type Analysis } from '../data/agent';
import { useTestnetTokens, type LiveTokens } from '../data/chain';
import { forgeWeights, holdingsFromAssets, marketLookup } from '../data/crystalHoldings';
import { earliestForge, useMyCrystals, type OnchainCrystal } from '../data/crystals';
import { Owner, useName } from '../data/names';
import { WalletButton, useWallet } from '../wallet/WalletButton';

export default function Agent() {
  const { address, isConnected } = useWallet();
  const crystals = useMyCrystals(address);
  const live = useTestnetTokens(earliestForge(crystals.data));
  const { name } = useName(address);
  const list = crystals.data ?? [];
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const selected = list.find((c) => c.id === selectedId) ?? list[0];
  const view = useAnalysis(selected, live);

  // the page's one GuideNote, directly under the header: what the agent says right now
  const guide = !isConnected ? (
    <GuideNote
      index={9}
      action={
        <>
          <WalletButton variant="hero" />
          <Link to="/forge" className="btn btn-outline">
            Forge a crystal
          </Link>
        </>
      }
    >
      I watch your crystals and suggest changes, like trimming a stock that grew too big. Connect your wallet and I’ll look
      at yours. I can never move your tokens on my own.
    </GuideNote>
  ) : crystals.isSuccess && list.length === 0 ? (
    <GuideNote
      index={10}
      action={
        <Link to="/forge" className="btn btn-primary">
          Forge a crystal
        </Link>
      }
    >
      You don’t have a crystal yet, so there’s nothing for me to look at. Forge one and come back.
    </GuideNote>
  ) : view?.analysis ? (
    <GuideNote index={10}>{view.analysis.suggestion}</GuideNote>
  ) : undefined;

  return (
    <PageScroll>
      <PageHeader
        label="Agent"
        lead="A second look"
        accent="at your crystal."
        subtitle="A read-only look at your real crystals: how each one has drifted since you forged it, and what to do about it."
        guide={guide}
      />
      {(!isConnected || (crystals.isSuccess && list.length === 0)) && <HowItWorks />}

      {isConnected && crystals.isLoading && <LoadingStage label="Reading your crystals from the chain…" />}
      {isConnected && crystals.isError && <p className="text-sm text-down">Couldn’t read your crystals right now. Try again in a moment.</p>}

      {list.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {list.map((c) => (
            <button key={c.id.toString()} onClick={() => setSelectedId(c.id)} className={`chip ${selected?.id === c.id ? 'chip-on' : ''}`}>
              #{c.id.toString()}
            </button>
          ))}
        </div>
      )}
      {selected && address && view && (
        <CrystalAnalysis key={selected.id.toString()} crystal={selected} view={view} owner={address} ownerName={name} />
      )}
    </PageScroll>
  );
}

const HOW = [
  { n: '01', t: 'It reads', d: 'Your crystals and live testnet prices, straight from the chain. Read-only.' },
  { n: '02', t: 'It compares', d: 'Today’s mix with the mix you forged, holding by holding.' },
  { n: '03', t: 'It suggests', d: 'If one holding grew too big, it says what to trim. Approving inside PRISM is coming soon.' },
];

/** What the agent does, while there is nothing of yours to look at yet. */
function HowItWorks() {
  return (
    <section aria-label="How the agent works" className="grid gap-6 md:grid-cols-3">
      {HOW.map((h) => (
        <div key={h.n} className="card p-6">
          <p className="font-mono text-sm text-lime">{h.n}</p>
          <p className="mt-3 font-display text-xl font-bold">{h.t}</p>
          <p className="mt-2 text-[15px] leading-relaxed text-mist">{h.d}</p>
        </div>
      ))}
    </section>
  );
}

/** The selected crystal now vs. its forge-time mix, once live prices are in. */
function useAnalysis(crystal: OnchainCrystal | undefined, live: LiveTokens) {
  const marketOf = useMemo(() => marketLookup(live.status === 'live' ? live.tokens : undefined), [live]);
  return useMemo(() => {
    if (!crystal) return null;
    const holdings = holdingsFromAssets(crystal.assets, marketOf).holdings;
    let analysis: Analysis | null = null;
    if (live.status === 'live') {
      const now = new Map(holdings.map((h) => [h.symbol, h.weight]));
      analysis = analyzeCrystal(crystal.id, now, forgeWeights(live, crystal));
    }
    const after = analysis ? holdings.map((h) => ({ ...h, weight: analysis!.target.get(h.symbol) ?? 0 })) : holdings;
    return { holdings, analysis, after };
  }, [crystal, live, marketOf]);
}

function CrystalAnalysis({
  crystal,
  view,
  owner,
  ownerName,
}: {
  crystal: OnchainCrystal;
  view: NonNullable<ReturnType<typeof useAnalysis>>;
  owner: Address;
  ownerName: string | null;
}) {
  const { analysis, holdings, after } = view;
  if (!analysis) return <LoadingStage label="Reading live prices…" />;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-3xl font-bold tracking-[-0.03em]">Crystal #{crystal.id.toString()}</h2>
        <p className="font-mono text-xs text-mist">
          owned by <Owner address={owner} name={ownerName} className="text-white" />
        </p>
      </div>
      <div className="grid grid-cols-12 gap-6">
        <div className="relative col-span-12 h-[48vh] min-h-[340px] overflow-hidden rounded-[24px] border border-white/[0.08] lg:col-span-7 lg:h-[460px]">
          <Stage className="!absolute inset-0" camera={{ position: [0, 0, 8], fov: 40 }}>
            <BeforeAfter before={holdings} after={after} same={!analysis.actionable} />
          </Stage>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-around p-4">
            <span className="label text-[10px] text-lime">Now</span>
            {analysis.actionable && <span className="label text-[10px] text-lime">After trimming</span>}
          </div>
        </div>
        <div className="card col-span-12 flex flex-col gap-6 p-6 lg:col-span-5">
          <div>
            <p className="font-display text-xl font-bold">The mix, then and now</p>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              Each holding’s share of the crystal when you forged it, and today at live testnet prices.
            </p>
          </div>
          <WeightsTable analysis={analysis} crystal={crystal} />
          <div className="mt-auto flex flex-wrap items-center gap-3">
            <button disabled className="btn btn-primary" title="Rebalancing inside PRISM is coming soon">
              Approve
            </button>
            <p className="label text-[10px] text-mist">Rebalancing: soon</p>
          </div>
        </div>
      </div>
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
