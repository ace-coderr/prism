import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseSnapshot, type Snapshot } from '@prism/core';
import { seedFromSnapshot } from './chain';

/**
 * The cached chain snapshot from /api/snapshot (built server-side, cached 5 minutes by
 * the CDN): what the first screen renders from while the browser reads the chain live.
 * Anything that isn't a valid snapshot (e.g. a host without the function) is ignored and
 * the app simply loads live.
 */
async function fetchSnapshot(): Promise<Snapshot | null> {
  const res = await fetch('/api/snapshot', { headers: { accept: 'application/json' } });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return null;
  return parseSnapshot(await res.json());
}

export function useSnapshot() {
  const q = useQuery({ queryKey: ['snapshot'], queryFn: fetchSnapshot, staleTime: 5 * 60_000, retry: 1 });
  // prices from the snapshot show at once everywhere live prices are used
  useEffect(() => {
    if (q.data) seedFromSnapshot(q.data);
  }, [q.data]);
  return q;
}
