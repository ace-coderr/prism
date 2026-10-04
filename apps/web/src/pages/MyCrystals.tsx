import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import OnchainCrystals from './OnchainCrystals';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { ViberCredit, ViberGuide } from '../components/Viber';
import { Crystal } from '../components/Crystal';
import { Stage, useRowLayout } from '../components/Stage';
import { Change, DataBadge, Panel, formatEth } from '../components/ui';
import { CORRELATIONS, MY_CRYSTALS, TOKEN_BY_SYMBOL, toHoldings, type MockCrystal } from '../data/mock';

function Row({ selected, onSelect }: { selected: number; onSelect: (i: number) => void }) {
  const { positions, size } = useRowLayout(MY_CRYSTALS.length);
  const holdings = useMemo(() => MY_CRYSTALS.map((c) => toHoldings(c.weights)), []);
  return (
    <>
      {MY_CRYSTALS.map((c, i) => (
        <Crystal
          key={c.id}
          holdings={holdings[i]!}
          history={c.history}
          correlation={CORRELATIONS}
          position={positions[i]}
          size={size}
          spin={i === selected ? 0.35 : 0.1}
          highlight={i === selected}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(i);
          }}
          onPointerOver={() => (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = '')}
        />
      ))}
    </>
  );
}

function Details({ crystal }: { crystal: MockCrystal }) {
  const rows = Object.entries(crystal.weights);
  const change = rows.reduce((s, [sym, w]) => s + (w / 100) * TOKEN_BY_SYMBOL[sym]!.change24h, 0);
  const seams = crystal.history?.drawdowns.filter((d) => d.recovered && d.depth > 15).length ?? 0;
  const cracks = crystal.history?.drawdowns.filter((d) => !d.recovered && d.depth > 15).length ?? 0;
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="headline text-2xl">{crystal.name}</h2>
        <span className="text-sm text-mist">
          {formatEth(crystal.valueEth)} · 24h <Change value={change} />
        </span>
      </div>
      <p className="mt-1 text-xs text-mist">
        Forged {crystal.forged}
        {seams > 0 && <span className="text-gold"> · {seams} gold seam{seams > 1 ? 's' : ''}</span>}
        {cracks > 0 && <span> · {cracks} drop{cracks > 1 ? 's' : ''} not recovered yet</span>}
      </p>
      <table className="mt-4 w-full text-sm">
        <thead className="label text-left text-mist">
          <tr>
            <th className="pb-2 font-normal">Token</th>
            <th className="pb-2 text-right font-normal">Weight</th>
            <th className="pb-2 text-right font-normal">24h</th>
            <th className="pb-2 text-right font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([sym, w]) => {
            const t = TOKEN_BY_SYMBOL[sym]!;
            return (
              <tr key={sym} className="border-t border-line">
                <td className="py-2">
                  <span className="font-medium">{sym}</span> <span className="text-mist">{t.name}</span>
                </td>
                <td className="py-2 text-right font-mono tabular-nums">{w}%</td>
                <td className="py-2 text-right">
                  <Change value={t.change24h} />
                </td>
                <td className="py-2 text-right font-mono tabular-nums">{formatEth((crystal.valueEth * w) / 100)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

export default function MyCrystals() {
  const { isConnected } = useAccount();
  // real crystals when a wallet is connected; sample crystals only when it isn't
  return isConnected ? <OnchainCrystals /> : <SampleCrystals />;
}

function SampleCrystals() {
  const [selected, setSelected] = useState(0);
  return (
    <PageScroll className="max-w-7xl gap-4">
      <PageHeader title="My Crystals" subtitle="The crystals in your wallet, and what is inside each one. Connect a wallet to see yours.">
        <DataBadge live={false} />
      </PageHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViberGuide index={11} size={60}>
          These three are samples so you can look around. Connect a wallet and your real crystals show up here.
        </ViberGuide>
        <div className="flex gap-1.5">
          {MY_CRYSTALS.map((c, i) => (
            <button key={c.id} onClick={() => setSelected(i)} className={`chip ${i === selected ? 'chip-on' : ''}`}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-[46vh] min-h-[300px] shrink-0 overflow-hidden rounded-lg border border-line">
        <Stage className="!absolute inset-0" camera={{ position: [0, 0, 8], fov: 40 }}>
          <Row selected={selected} onSelect={setSelected} />
        </Stage>
        <p className="label pointer-events-none absolute bottom-3 left-4 text-mist">Click a crystal to see its holdings</p>
      </div>
      <Details crystal={MY_CRYSTALS[selected]!} />
      <ViberCredit />
    </PageScroll>
  );
}
