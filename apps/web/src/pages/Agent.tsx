import { useMemo } from 'react';
import { Crystal } from '../components/Crystal';
import { Stage, useRowLayout } from '../components/Stage';
import { DataBadge, Panel } from '../components/ui';
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
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 overflow-y-auto p-4">
      <div>
        <div className="flex items-center gap-3"><h1 className="headline text-3xl">Agent rule rings</h1><DataBadge live={false} /></div>
        <p className="mt-1 text-sm text-mist">
          Placeholder (Phase 3): an agent proposes a rebalance and you approve it. It never moves funds on its own.
        </p>
      </div>
      <div className="relative h-[48vh] min-h-[320px] shrink-0 overflow-hidden rounded-lg border border-line">
        <Stage className="!absolute inset-0" camera={{ position: [0, 0, 8], fov: 40 }}>
          <BeforeAfter />
        </Stage>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-3 sm:flex-row sm:items-start">
          <span className="label rounded bg-ink/80 px-2.5 py-1 text-lime">Before</span>
          <span className="label rounded bg-ink/80 px-2.5 py-1 text-lime">After</span>
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl text-lime/60">
          <span className="rotate-90 sm:rotate-0">→</span>
        </div>
      </div>
      <Panel className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto] md:items-start">
        <div className="space-y-3">
          <Weights title="Before" w={AGENT_PROPOSAL.before} />
          <Weights title="After" w={AGENT_PROPOSAL.after} />
        </div>
        <ul className="space-y-1.5 text-sm text-mist">
          {AGENT_PROPOSAL.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button disabled className="btn btn-primary">
            Approve
          </button>
          <button disabled className="btn btn-secondary">
            Reject
          </button>
        </div>
      </Panel>
    </div>
  );
}
