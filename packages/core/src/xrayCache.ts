/**
 * The creator watch: what every recent launch's creator has done with their own tokens, worked out
 * on a schedule and published next to the launch index (scripts/warm-xray.ts, XRAY_CACHE_URL).
 *
 * Reading one launch's whole history costs seconds, so the site can't do it for thousands of
 * launches while someone waits. Reading only the transfers into and out of the creator's address is
 * two filtered queries covering the launch's whole life, which is cheap enough to do for every
 * launch of the last week on each scheduled run. That is what this file holds, and it is what the
 * "creators selling" feed and the one-line flags on cards are built from.
 *
 * Nothing here is an opinion: each row is what the chain says that address received and sent.
 */
import type { Address } from 'viem';
import { creatorHolds, type CreatorMoves } from './xray';

export const XRAY_CACHE_VERSION = 1;

/** Published by the scheduled job as an asset of the launch index's release. Public data. */
export const XRAY_CACHE_URL = 'https://github.com/ace-coderr/prism/releases/download/launch-index/launch-xray.json.gz';

/**
 * How often a watched launch is read again, by how old it is.
 *
 * A run can only read so many launches, and reading them all equally often meant a launch's first
 * day — the day a creator selling is news — was refreshed no more often than its seventh. The
 * youngest are read on every run; the rest wait, so the time goes where something is likely to have
 * changed. `upToDays` is exclusive, and the last tier catches everything older.
 */
export const RECHECK_TIERS: ReadonlyArray<{ upToDays: number; everyMs: number; what: string }> = [
  { upToDays: 1, everyMs: 20 * 60_000, what: 'under a day old' },
  { upToDays: 3, everyMs: 6 * 3_600_000, what: '1 to 3 days old' },
  { upToDays: 7, everyMs: 24 * 3_600_000, what: '3 to 7 days old' },
  { upToDays: Number.POSITIVE_INFINITY, everyMs: 72 * 3_600_000, what: 'a week or older' },
];

/** The tier a launch of this age falls in: how often to read it again, and how soon it comes first. */
export function recheckTier(ageDays: number): { index: number; everyMs: number; what: string } {
  const i = RECHECK_TIERS.findIndex((t) => ageDays < t.upToDays);
  const index = i < 0 ? RECHECK_TIERS.length - 1 : i;
  return { index, ...RECHECK_TIERS[index]! };
}

/**
 * How overdue a reading is, as a multiple of its tier's interval: 1 means due now, 2 means it has
 * waited twice as long as it should, Infinity means it has never been read. A run reads the
 * youngest tier first and, within a tier, whatever has waited longest for its own cadence.
 */
export function overdueBy(ageDays: number, checkedAtMs: number | null, now: number): number {
  if (checkedAtMs === null) return Number.POSITIVE_INFINITY;
  return (now - checkedAtMs) / recheckTier(ageDays).everyMs;
}

export interface WatchedCreator {
  token: Address;
  creator: Address;
  moves: CreatorMoves;
  /** the block its transfers were read up to */
  checkedToBlock: number;
  /** unix seconds when it was checked */
  checkedAt: number;
}

/** One launch as a compact row: [token, creator, acquired, movedOut, firstIn, firstOut, biggestOut, biggestOutBlock, checkedToBlock, checkedAt] */
export type XrayRow = [string, string, string, string, number, number, string, number, number, number];

export interface XrayCacheWire {
  version: number;
  chainId: number;
  updatedAt: number;
  rows: XrayRow[];
}

export interface XrayCache {
  chainId: number;
  updatedAt: number;
  /** by lower-case token */
  byToken: Map<string, WatchedCreator>;
}

export const emptyXrayCache = (chainId: number): XrayCache => ({ chainId, updatedAt: 0, byToken: new Map() });

export const toXrayRow = (w: WatchedCreator): XrayRow => [
  w.token.toLowerCase(),
  w.creator.toLowerCase(),
  w.moves.acquired.toString(),
  w.moves.movedOut.toString(),
  w.moves.firstInBlock ?? 0,
  w.moves.firstOutBlock ?? 0,
  w.moves.biggestOut.toString(),
  w.moves.biggestOutBlock ?? 0,
  w.checkedToBlock,
  w.checkedAt,
];

const ADDRESS = /^0x[0-9a-f]{40}$/;
const NUMBER = /^[0-9]{1,40}$/;

/** A row as a watched creator; null when the row isn't one this code understands. */
export function fromXrayRow(r: XrayRow): WatchedCreator | null {
  if (!Array.isArray(r) || r.length !== 10) return null;
  const [token, creator, acquired, movedOut, firstIn, firstOut, biggestOut, biggestOutBlock, checkedToBlock, checkedAt] = r;
  if (!ADDRESS.test(token) || !ADDRESS.test(creator) || !NUMBER.test(acquired) || !NUMBER.test(movedOut) || !NUMBER.test(biggestOut)) return null;
  if ([firstIn, firstOut, biggestOutBlock, checkedToBlock, checkedAt].some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return null;
  return {
    token: token as Address,
    creator: creator as Address,
    moves: {
      acquired: BigInt(acquired),
      movedOut: BigInt(movedOut),
      firstInBlock: firstIn || null,
      firstOutBlock: firstOut || null,
      biggestOut: BigInt(biggestOut),
      biggestOutBlock: biggestOutBlock || null,
    },
    checkedToBlock,
    checkedAt,
  };
}

export function encodeXrayCache(cache: XrayCache): XrayCacheWire {
  return { version: XRAY_CACHE_VERSION, chainId: cache.chainId, updatedAt: cache.updatedAt, rows: [...cache.byToken.values()].map(toXrayRow) };
}

/** The cache from its wire form; null if it isn't one this code reads. Malformed rows are dropped. */
export function decodeXrayCache(json: unknown): XrayCache | null {
  const w = json as Partial<XrayCacheWire> | null;
  if (!w || w.version !== XRAY_CACHE_VERSION || !Array.isArray(w.rows)) return null;
  const byToken = new Map<string, WatchedCreator>();
  for (const r of w.rows) {
    const one = fromXrayRow(r as XrayRow);
    if (one) byToken.set(one.token.toLowerCase(), one);
  }
  return { chainId: Number(w.chainId), updatedAt: Number(w.updatedAt ?? 0), byToken };
}

/** How much of what they bought a creator has moved out, 0..1 (0 when they never held any). */
export const movedOutShare = (m: CreatorMoves): number => (m.acquired > 0n ? Number((m.movedOut * 10n ** 12n) / m.acquired) / 1e12 : 0);

/** A creator has sold most of their own launch: what the "creators selling" feed is made of. */
export const soldMost = (m: CreatorMoves, atLeast = 0.5): boolean => m.acquired > 0n && movedOutShare(m) >= atLeast;

/** A creator who bought and now holds nothing. */
export const soldEverything = (m: CreatorMoves): boolean => m.acquired > 0n && creatorHolds(m) === 0n;
