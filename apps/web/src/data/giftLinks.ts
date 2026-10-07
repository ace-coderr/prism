import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createWalletClient, http, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getDeployment, prismGiftLinksAbi, readGiftLinks, sweepValue, type GiftLink } from '@prism/core';
import { TARGET_CHAIN } from '../wallet/config';
import { testnetClient } from './chain';

/** PrismGiftLinks on the target chain, or null until it's deployed (link gifts stay off). */
export function giftLinksContract(): { address: Address; fromBlock: bigint } | null {
  const d = getDeployment(TARGET_CHAIN.id);
  return d?.giftLinks ? { address: d.giftLinks, fromBlock: d.giftLinksFromBlock ?? d.fromBlock } : null;
}

/** Every gift link, from the contract's events (refreshed every 20 s). */
export function useGiftLinks() {
  const c = giftLinksContract();
  return useQuery({
    queryKey: ['gift-links', c?.address],
    enabled: !!c,
    staleTime: 10_000,
    refetchInterval: 20_000,
    queryFn: () => readGiftLinks(testnetClient, c!.address, c!.fromBlock),
  });
}

/** One link by id (undefined while loading, null when there's no such link). */
export function useGiftLink(id: bigint | null) {
  const all = useGiftLinks();
  const link: GiftLink | null | undefined = id === null ? null : all.data ? (all.data.find((l) => l.id === id) ?? null) : undefined;
  return { link, error: all.isError, refetch: all.refetch };
}

// ---------------------------------------------------------------------------
// The sender's own links: their claim keys stay in this browser only
// ---------------------------------------------------------------------------

export interface SavedLink {
  /** the one-time claim key's private key (also in the link itself) */
  key: Hex;
  crystalId: string;
  /** set once the link exists on-chain */
  linkId: string | null;
  createdAt: number;
}

const savedKey = (sender: Address) => `prism.giftlinks.${sender.toLowerCase()}`;

function readSaved(sender: Address): SavedLink[] {
  try {
    return JSON.parse(window.localStorage.getItem(savedKey(sender)) ?? '[]') as SavedLink[];
  } catch {
    return [];
  }
}

function writeSaved(sender: Address, links: SavedLink[]): boolean {
  try {
    window.localStorage.setItem(savedKey(sender), JSON.stringify(links));
    return true;
  } catch {
    return false; // storage blocked: the link still works, it just isn't remembered here
  }
}

/** Claim keys this browser made for `sender`'s links. */
export function useSavedLinks(sender: Address | undefined) {
  const [links, setLinks] = useState<SavedLink[]>(() => (sender ? readSaved(sender) : []));
  useEffect(() => setLinks(sender ? readSaved(sender) : []), [sender]);
  const save = useCallback(
    (link: SavedLink) => {
      if (!sender) return;
      const next = [...readSaved(sender).filter((l) => l.key !== link.key), link];
      writeSaved(sender, next);
      setLinks(next);
    },
    [sender],
  );
  const forget = useCallback(
    (key: Hex) => {
      if (!sender) return;
      const next = readSaved(sender).filter((l) => l.key !== key);
      writeSaved(sender, next);
      setLinks(next);
    },
    [sender],
  );
  const keyOf = useCallback((linkId: bigint) => links.find((l) => l.linkId === linkId.toString())?.key ?? null, [links]);
  return { links, save, forget, keyOf };
}

// ---------------------------------------------------------------------------
// Transactions signed by the claim key itself (never by the user's wallet)
// ---------------------------------------------------------------------------

const keyWallet = (key: Hex) =>
  createWalletClient({ account: privateKeyToAccount(key), chain: TARGET_CHAIN, transport: http(TARGET_CHAIN.rpcUrls.default.http[0]) });

/** The claim key claims link `linkId` for `recipient`, paying the fee from its own gas money. */
export async function claimWithKey(key: Hex, linkId: bigint, recipient: Address): Promise<Hash> {
  const c = giftLinksContract();
  if (!c) throw new Error('Gift links aren’t switched on yet.');
  const account = privateKeyToAccount(key);
  if ((await testnetClient.getBalance({ address: account.address })) === 0n) {
    throw new Error('This link has no test ETH left to pay for its claim. Ask the sender to add a little.');
  }
  const { request } = await testnetClient.simulateContract({
    address: c.address,
    abi: prismGiftLinksAbi,
    functionName: 'claim',
    args: [linkId, recipient],
    account,
  });
  return keyWallet(key).writeContract(request);
}

/**
 * Sends whatever test ETH is left on the claim key to `to` (the recipient after a claim, or the
 * sender after a cancel). A legacy transaction at a fixed gas price, so its cost is capped and
 * the rest can go. Null when there's nothing worth sending.
 */
export async function sweepKey(key: Hex, to: Address): Promise<Hash | null> {
  const account = privateKeyToAccount(key);
  const balance = await testnetClient.getBalance({ address: account.address });
  if (balance === 0n) return null;
  const gasPrice = await testnetClient.getGasPrice();
  const gas = ((await testnetClient.estimateGas({ account: account.address, to, value: 1n })) * 3n) / 2n;
  const value = sweepValue(balance, gas, gasPrice);
  if (!value) return null;
  return keyWallet(key).sendTransaction({ to, value, gas, gasPrice, type: 'legacy' });
}
