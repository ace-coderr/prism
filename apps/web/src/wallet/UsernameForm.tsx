import { useState } from 'react';
import type { Address } from 'viem';
import { simulateContract, writeContract } from 'wagmi/actions';
import { NAME_MAX, atName, prismNamesAbi } from '@prism/core';
import { namesContract, useName, useNameAvailability } from '../data/names';
import { TARGET_CHAIN, wagmiConfig } from './config';
import { StepList, useTxSteps } from './steps';

const STATUS: Record<string, { text: string; tone: string }> = {
  checking: { text: 'Checking…', tone: 'text-mist' },
  available: { text: 'Available ✓', tone: 'text-up' },
  taken: { text: 'Taken by someone else', tone: 'text-down' },
  yours: { text: 'That’s already yours', tone: 'text-mist' },
};

/**
 * "Set username" in the wallet menu: type a name, see live whether it can be claimed,
 * claim it in one transaction (PrismNames.setName). Off until PrismNames is deployed.
 */
export function UsernameForm({ address }: { address: Address }) {
  const contract = namesContract();
  const { name: current, refetch } = useName(address);
  const [wanted, setWanted] = useState('');
  const check = useNameAvailability(wanted, address);
  const tx = useTxSteps();

  if (!contract) {
    return <p className="px-3 py-2 text-[12px] leading-relaxed text-mist">Usernames turn on once their contract is deployed.</p>;
  }

  const send = (fn: 'setName' | 'clearName') =>
    tx
      .run([
        {
          label: fn === 'setName' ? `Claiming ${atName(wanted)}` : 'Clearing your username',
          send: async () => {
            const base = { address: contract, abi: prismNamesAbi, chainId: TARGET_CHAIN.id, account: address } as const;
            if (fn === 'setName') {
              const { request } = await simulateContract(wagmiConfig, { ...base, functionName: 'setName', args: [wanted] });
              return writeContract(wagmiConfig, request);
            }
            const { request } = await simulateContract(wagmiConfig, { ...base, functionName: 'clearName' });
            return writeContract(wagmiConfig, request);
          },
        },
      ])
      .then((ok) => {
        if (ok) {
          setWanted('');
          refetch();
        }
      });

  const s = check.problem ? { text: check.problem, tone: check.status === 'invalid' ? 'text-down' : 'text-mist' } : STATUS[check.status];
  return (
    <div className="space-y-2 px-3 py-2">
      <p className="text-[12px] text-mist">
        {current ? (
          <>
            Your username: <span className="font-mono text-white">{atName(current)}</span>
          </>
        ) : (
          'Pick a username people see instead of your address.'
        )}
      </p>
      <div className="flex gap-2">
        <input
          value={wanted}
          onChange={(e) => setWanted(e.target.value.toLowerCase().slice(0, NAME_MAX))}
          placeholder={current ?? 'your_name'}
          aria-label="Username"
          maxLength={NAME_MAX}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink px-3 py-2 font-mono text-sm outline-none focus:border-lime/60"
        />
        <button className="chip" disabled={check.status !== 'available' || tx.running} onClick={() => send('setName')}>
          {current ? 'Change' : 'Set'}
        </button>
      </div>
      {s && <p className={`text-[11px] ${s.tone}`}>{s.text}</p>}
      {current && !wanted && (
        <button className="text-[11px] text-mist underline hover:text-white" disabled={tx.running} onClick={() => send('clearName')}>
          Clear my username
        </button>
      )}
      <StepList steps={tx.steps} />
    </div>
  );
}
