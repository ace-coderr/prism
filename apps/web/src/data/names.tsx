import { useEffect, useMemo, useState } from 'react';
import { useReadContract, useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { atName, getDeployment, nameProblem, prismNamesAbi } from '@prism/core';
import { TARGET_CHAIN } from '../wallet/config';
import { testnetClient } from './chain';

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The PrismNames contract, or undefined until it's deployed (usernames stay off). */
export const namesContract = (): Address | undefined => getDeployment(TARGET_CHAIN.id)?.prismNames;

/** Usernames for many addresses (lower-cased keys); empty until PrismNames is deployed. */
export function useNames(addresses: Array<Address | undefined>) {
  const contract = namesContract();
  const unique = [...new Set(addresses.filter((a): a is Address => !!a).map((a) => a.toLowerCase() as Address))];
  const reads = useReadContracts({
    contracts: unique.map((a) => ({ address: contract!, abi: prismNamesAbi, functionName: 'nameOf' as const, args: [a] as const, chainId: TARGET_CHAIN.id })),
    query: { enabled: !!contract && unique.length > 0, staleTime: 60_000 },
  });
  return useMemo(() => {
    const m = new Map<string, string>();
    unique.forEach((a, i) => {
      const n = reads.data?.[i]?.result;
      if (typeof n === 'string' && n) m.set(a, n);
    });
    return m;
  }, [reads.data, unique.join()]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One address's username, if it has one. */
export function useName(address: Address | undefined) {
  const contract = namesContract();
  const q = useReadContract({
    address: contract,
    abi: prismNamesAbi,
    functionName: 'nameOf',
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN.id,
    query: { enabled: !!contract && !!address, staleTime: 30_000 },
  });
  return { name: typeof q.data === 'string' && q.data ? q.data : null, refetch: q.refetch };
}

/** "@name" when the address has a username, else the short address; the full address is the tooltip. */
export function Owner({ address, name, className = '' }: { address: Address; name?: string | null; className?: string }) {
  return (
    <span className={className} title={address}>
      {name ? atName(name) : shortAddress(address)}
    </span>
  );
}

export type Availability = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'yours';

/** Live check of a wanted username: rules first (app + contract), then who holds it on-chain. */
export function useNameAvailability(wanted: string, me: Address | undefined) {
  const contract = namesContract();
  const [state, setState] = useState<{ status: Availability; problem: string | null }>({ status: 'idle', problem: null });
  useEffect(() => {
    if (!wanted) return setState({ status: 'idle', problem: null });
    const problem = nameProblem(wanted);
    if (problem) return setState({ status: 'invalid', problem });
    if (!contract) return setState({ status: 'idle', problem: null });
    setState({ status: 'checking', problem: null });
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const holder = await testnetClient.readContract({ address: contract, abi: prismNamesAbi, functionName: 'ownerOfName', args: [wanted] });
        if (!alive) return;
        const free = /^0x0+$/.test(holder);
        setState({ status: free ? 'available' : me && holder.toLowerCase() === me.toLowerCase() ? 'yours' : 'taken', problem: null });
      } catch {
        if (alive) setState({ status: 'idle', problem: 'Couldn’t check right now.' });
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [wanted, contract, me]);
  return state;
}
