import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatUnits, type Address } from 'viem';
import {
  crystalFromWire,
  getDeployment,
  prismCrystalAbi,
  readAllCrystals,
  readCrystalsOf,
  type OnchainCrystal,
  type PublicCrystal,
} from '@prism/core';
import { TARGET_CHAIN } from '../wallet/config';
import { testnetClient, useTestnetTokens } from './chain';
import { useSnapshot } from './snapshot';

export { earliestForge, type CrystalAsset, type OnchainCrystal, type PublicCrystal } from '@prism/core';

/** The connected wallet's real crystals (read-only). */
export function useMyCrystals(owner: Address | undefined) {
  const deployment = getDeployment(TARGET_CHAIN.id);
  return useQuery({
    queryKey: ['my-crystals', deployment?.prismCrystal, owner],
    enabled: !!owner && !!deployment,
    refetchInterval: 30_000,
    queryFn: (): Promise<OnchainCrystal[]> => readCrystalsOf(testnetClient, deployment!, owner!),
  });
}

/** Every real crystal that still exists, plus how many were ever forged (live). */
export function useAllCrystals() {
  const deployment = getDeployment(TARGET_CHAIN.id);
  return useQuery({
    queryKey: ['all-crystals', deployment?.prismCrystal],
    enabled: !!deployment,
    refetchInterval: 60_000,
    queryFn: () => readAllCrystals(testnetClient, deployment!),
  });
}

/**
 * All crystals for the Gallery: the live read once it lands, the cached snapshot (with
 * its server-side cracks and seams) until then, so the page fills in instantly.
 */
export function useGalleryCrystals() {
  const all = useAllCrystals();
  const snapshot = useSnapshot();
  const fromSnapshot = useMemo(() => snapshot.data?.crystals?.map(crystalFromWire) ?? null, [snapshot.data]);
  const crystals: PublicCrystal[] | null = all.data?.crystals ?? fromSnapshot;
  const snapshotHistory = useMemo(() => new Map((fromSnapshot ?? []).map((c) => [c.id, c.history])), [fromSnapshot]);
  return {
    crystals,
    snapshotHistory,
    live: all.isSuccess,
    loading: crystals === null && (all.isLoading || snapshot.isLoading),
    error: crystals === null && all.isError,
  };
}

/**
 * Headline numbers, all read from the chain: crystals ever forged (Forged events),
 * distinct current owners, ETH held across all crystals (the contract's own ledger)
 * and how many test stocks pass their on-chain checks right now. Live values replace
 * the cached snapshot's as they arrive.
 */
export function useChainStats() {
  const deployment = getDeployment(TARGET_CHAIN.id);
  const all = useAllCrystals();
  const live = useTestnetTokens();
  const snapshot = useSnapshot();
  const eth = useQuery({
    queryKey: ['eth-held', deployment?.prismCrystal],
    enabled: !!deployment,
    refetchInterval: 60_000,
    queryFn: () => testnetClient.readContract({ address: deployment!.prismCrystal, abi: prismCrystalAbi, functionName: 'totalEthRecorded' }),
  });
  const cached = snapshot.data?.stats;
  return {
    forged: all.data?.forged ?? cached?.forged ?? null,
    owners: all.data ? new Set(all.data.crystals.map((c) => c.owner.toLowerCase())).size : (cached?.owners ?? null),
    ethHeld: eth.data !== undefined ? Number(formatUnits(eth.data, 18)) : (cached?.ethHeld ?? null),
    stocks: live.status === 'live' ? live.tokens.filter((t) => t.kind !== 'crypto').length : (cached?.stocks ?? null),
  };
}
