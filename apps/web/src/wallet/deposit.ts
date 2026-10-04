import { erc20Abi, parseEventLogs, type Address } from 'viem';
import { simulateContract, writeContract } from 'wagmi/actions';
import { prismCrystalAbi } from '@prism/core';
import { TARGET_CHAIN, wagmiConfig } from './config';
import type { StepDef } from './steps';

export interface DepositItem {
  token: Address;
  symbol: string;
  amount: bigint;
}

/**
 * Steps for forge / addTo: one exact-amount approve per token that needs it,
 * then the deposit call itself (simulated first so reverts show a readable reason
 * before the wallet prompt).
 */
export function depositSteps(opts: {
  crystal: Address;
  account: Address;
  items: DepositItem[];
  needsApproval: DepositItem[];
  ethWei: bigint;
  target: { kind: 'forge' } | { kind: 'add'; id: bigint };
  onForged?: (id: bigint) => void;
}): StepDef[] {
  const { crystal, account, items, needsApproval, ethWei, target } = opts;
  const steps: StepDef[] = needsApproval.map((it, i) => ({
    label: `Approve ${it.symbol} ${i + 1}/${needsApproval.length}`,
    send: () =>
      writeContract(wagmiConfig, {
        address: it.token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [crystal, it.amount], // exact amount, never unlimited
        chainId: TARGET_CHAIN.id,
        account,
      }),
  }));

  const tokens = items.map((i) => i.token);
  const amounts = items.map((i) => i.amount);

  if (target.kind === 'forge') {
    steps.push({
      label: 'Forging crystal',
      send: async () => {
        const { request } = await simulateContract(wagmiConfig, {
          address: crystal,
          abi: prismCrystalAbi,
          functionName: 'forge',
          args: [tokens, amounts],
          value: ethWei,
          chainId: TARGET_CHAIN.id,
          account,
        });
        return writeContract(wagmiConfig, request);
      },
      after: (receipt) => {
        const [ev] = parseEventLogs({ abi: prismCrystalAbi, eventName: 'Forged', logs: receipt.logs });
        if (ev) opts.onForged?.(ev.args.id);
      },
    });
  } else {
    steps.push({
      label: `Adding to crystal #${target.id}`,
      send: async () => {
        const { request } = await simulateContract(wagmiConfig, {
          address: crystal,
          abi: prismCrystalAbi,
          functionName: 'addTo',
          args: [target.id, tokens, amounts],
          value: ethWei,
          chainId: TARGET_CHAIN.id,
          account,
        });
        return writeContract(wagmiConfig, request);
      },
    });
  }
  return steps;
}
