import { useMemo } from 'react';
import type { Address } from 'viem';
import { DEFAULT_VOLATILITY, TESTNET_TOKENS, buildReplay, type ReplayAssetInfo } from '@prism/core';
import { useCrystalEvents } from './activity';
import { useTestnetTokens } from './chain';
import { useGalleryCrystals } from './crystals';

const known = new Map(TESTNET_TOKENS.map((t) => [t.address.toLowerCase(), t]));

/**
 * Crystal `id`'s replay timeline, from real data only: its own PrismCrystal events (what went
 * in and out, seals, gifts) and the pools' price history from its forge block on (48h by
 * default, reaching back to the forge block up to the history cap).
 */
export function useReplay(id: bigint | null) {
  const gallery = useGalleryCrystals();
  const crystal = id === null ? undefined : gallery.crystals?.find((c) => c.id === id);
  const events = useCrystalEvents();
  const live = useTestnetTokens(crystal?.forgedBlock ?? null);

  const timeline = useMemo(() => {
    if (!crystal || !events.data || live.status !== 'live' || !live.history) return null;
    const h = live.history;
    const market = new Map(live.tokens.map((t) => [t.address.toLowerCase(), t]));
    const weth = live.tokens.find((t) => t.id === 'WETH');
    // symbols and decimals as the crystal itself knows them (now, or when forged)
    const meta = new Map([...crystal.forgedWith, ...crystal.assets].filter((a) => a.token).map((a) => [a.token!.toLowerCase(), a]));
    const info = (token: Address | null): ReplayAssetInfo => {
      if (!token) return { symbol: 'ETH', decimals: 18, eth: null, isEth: true, volatility: weth?.market.volatility ?? DEFAULT_VOLATILITY };
      const k = token.toLowerCase();
      const t = market.get(k) ?? known.get(k);
      const m = meta.get(k);
      return {
        symbol: t?.id ?? m?.symbol ?? `${token.slice(0, 6)}…`,
        decimals: t?.decimals ?? m?.decimals ?? 18,
        eth: t ? (h.eth.get(t.id) ?? null) : null,
        isEth: t?.id === 'WETH',
        volatility: market.get(k)?.market.volatility ?? DEFAULT_VOLATILITY,
      };
    };
    return buildReplay({ id: crystal.id, events: events.data, clock: h.clock, info, ethUsd: h.ethUsd, historyStart: h.clock(h.fromBlock), now: h.nowSec });
  }, [crystal, events.data, live]);

  return {
    crystal,
    timeline,
    loading: gallery.loading || (!!crystal && !timeline && !events.isError && live.status !== 'error'),
    error: events.isError || live.status === 'error',
  };
}
