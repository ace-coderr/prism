import { useMemo } from 'react';
import { Crystal } from '../components/Crystal';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stage, useRowLayout } from '../components/Stage';
import { DataBadge, Panel } from '../components/ui';
import { ViberCredit, ViberGuide } from '../components/Viber';
import { AGENT_PROPOSAL, CORRELATIONS, toHoldings } from '../data/mock';

function BeforeAfter() {
  const { positions, size } = useRowLayout(2, 1.15);
  const before = useMemo(() => toHoldings(AGENT_PROPOSAL.before), []);
  const after = useMemo(() => toHoldings(AGENT_PROPOSAL.after), []);
  return (
    <>
      <Crystal holdings={before} correlation={CORRELATIONS} position={positions[0]} size={size} spin={0.15} />
      <Crystal holdings={after} correlation={CORRELATIONS} position={positions[1]} size={size} spin={0.15} />
    </>
  );
}

function Weights({ title, w }: { title: string; w: Record<string, number> }) {
  return (
    <div>
      <div className="label mb-1.5 text-mist">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(w).map(([s, v]) => (
          <span key={s} className="chip tabular-nums">
            {s} {v}%
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Agent() {
  return (
    <PageScroll className="max-w-6xl gap-6">
      <PageHeader title="Agent" subtitle="Coming soon: a helper that suggests changes to your crystal. Nothing happens unless you approve it.">
        <span className="rounded-full bg-amber-400/15 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
          Coming soon
        </span>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <ViberGuide index={9} size={88}>
          vibe/vibe calls us vibers “quant agents”. In PRISM, an agent will watch your crystal and suggest a change — for
          example, trimming a stock that grew too big.
        </ViberGuide>
        <ViberGuide index={10} size={88}>
          You see the suggestion, the before and the after. If you like it, you approve it in your wallet. If not, nothing
          happens. The agent can never move your tokens on its own.
        </ViberGuide>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="headline text-2xl">What a suggestion will look like</h2>
          <DataBadge live={false} />
        </div>
        <div className="relative h-[42vh] min-h-[300px] overflow-hidden rounded-3xl border border-white/10">
          <Stage className="!absolute inset-0" camera={{ position: [0, 0, 8], fov: 40 }}>
            <BeforeAfter />
          </Stage>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-3 sm:flex-row sm:items-start">
            <span className="label rounded-full bg-ink/80 px-3 py-1 text-lime">Before</span>
            <span className="label rounded-full bg-ink/80 px-3 py-1 text-lime">After</span>
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl text-lime/60">
            <span className="rotate-90 sm:rotate-0">→</span>
          </div>
        </div>
        <Panel className="grid gap-5 p-5 md:grid-cols-[1fr_1fr_auto] md:items-start">
          <div className="space-y-3">
            <Weights title="Before" w={AGENT_PROPOSAL.before} />
            <Weights title="After" w={AGENT_PROPOSAL.after} />
          </div>
          <div>
            <p className="label mb-1.5 text-mist">Why</p>
            <ul className="space-y-1.5 text-sm text-white/85">
              {AGENT_PROPOSAL.reasons.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
          </div>
          <div className="flex gap-2">
            <button disabled className="btn btn-primary" title="Coming soon">
              Approve
            </button>
            <button disabled className="btn btn-secondary" title="Coming soon">
              Reject
            </button>
          </div>
        </Panel>
      </section>
      <ViberCredit />
    </PageScroll>
  );
}
