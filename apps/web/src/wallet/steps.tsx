import { useCallback, useState } from 'react';
import type { Hash, TransactionReceipt } from 'viem';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { explorerTx, friendlyError } from '@prism/core';
import { wagmiConfig } from './config';

export type StepStatus = 'waiting' | 'wallet' | 'mining' | 'done' | 'error';

export interface Step {
  label: string;
  status: StepStatus;
  hash?: Hash;
  error?: string;
}

export interface StepDef {
  label: string;
  /** Sends one transaction and returns its hash (the wallet prompt happens inside). */
  send: () => Promise<Hash>;
  /** Optional follow-up once mined (e.g. read the new crystal id from logs). */
  after?: (receipt: TransactionReceipt) => void;
}

/** Runs transactions one by one, tracking each step for the UI. Stops at the first failure. */
export function useTxSteps() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async (defs: StepDef[]) => {
    setRunning(true);
    setSteps(defs.map((d) => ({ label: d.label, status: 'waiting' })));
    const patch = (i: number, p: Partial<Step>) =>
      setSteps((s) => s.map((st, k) => (k === i ? { ...st, ...p } : st)));
    try {
      for (let i = 0; i < defs.length; i++) {
        patch(i, { status: 'wallet' });
        let hash: Hash;
        try {
          hash = await defs[i]!.send();
        } catch (e) {
          patch(i, { status: 'error', error: friendlyError(e) });
          return false;
        }
        patch(i, { status: 'mining', hash });
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
        if (receipt.status !== 'success') {
          patch(i, { status: 'error', error: 'The transaction failed on-chain (reverted).' });
          return false;
        }
        defs[i]!.after?.(receipt);
        patch(i, { status: 'done' });
      }
      return true;
    } catch (e) {
      setSteps((s) => s.map((st) => (st.status === 'mining' ? { ...st, status: 'error', error: friendlyError(e) } : st)));
      return false;
    } finally {
      setRunning(false);
    }
  }, []);

  return { steps, running, run, reset: () => setSteps([]) };
}

const ICON: Record<StepStatus, string> = { waiting: '○', wallet: '◔', mining: '◑', done: '●', error: '✕' };
const TEXT: Record<StepStatus, string> = {
  waiting: '',
  wallet: 'confirm in your wallet…',
  mining: 'waiting for the block…',
  done: 'done',
  error: '',
};

export function StepList({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-1.5 rounded border border-line bg-ink/60 p-3 font-mono text-[11px]">
      {steps.map((s, i) => (
        <li key={i}>
          <div className="flex items-baseline gap-2">
            <span className={s.status === 'done' ? 'text-lime' : s.status === 'error' ? 'text-down' : 'text-mist'}>{ICON[s.status]}</span>
            <span className={s.status === 'waiting' ? 'text-mist/60' : 'text-white'}>{s.label}</span>
            <span className="text-mist">{TEXT[s.status]}</span>
            {s.hash && (
              <a href={explorerTx(s.hash)} target="_blank" rel="noreferrer" className="ml-auto text-lime/80 hover:text-lime">
                tx ↗
              </a>
            )}
          </div>
          {s.error && <p className="ml-5 mt-0.5 text-down">{s.error}</p>}
        </li>
      ))}
    </ol>
  );
}
