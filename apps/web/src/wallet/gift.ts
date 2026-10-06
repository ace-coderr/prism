import type { Address } from 'viem';
import { simulateContract } from 'wagmi/actions';
import { encodeNote, prismCrystalAbi, type GiftStep } from '@prism/core';
import { TARGET_CHAIN, wagmiConfig } from './config';
import type { StepDef } from './steps';

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString();

/**
 * The gift's transactions in order (planGift decides them): "Seal 1/2" locks the crystal
 * until the opening time while it is still yours, then "Send 2/2" is
 * safeTransferFrom(you, them, id, note). Each is simulated first so a revert shows a
 * readable reason before the wallet prompt.
 */
export function giftSteps(opts: {
  crystal: Address;
  account: Address;
  id: bigint;
  to: Address;
  /** "@name" or a short address, for the step label */
  toLabel: string;
  note: string;
  unlock: number | null;
  steps: GiftStep[];
}): StepDef[] {
  const { crystal, account, id, to, toLabel, note, unlock, steps } = opts;
  const n = steps.length;
  return steps.map((kind, i) =>
    kind === 'seal'
      ? {
          label: `Seal ${i + 1}/${n}: closed until ${fmtDate(unlock!)}`,
          tx: {
            description: `Seal crystal #${id} until ${fmtDate(unlock!)}: nobody can take anything out before then, not even you. A seal can't be shortened.`,
            action: 'Seal crystal',
            contract: 'PrismCrystal',
          },
          send: async (write) => {
            const { request } = await simulateContract(wagmiConfig, {
              address: crystal,
              abi: prismCrystalAbi,
              functionName: 'seal',
              args: [id, BigInt(unlock!)],
              chainId: TARGET_CHAIN.id,
              account,
            });
            return write(request);
          },
        }
      : {
          label: `Send ${i + 1}/${n}: crystal #${id} to ${toLabel}`,
          tx: {
            description: `Give crystal #${id} to ${toLabel}${note ? ', with your note' : ''}. It leaves your wallet for good.`,
            action: 'Send gift',
            contract: 'PrismCrystal',
          },
          send: async (write) => {
            const { request } = await simulateContract(wagmiConfig, {
              address: crystal,
              abi: prismCrystalAbi,
              functionName: 'safeTransferFrom',
              args: [account, to, id, encodeNote(note)],
              chainId: TARGET_CHAIN.id,
              account,
            });
            return write(request);
          },
        },
  );
}
