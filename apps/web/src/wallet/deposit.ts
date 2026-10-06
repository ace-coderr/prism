import { erc20Abi, parseEventLogs, type Address } from 'viem';
import { simulateContract } from 'wagmi/actions';
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
    tx: {
      description: `Let the PRISM crystal contract take exactly the ${it.symbol} you're putting in, and nothing more.`,
      action: `Approve ${it.symbol}`,
      contract: it.symbol,
    },
    send: (write) =>
      write({
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
      tx: { description: 'Forge your crystal from the tokens and ETH you picked. Only you can take them out again.', action: 'Forge crystal', contract: 'PrismCrystal' },
      send: async (write) => {
        const { request } = await simulateContract(wagmiConfig, {
          address: crystal,
          abi: prismCrystalAbi,
          functionName: 'forge',
          args: [tokens, amounts],
          value: ethWei,
          chainId: TARGET_CHAIN.id,
          account,
        });
        return write(request);
      },
      after: (receipt) => {
        const [ev] = parseEventLogs({ abi: prismCrystalAbi, eventName: 'Forged', logs: receipt.logs });
        if (ev) opts.onForged?.(ev.args.id);
      },
    });
  } else {
    steps.push({
      label: `Adding to crystal #${target.id}`,
      tx: { description: `Add the tokens and ETH you picked to crystal #${target.id}.`, action: 'Add to crystal', contract: 'PrismCrystal' },
      send: async (write) => {
        const { request } = await simulateContract(wagmiConfig, {
          address: crystal,
          abi: prismCrystalAbi,
          functionName: 'addTo',
          args: [target.id, tokens, amounts],
          value: ethWei,
          chainId: TARGET_CHAIN.id,
          account,
        });
        return write(request);
      },
    });
  }
  return steps;
}
