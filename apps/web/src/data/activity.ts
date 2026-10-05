import { useQuery } from '@tanstack/react-query';
import { blockTimes, getDeployment, readCrystalEvents } from '@prism/core';
import { TARGET_CHAIN } from '../wallet/config';
import { testnetClient } from './chain';

/** Every PrismCrystal event since deployment (forges, deposits, seals, transfers, burns). */
export function useCrystalEvents() {
  const deployment = getDeployment(TARGET_CHAIN.id);
  return useQuery({
    queryKey: ['crystal-events', deployment?.prismCrystal],
    enabled: !!deployment,
    refetchInterval: 60_000,
    queryFn: () => readCrystalEvents(testnetClient, deployment!),
  });
}

/** Unix seconds for the given blocks (exact, from each block header). */
export function useBlockTimes(blocks: bigint[]) {
  const key = [...new Set(blocks.map(String))].sort().join(',');
  return useQuery({
    queryKey: ['block-times', key],
    enabled: blocks.length > 0,
    staleTime: Infinity,
    queryFn: () => blockTimes(testnetClient, blocks),
  });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export function timeAgo(unix: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} day${s < 2 * 86400 ? '' : 's'} ago`;
  return new Date(unix * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
