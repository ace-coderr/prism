import { useCallback, useRef, useState } from 'react';
import type { Hash, TransactionReceipt } from 'viem';
import { call, getTransaction, waitForTransactionReceipt } from 'wagmi/actions';
import { explorerTx, friendlyError, messageForRevertData, revertDataOf, type ErrorContext } from '@prism/core';
import { wagmiConfig } from './config';
import { useWriters, type TxDescription, type Writer } from './write';

export type StepStatus = 'waiting' | 'wallet' | 'mining' | 'done' | 'error';

export interface Step {
  label: string;
  status: StepStatus;
  hash?: Hash;
  error?: string;
}

export interface StepDef {
  label: string;
  /**
   * Sends one transaction and returns its hash (the wallet prompt happens inside). Send it
   * with `write`: an embedded wallet then shows `tx` on its confirmation screen.
   */
  send: (write: Writer) => Promise<Hash>;
  /** What the transaction does, for an embedded wallet's confirmation (defaults to the label). */
  tx?: Partial<TxDescription>;
  /** Optional follow-up once mined (e.g. read the new crystal id from logs). */
  after?: (receipt: TransactionReceipt) => void;
  /** What the error messages should know (e.g. the slippage picked). */
  errorContext?: ErrorContext;
}

/**
 * Why a mined transaction reverted: a receipt carries no reason, so replay the same call
 * at its block and decode what the contract says (usually the same thing, right after).
 */
async function explainFailedTx(hash: Hash, receipt: TransactionReceipt, ctx: ErrorContext = {}): Promise<string> {
  const generic = 'The transaction failed on-chain (reverted). Nothing changed except the network fee.';
  try {
    const tx = await getTransaction(wagmiConfig, { hash });
    if (!tx.to) return generic;
    await call(wagmiConfig, { account: tx.from, to: tx.to, data: tx.input, value: tx.value, gas: tx.gas, blockNumber: receipt.blockNumber });
  } catch (e) {
    const data = revertDataOf(e);
    if (data !== undefined) return `The transaction failed on-chain, so only the network fee was spent. ${messageForRevertData(data, ctx)}`;
  }
  return generic;
}

/** Runs transactions one by one, tracking each step for the UI. Stops at the first failure. */
export function useTxSteps() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  // the latest wallet state, read when each step is sent
  const writers = useWriters();
  const writersRef = useRef(writers);
  writersRef.current = writers;

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
          const def = defs[i]!;
          const write = writersRef.current({ description: def.tx?.description ?? def.label, action: def.tx?.action ?? def.label, contract: def.tx?.contract });
          hash = await def.send(write);
        } catch (e) {
          patch(i, { status: 'error', error: friendlyError(e, defs[i]!.errorContext) });
          return false;
        }
        patch(i, { status: 'mining', hash });
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
        if (receipt.status !== 'success') {
          patch(i, { status: 'error', error: await explainFailedTx(hash, receipt, defs[i]!.errorContext) });
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
