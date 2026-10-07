import { useCallback } from 'react';
import { encodeFunctionData, type Abi, type Address, type ContractFunctionArgs, type ContractFunctionName, type Hash } from 'viem';
import { useAccount } from 'wagmi';
import { sendTransaction as wagmiSendTransaction, writeContract, type WriteContractParameters } from 'wagmi/actions';
import { useSendTransaction, useWallets } from '@privy-io/react-auth';
import { explorerAddressUrl } from '@prism/core';
import { isEmbeddedWallet } from './account';
import { PRIVY_APP_ID, TARGET_CHAIN, wagmiConfig } from './config';

/** What the confirmation screen of an embedded wallet says about one transaction. */
export interface TxDescription {
  /** one plain sentence: what this transaction does */
  description: string;
  /** a few words, e.g. "Swap & forge" */
  action: string;
  /** the contract being called, by name */
  contract?: string;
}

/** Sends a contract call (usually a simulated `request`) and returns its hash. */
export type Writer = <
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
  args extends ContractFunctionArgs<abi, 'nonpayable' | 'payable', functionName>,
>(
  request: WriteContractParameters<abi, functionName, args, typeof wagmiConfig>,
) => Promise<Hash>;

/** Sends plain ETH to an address and returns the hash. */
export type Transfer = (to: Address, value: bigint) => Promise<Hash>;

/** What a transaction step sends with: contract calls and plain ETH transfers. */
export interface Senders {
  write: Writer;
  transfer: Transfer;
}

// inside, a request is just passed on (the Writer type above checks it at each call site)
type AnyRequest = unknown;

/** Browser wallets: wagmi as always (the wallet shows its own confirmation). */
const wagmiSenders: Senders = {
  write: ((request: AnyRequest) => writeContract(wagmiConfig, request as never)) as Writer,
  transfer: (to, value) => wagmiSendTransaction(wagmiConfig, { to, value, chainId: TARGET_CHAIN.id }),
};

function useWagmiSenders(): (tx: TxDescription) => Senders {
  return useCallback(() => wagmiSenders, []);
}

/**
 * With Privy: an embedded wallet sends through Privy's `sendTransaction`, so its confirmation
 * screen (in PRISM's colours) says in plain words what the transaction does. A browser wallet
 * the user logged in with still goes through wagmi and shows its own confirmation.
 */
function usePrivySenders(): (tx: TxDescription) => Senders {
  const { sendTransaction } = useSendTransaction();
  const { wallets } = useWallets();
  const { address } = useAccount();
  return useCallback(
    (tx: TxDescription) => {
      const embedded = () => {
        const active = wallets.find((w) => !!address && w.address.toLowerCase() === address.toLowerCase());
        return active && isEmbeddedWallet(active) ? active : null;
      };
      // Privy's confirmation screen, with PRISM's words for what this transaction does
      const send = async (to: Address, data: `0x${string}` | undefined, value: bigint, from: string) => {
        const { hash } = await sendTransaction(
          { to, data, value, chainId: TARGET_CHAIN.id },
          {
            address: from,
            uiOptions: {
              description: tx.description,
              buttonText: 'Confirm',
              transactionInfo: {
                title: 'Details',
                action: tx.action,
                contractInfo: { name: tx.contract ?? 'PRISM', url: explorerAddressUrl(to) },
              },
              successHeader: 'Sent to Robinhood Chain',
              successDescription: 'PRISM shows it once the block confirms it.',
              isCancellable: true,
            },
          },
        );
        return hash;
      };
      const write = async (request: AnyRequest) => {
        const active = embedded();
        if (!active) return writeContract(wagmiConfig, request as never);
        const r = request as unknown as { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
        const data = encodeFunctionData({ abi: r.abi, functionName: r.functionName, args: r.args ?? [] });
        return send(r.address, data, r.value ?? 0n, active.address);
      };
      const transfer: Transfer = async (to, value) => {
        const active = embedded();
        if (!active) return wagmiSenders.transfer(to, value);
        return send(to, undefined, value, active.address);
      };
      return { write: write as Writer, transfer };
    },
    [address, wallets, sendTransaction],
  );
}

/** Makes the senders for each transaction step (chosen once: Privy when its app ID is set). */
export const useSenders: () => (tx: TxDescription) => Senders = PRIVY_APP_ID ? usePrivySenders : useWagmiSenders;
