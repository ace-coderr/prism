import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { getDeployment, giftOf, giftsReceived, noteFromInput, type Gift } from '@prism/core';
import { TARGET_CHAIN } from '../wallet/config';
import { useCrystalEvents } from './activity';
import { testnetClient } from './chain';

/** Swap & forge mints to the router, which then hands the crystal over: that's not a gift. */
const router = () => getDeployment(TARGET_CHAIN.id)?.forgeRouter;

/** Gifts `owner` holds right now (from the contract's Transfer events), by crystal id. */
export function useReceivedGifts(owner: Address | undefined) {
  const events = useCrystalEvents();
  const gifts = useMemo(() => (owner && events.data ? giftsReceived(events.data, owner, router()) : new Map<bigint, Gift>()), [owner, events.data]);
  return { gifts, loading: events.isLoading };
}

/** Crystal `id`'s latest gift, or null if it was never given (undefined while loading). */
export function useGift(id: bigint | null) {
  const events = useCrystalEvents();
  const gift = useMemo(() => (id === null || !events.data ? undefined : giftOf(events.data, id, router())), [id, events.data]);
  return { gift, error: events.isError };
}

/**
 * The note sent with a gift: ERC-721 doesn't store safeTransferFrom's `data`, so it is read
 * from the gift transaction's input. null = no note (or one that can't be read).
 */
export function useGiftNote(gift: Gift | null | undefined) {
  return useQuery({
    queryKey: ['gift-note', gift?.tx, gift?.id.toString()],
    enabled: !!gift,
    staleTime: Infinity,
    queryFn: async () => {
      const tx = await testnetClient.getTransaction({ hash: gift!.tx });
      return noteFromInput(tx.input, { from: gift!.from, to: gift!.to, id: gift!.id });
    },
  });
}

// ---------------------------------------------------------------------------
// Which gifts this wallet has unwrapped (kept in this browser only)
// ---------------------------------------------------------------------------

const openedKey = (owner: Address) => `prism.gifts.opened.${owner.toLowerCase()}`;

/** Ids unwrapped by `owner` in this browser; null when storage can't be used. */
function readOpened(owner: Address): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(openedKey(owner));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return null;
  }
}

/**
 * Received gifts stay wrapped until their owner unwraps them. Without browser storage
 * there's nowhere to remember that, so gifts simply show unwrapped.
 */
export function useOpenedGifts(owner: Address | undefined) {
  const [opened, setOpened] = useState<Set<string> | null>(() => (owner ? readOpened(owner) : new Set()));
  useEffect(() => setOpened(owner ? readOpened(owner) : new Set()), [owner]);
  const isWrapped = useCallback((id: bigint) => opened !== null && !opened.has(id.toString()), [opened]);
  const markOpened = useCallback(
    (id: bigint) => {
      if (!owner) return;
      const next = new Set(opened ?? []).add(id.toString());
      try {
        window.localStorage.setItem(openedKey(owner), JSON.stringify([...next]));
        setOpened(next);
      } catch {
        setOpened(null); // can't remember: show every gift unwrapped
      }
    },
    [owner, opened],
  );
  return { isWrapped, markOpened };
}

/** The current time (unix s), ticking every `ms` for countdowns. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
