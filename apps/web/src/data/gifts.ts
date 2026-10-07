import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { getDeployment, giftOf, giftsReceived, linksFromLogs, noteFromInput, type Gift, type GiftContracts } from '@prism/core';
import { TARGET_CHAIN } from '../wallet/config';
import { useCrystalEvents } from './activity';
import { testnetClient } from './chain';

/**
 * Contracts that move crystals without being a gift themselves: Swap & forge's router (its
 * hand-off isn't a gift) and PrismGiftLinks (a claimed link is a gift from the link's maker).
 */
export const giftContracts = (): GiftContracts => {
  const d = getDeployment(TARGET_CHAIN.id);
  return { router: d?.forgeRouter, giftLinks: d?.giftLinks };
};

/** Gifts `owner` holds right now (from the contract's Transfer events), by crystal id. */
export function useReceivedGifts(owner: Address | undefined) {
  const events = useCrystalEvents();
  const gifts = useMemo(() => (owner && events.data ? giftsReceived(events.data, owner, giftContracts()) : new Map<bigint, Gift>()), [owner, events.data]);
  return { gifts, loading: events.isLoading };
}

/** Crystal `id`'s latest gift, or null if it was never given (undefined while loading). */
export function useGift(id: bigint | null) {
  const events = useCrystalEvents();
  const gift = useMemo(() => (id === null || !events.data ? undefined : giftOf(events.data, id, giftContracts())), [id, events.data]);
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
      // a gift link's note is in the link's LinkCreated event
      if (gift!.via === 'link' && gift!.linkTx) {
        const receipt = await testnetClient.getTransactionReceipt({ hash: gift!.linkTx });
        const link = linksFromLogs(receipt.logs).find((l) => l.crystalId === gift!.id);
        return link?.note.trim() || null;
      }
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
