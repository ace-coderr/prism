import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useReadContract, useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { atName, getDeployment, identicon, nameProblem, prismProfilesAbi, type CrystalHistory, type Holding } from '@prism/core';
import { CrystalThumb } from '../components/CrystalThumb';
import { TARGET_CHAIN } from '../wallet/config';
import { testnetClient, useTestnetTokens } from './chain';
import { profileHref } from './share';
import { holdingsFromAssets, marketLookup, realCrystalHistory } from './crystalHoldings';
import { earliestForge, useGalleryCrystals } from './crystals';

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** "@name" once they have one, else the short address. */
export const atNameOrShort = (a: string, name?: string | null) => (name ? atName(name) : shortAddress(a));

/** The PrismProfiles contract, or undefined until it's deployed (profiles stay off). */
export const profilesContract = (): Address | undefined => getDeployment(TARGET_CHAIN.id)?.prismProfiles;

export interface Profile {
  name: string | null;
  /** a crystal the address still owns, or null */
  avatarId: bigint | null;
  bio: string | null;
  x: string | null;
}

export const NO_PROFILE: Profile = { name: null, avatarId: null, bio: null, x: null };

type RawProfile = { name: string; avatarId: bigint; bio: string; x: string };
const toProfile = (r: RawProfile | undefined): Profile =>
  r ? { name: r.name || null, avatarId: r.avatarId > 0n ? r.avatarId : null, bio: r.bio || null, x: r.x || null } : NO_PROFILE;

export { profileHref };

/** Profiles for many addresses (lower-cased keys); empty until PrismProfiles is deployed. */
export function useProfiles(addresses: Array<Address | undefined>) {
  const contract = profilesContract();
  const unique = [...new Set(addresses.filter((a): a is Address => !!a).map((a) => a.toLowerCase() as Address))];
  const reads = useReadContracts({
    contracts: unique.map((a) => ({ address: contract!, abi: prismProfilesAbi, functionName: 'profileOf' as const, args: [a] as const, chainId: TARGET_CHAIN.id })),
    query: { enabled: !!contract && unique.length > 0, staleTime: 60_000 },
  });
  return useMemo(() => {
    const m = new Map<string, Profile>();
    unique.forEach((a, i) => m.set(a, toProfile(reads.data?.[i]?.result as RawProfile | undefined)));
    return m;
  }, [reads.data, unique.join()]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One address's profile (NO_PROFILE until loaded, or while profiles are off). */
export function useProfile(address: Address | undefined) {
  const contract = profilesContract();
  const q = useReadContract({
    address: contract,
    abi: prismProfilesAbi,
    functionName: 'profileOf',
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN.id,
    query: { enabled: !!contract && !!address, staleTime: 30_000 },
  });
  return { profile: toProfile(q.data as RawProfile | undefined), loading: !!contract && !!address && q.isLoading, refetch: q.refetch };
}

/** Who holds `name` (null = nobody); undefined while loading or while profiles are off. */
export function useAddressOfName(name: string | undefined) {
  const contract = profilesContract();
  return useQuery({
    queryKey: ['address-of-name', contract, name],
    enabled: !!contract && !!name,
    staleTime: 30_000,
    queryFn: async () => {
      const a = await testnetClient.readContract({ address: contract!, abi: prismProfilesAbi, functionName: 'addressOfName', args: [name!] });
      return /^0x0+$/.test(a) ? null : a;
    },
  });
}

export type Availability = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'yours';

/** Live check of a wanted username: rules first (app + contract), then who holds it on-chain. */
export function useNameAvailability(wanted: string, me: Address | undefined) {
  const contract = profilesContract();
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
        const holder = await testnetClient.readContract({ address: contract, abi: prismProfilesAbi, functionName: 'addressOfName', args: [wanted] });
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

/** Shape of every existing crystal by id (live prices; snapshot until then), for avatars. */
export function useCrystalShapes() {
  const gallery = useGalleryCrystals();
  const live = useTestnetTokens(earliestForge(gallery.crystals ?? undefined));
  return useMemo(() => {
    const marketOf = marketLookup(live.status === 'live' ? live.tokens : undefined);
    const m = new Map<bigint, { holdings: Holding[]; history?: CrystalHistory; sealed: boolean }>();
    for (const c of gallery.crystals ?? []) {
      m.set(c.id, {
        holdings: holdingsFromAssets(c.assets, marketOf).holdings,
        history: realCrystalHistory(live, c) ?? gallery.snapshotHistory.get(c.id) ?? undefined,
        sealed: c.sealedUntil * 1000 > Date.now(),
      });
    }
    return m;
  }, [gallery.crystals, gallery.snapshotHistory, live]);
}

/**
 * A small avatar: the address's chosen crystal (drawn flat), or its voxel gem identicon.
 * Rounded square, on the page's ink.
 */
export function Avatar({ address, avatarId, size = 24, className = '' }: { address: Address; avatarId?: bigint | null; size?: number; className?: string }) {
  const shapes = useCrystalShapes();
  const shape = avatarId ? shapes.get(avatarId) : undefined;
  const gem = useMemo(() => identicon(address), [address]);
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-[30%] bg-ink ring-1 ring-white/10 ${className}`}
      style={{ width: size, height: size }}
    >
      {shape ? (
        <CrystalThumb holdings={shape.holdings} history={shape.history} sealed={shape.sealed} size={Math.round(size * 0.9)} />
      ) : (
        <CrystalThumb holdings={gem.holdings} hue={gem.hue} size={Math.round(size * 0.9)} />
      )}
    </span>
  );
}

/**
 * An owner wherever one appears: avatar + @name (or the short address), linking to their
 * public profile. The full address is always the tooltip.
 */
export function OwnerChip({
  address,
  profile,
  size = 20,
  link = true,
  className = '',
}: {
  address: Address;
  profile?: Profile;
  size?: number;
  link?: boolean;
  className?: string;
}) {
  const label = profile?.name ? atName(profile.name) : shortAddress(address);
  const body = (
    <>
      <Avatar address={address} avatarId={profile?.avatarId} size={size} />
      <span className="truncate">{label}</span>
    </>
  );
  const cls = `inline-flex min-w-0 items-center gap-1.5 align-middle ${className}`;
  return link ? (
    <Link to={profileHref(address, profile?.name)} title={address} className={`${cls} hover:text-lime`} onClick={(e) => e.stopPropagation()}>
      {body}
    </Link>
  ) : (
    <span title={address} className={cls}>
      {body}
    </span>
  );
}
