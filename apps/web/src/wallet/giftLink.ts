import { formatEther, parseEventLogs, type Address } from 'viem';
import { simulateContract } from 'wagmi/actions';
import { linkData, prismCrystalAbi, prismGiftLinksAbi } from '@prism/core';
import { TARGET_CHAIN, wagmiConfig } from './config';
import type { StepDef } from './steps';

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString();

/**
 * A gift link's transactions: [Seal] (until the opening date, while it's still yours) →
 * Create the link (safeTransferFrom into PrismGiftLinks with the claim key's address, the
 * expiry and the note) → Gas money (a little test ETH to the claim key, so the claim can pay
 * its own fee; the rest goes to whoever claims it).
 */
export function giftLinkSteps(opts: {
  crystal: Address;
  giftLinks: Address;
  account: Address;
  id: bigint;
  claimKey: Address;
  expiry: number;
  note: string;
  /** seal until this time first (null: no seal) */
  unlock: number | null;
  gas: bigint;
  onCreated: (linkId: bigint) => void;
}): StepDef[] {
  const { crystal, giftLinks, account, id, claimKey, expiry, note, unlock, gas } = opts;
  const steps: StepDef[] = [];
  if (unlock !== null) {
    steps.push({
      label: `Seal: closed until ${fmtDate(unlock)}`,
      tx: {
        description: `Seal crystal #${id} until ${fmtDate(unlock)}: nobody can take anything out before then, not even you. A seal can't be shortened.`,
        action: 'Seal crystal',
        contract: 'PrismCrystal',
      },
      send: async (write) => {
        const { request } = await simulateContract(wagmiConfig, {
          address: crystal,
          abi: prismCrystalAbi,
          functionName: 'seal',
          args: [id, BigInt(unlock)],
          chainId: TARGET_CHAIN.id,
          account,
        });
        return write(request);
      },
    });
  }
  steps.push({
    label: `Create the link for crystal #${id}`,
    tx: {
      description: `Put crystal #${id} into a gift link. Whoever opens the link can claim it until ${fmtDate(expiry)}; until then you can take it back.`,
      action: 'Create gift link',
      contract: 'PrismGiftLinks',
    },
    send: async (write) => {
      const { request } = await simulateContract(wagmiConfig, {
        address: crystal,
        abi: prismCrystalAbi,
        functionName: 'safeTransferFrom',
        args: [account, giftLinks, id, linkData(claimKey, expiry, note)],
        chainId: TARGET_CHAIN.id,
        account,
      });
      return write(request);
    },
    after: (receipt) => {
      const [ev] = parseEventLogs({ abi: prismGiftLinksAbi, eventName: 'LinkCreated', logs: receipt.logs });
      if (ev) opts.onCreated(ev.args.linkId);
    },
  });
  steps.push(gasStep(claimKey, gas));
  return steps;
}

/** Send the link's gas money (also used to top up a link whose gas step didn't go through). */
export const gasStep = (claimKey: Address, gas: bigint): StepDef => ({
  label: `Gas money for the claim: ${formatEther(gas)} ETH`,
  tx: {
    description: `Send ${formatEther(gas)} test ETH to the link's one-time key, so claiming costs the recipient nothing. What's left after the claim goes to them.`,
    action: 'Add gas money',
  },
  send: (_write, transfer) => transfer(claimKey, gas),
});
