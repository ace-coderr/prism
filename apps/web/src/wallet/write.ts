import { useCallback } from 'react';
import { encodeFunctionData, type Abi, type ContractFunctionArgs, type ContractFunctionName, type Hash } from 'viem';
import { useAccount } from 'wagmi';
import { writeContract, type WriteContractParameters } from 'wagmi/actions';
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

// inside, a request is just passed on (the Writer type above checks it at each call site)
type AnyRequest = unknown;

/** Browser wallets: wagmi as always (the wallet shows its own confirmation). */
const wagmiWrite = ((request: AnyRequest) => writeContract(wagmiConfig, request as never)) as Writer;

function useWagmiWriters(): (tx: TxDescription) => Writer {
  return useCallback(() => wagmiWrite, []);
}

/**
 * With Privy: an embedded wallet sends through Privy's `sendTransaction`, so its confirmation
 * screen (in PRISM's colours) says in plain words what the transaction does. A browser wallet
 * the user logged in with still goes through wagmi and shows its own confirmation.
 */
function usePrivyWriters(): (tx: TxDescription) => Writer {
  const { sendTransaction } = useSendTransaction();
  const { wallets } = useWallets();
  const { address } = useAccount();
  return useCallback(
    (tx: TxDescription) => {
      const write = async (request: AnyRequest) => {
        const active = wallets.find((w) => !!address && w.address.toLowerCase() === address.toLowerCase());
        if (!active || !isEmbeddedWallet(active)) return writeContract(wagmiConfig, request as never);
        const r = request as unknown as { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
        const data = encodeFunctionData({ abi: r.abi, functionName: r.functionName, args: r.args ?? [] });
        const { hash } = await sendTransaction(
          { to: r.address, data, value: r.value ?? 0n, chainId: TARGET_CHAIN.id },
          {
            address: active.address,
            uiOptions: {
              description: tx.description,
              buttonText: 'Confirm',
              transactionInfo: {
                title: 'Details',
                action: tx.action,
                contractInfo: { name: tx.contract ?? 'PRISM', url: explorerAddressUrl(r.address) },
              },
              successHeader: 'Sent to Robinhood Chain',
              successDescription: 'PRISM shows it once the block confirms it.',
              isCancellable: true,
            },
          },
        );
        return hash;
      };
      return write as Writer;
    },
    [address, wallets, sendTransaction],
  );
}

/** Makes the writer for each transaction step (chosen once: Privy when its app ID is set). */
export const useWriters: () => (tx: TxDescription) => Writer = PRIVY_APP_ID ? usePrivyWriters : useWagmiWriters;
