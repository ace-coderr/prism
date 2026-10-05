/**
 * What an address has done with PRISM, from the PrismCrystal contract's own events only:
 * an activity feed (forged, added, withdrew, sealed, gifted, received, burned), who forged
 * what (crystals forged through PrismForgeRouter count for the person it handed them to),
 * and badges. Read-only.
 */
import { parseEventLogs, type Address, type Hash, type PublicClient } from 'viem';
import { prismCrystalAbi } from './abi/prismCrystal';
import type { PrismDeployment } from './deployments';
import { blockRanges } from './onchain';
import { LOG_RANGE } from './reader';

const ZERO = '0x0000000000000000000000000000000000000000';
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export type CrystalEventKind = 'forged' | 'added' | 'withdrawn' | 'sealed' | 'burned' | 'transfer';

export interface CrystalEvent {
  kind: CrystalEventKind;
  id: bigint;
  block: bigint;
  logIndex: number;
  tx: Hash;
  /** forged: minted to · added: by · withdrawn / burned: sent to */
  account?: Address;
  /** transfer only */
  from?: Address;
  to?: Address;
  /** sealed only (unix seconds) */
  unlockTime?: number;
  /** forged / added / withdrawn / burned: how many assets moved */
  assets?: number;
}

const KINDS: Record<string, CrystalEventKind> = {
  Forged: 'forged',
  Added: 'added',
  Withdrawn: 'withdrawn',
  Sealed: 'sealed',
  Burned: 'burned',
  Transfer: 'transfer',
};

/** Every PrismCrystal event since deployment, oldest first, in RPC-safe block ranges. */
export async function readCrystalEvents(client: PublicClient, d: PrismDeployment): Promise<CrystalEvent[]> {
  const head = await client.getBlockNumber();
  const out: CrystalEvent[] = [];
  for (const [a, b] of blockRanges(d.fromBlock, head, LOG_RANGE)) {
    const logs = await client.getLogs({ address: d.prismCrystal, fromBlock: a, toBlock: b });
    for (const l of parseEventLogs({ abi: prismCrystalAbi, logs })) {
      const kind = KINDS[l.eventName];
      if (!kind) continue;
      const args = l.args as Record<string, unknown>;
      const base = { kind, block: l.blockNumber, logIndex: l.logIndex, tx: l.transactionHash };
      if (kind === 'transfer') {
        out.push({ ...base, id: args.tokenId as bigint, from: args.from as Address, to: args.to as Address });
      } else if (kind === 'sealed') {
        out.push({ ...base, id: args.id as bigint, unlockTime: Number(args.unlockTime) });
      } else {
        const tokens = (args.tokens as unknown[] | undefined) ?? [];
        const eth = (args.eth as bigint | undefined) ?? 0n;
        out.push({
          ...base,
          id: args.id as bigint,
          account: (args.owner ?? args.by ?? args.to) as Address,
          assets: tokens.length + (eth > 0n ? 1 : 0),
        });
      }
    }
  }
  return sortEvents(out);
}

export const sortEvents = (events: CrystalEvent[]) =>
  [...events].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));

const before = (e: CrystalEvent, pos: CrystalEvent) => e.block < pos.block || (e.block === pos.block && e.logIndex < pos.logIndex);

/** Who held crystal `id` just before `pos` (ignoring the burn's transfer to 0x0). */
function holderBefore(events: CrystalEvent[], id: bigint, pos: CrystalEvent): Address | null {
  let holder: Address | null = null;
  for (const e of events) {
    if (!before(e, pos)) break;
    if (e.kind === 'transfer' && e.id === id && !same(e.to, ZERO)) holder = e.to!;
  }
  return holder;
}

/**
 * The person behind a Forged event: its owner, unless that's the router, in which case
 * whoever the router handed the new crystal to in the same transaction.
 */
export function forgerOf(events: CrystalEvent[], forged: CrystalEvent, router?: Address | null): Address | null {
  if (!router || !same(forged.account, router)) return forged.account ?? null;
  const handoff = events.find((e) => e.kind === 'transfer' && e.tx === forged.tx && e.id === forged.id && same(e.from, router));
  return handoff?.to ?? null;
}

export type ActivityKind = 'forged' | 'added' | 'withdrew' | 'sealed' | 'gifted' | 'received' | 'burned';

export interface ActivityItem {
  kind: ActivityKind;
  id: bigint;
  block: bigint;
  logIndex: number;
  tx: Hash;
  /** gifted: to whom · received: from whom */
  counterparty?: Address;
  unlockTime?: number;
  assets?: number;
}

/** Everything `user` did (or received), newest first. */
export function activityOf(events: CrystalEvent[], user: Address, router?: Address | null): ActivityItem[] {
  const out: ActivityItem[] = [];
  const item = (e: CrystalEvent, kind: ActivityKind, extra: Partial<ActivityItem> = {}) =>
    out.push({ kind, id: e.id, block: e.block, logIndex: e.logIndex, tx: e.tx, unlockTime: e.unlockTime, assets: e.assets, ...extra });
  for (const e of events) {
    switch (e.kind) {
      case 'forged':
        if (same(forgerOf(events, e, router), user)) item(e, 'forged');
        break;
      case 'transfer':
        // mints, burns and the router's forge hand-off are not gifts
        if (same(e.from, ZERO) || same(e.to, ZERO) || same(e.from, router)) break;
        if (same(e.from, user)) item(e, 'gifted', { counterparty: e.to });
        else if (same(e.to, user)) item(e, 'received', { counterparty: e.from });
        break;
      case 'added':
        if (same(e.account, user)) item(e, 'added');
        break;
      case 'withdrawn':
      case 'sealed':
      case 'burned':
        if (same(holderBefore(events, e.id, e), user)) item(e, e.kind === 'withdrawn' ? 'withdrew' : e.kind);
        break;
    }
  }
  return out.reverse();
}

/** Crystals `user` forged, oldest first. */
export const forgedBy = (events: CrystalEvent[], user: Address, router?: Address | null) =>
  activityOf(events, user, router)
    .filter((a) => a.kind === 'forged')
    .reverse();

/** Block → unix seconds for the given blocks (one getBlock each, batched by the client). */
export async function blockTimes(client: PublicClient, blocks: bigint[]): Promise<Map<bigint, number>> {
  const unique = [...new Set(blocks)];
  const got = await Promise.all(unique.map((n) => client.getBlock({ blockNumber: n })));
  return new Map(got.map((b) => [b.number!, Number(b.timestamp)]));
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export const EARLY_MAX_ID = 100n;
export const DIVERSIFIED_MIN_ASSETS = 5;

export type BadgeId = 'first-forge' | 'kintsugi' | 'diversified' | 'gifter' | 'sealed' | 'early';

export interface Badge {
  id: BadgeId;
  name: string;
  /** shown when earned */
  earned: string;
  /** shown when not earned yet */
  how: string;
}

export const BADGES: readonly Badge[] = [
  { id: 'first-forge', name: 'First Forge', earned: 'Forged a crystal.', how: 'Forge your first crystal.' },
  { id: 'kintsugi', name: 'Kintsugi', earned: 'Owns a crystal with a gold seam.', how: 'Hold a crystal through a 5%+ drop that recovers.' },
  { id: 'diversified', name: 'Diversified', earned: 'Owns a crystal with 5+ assets.', how: 'Put 5 or more assets in one crystal.' },
  { id: 'gifter', name: 'Gifter', earned: 'Gave a crystal to someone.', how: 'Send one of your crystals to another wallet.' },
  { id: 'sealed', name: 'Sealed', earned: 'Sealed a crystal as a gift.', how: 'Seal a crystal until a date you pick.' },
  { id: 'early', name: 'Early', earned: 'Owns one of the first 100 crystals.', how: 'Own a crystal numbered 1 to 100.' },
];

export interface BadgeInput {
  activity: ActivityItem[];
  /** crystals the address owns now */
  owned: Array<{ id: bigint; assets: number; goldSeams: number }>;
}

/** Every badge with whether `input` earned it (all from real events and holdings). */
export function badgesOf({ activity, owned }: BadgeInput): Array<Badge & { isEarned: boolean }> {
  const did = (k: ActivityKind) => activity.some((a) => a.kind === k);
  const earned: Record<BadgeId, boolean> = {
    'first-forge': did('forged'),
    kintsugi: owned.some((c) => c.goldSeams > 0),
    diversified: owned.some((c) => c.assets >= DIVERSIFIED_MIN_ASSETS),
    gifter: did('gifted'),
    sealed: did('sealed'),
    early: owned.some((c) => c.id >= 1n && c.id <= EARLY_MAX_ID),
  };
  return BADGES.map((b) => ({ ...b, isEarned: earned[b.id] }));
}
