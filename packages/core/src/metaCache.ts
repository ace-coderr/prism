/**
 * Every launch's verified metadata, kept for good. A launch's metadata URI is fixed in its launch
 * event and IPFS content never changes, so once a file has been fetched and checked against the
 * chain (meta.ts) the answer is final. The scheduled job (.github/workflows/launch-index.yml,
 * scripts/cache-metadata.ts) fills this in a little each run and publishes it next to the launch
 * index (META_CACHE_URL); the site answers /api/meta from it, so an IPFS outage only affects
 * launches the job hasn't reached yet.
 *
 * It's a separate file from launches.json.gz on purpose: every route loads the launch index,
 * only /api/meta needs this.
 */
import type { Address, PublicClient } from 'viem';
import { LAUNCH_TOPICS, VIBE_FACTORIES, decodeLaunchMetadataRef, type Launch, type LaunchMetadataRef, type RawLog } from './launches';
import { getLogsSplit } from './launchScan';
import { IMAGE_TYPES, cleanDescription, discordLink, ipfsCid, rawCidSha256, safeUrl, telegramLink, xLink, type MetadataRead, type TokenLinks, type TokenMetadata } from './meta';

export const META_CACHE_VERSION = 1;

/** Published by the scheduled job as an asset of the launch index's release. Public data. */
export const META_CACHE_URL = 'https://github.com/ace-coderr/prism/releases/download/launch-index/launch-meta.json.gz';

/** A final answer for one launch (never 'unavailable': those aren't kept). */
export type CachedMeta =
  | { status: 'ok'; uri: string; verified: 'cid' | 'digest'; meta: TokenMetadata }
  | { status: 'none'; uri: string | null };

/**
 * One launch as a compact row:
 * [token, uri|'', 'ok'|'none', 'cid'|'digest'|'', description|'', imageCid|'', imageMime|'', website|'', x|'', telegram|'', discord|'']
 */
export type MetaRow = [string, string, string, string, string, string, string, string, string, string, string];

export interface MetaCacheWire {
  version: number;
  chainId: number;
  /** unix seconds */
  updatedAt: number;
  rows: MetaRow[];
}

/** By lower-case token. Rows stay as rows (the site turns one into an answer when it's asked for). */
export interface MetaCache {
  chainId: number;
  updatedAt: number;
  rows: Map<string, MetaRow>;
}

export const emptyMetaCache = (chainId: number): MetaCache => ({ chainId, updatedAt: 0, rows: new Map() });

/** A final answer as a row; null for 'unavailable' (not final). */
export function metaRow(token: Address | string, read: MetadataRead | CachedMeta): MetaRow | null {
  if (read.status === 'unavailable') return null;
  if (read.status === 'none') return [token.toLowerCase(), read.uri ?? '', 'none', '', '', '', '', '', '', '', ''];
  const { meta } = read;
  return [
    token.toLowerCase(),
    read.uri,
    'ok',
    read.verified,
    meta.description ?? '',
    meta.image?.cid ?? '',
    meta.image?.mimeType ?? '',
    meta.links.website ?? '',
    meta.links.x ?? '',
    meta.links.telegram ?? '',
    meta.links.discord ?? '',
  ];
}

/**
 * A row as an answer, every field checked again on the way in (the same rules as reading the file
 * itself): null if the row isn't one this code understands.
 */
export function cachedMeta(row: MetaRow): CachedMeta | null {
  const [, uri, status, verified, description, imageCid, imageMime, website, x, telegram, discord] = row;
  if (status === 'none') return { status: 'none', uri: uri || null };
  if (status !== 'ok' || !ipfsCid(uri) || (verified !== 'cid' && verified !== 'digest')) return null;
  const links: TokenLinks = {};
  const w = website ? safeUrl(website) : null;
  const xl = x ? xLink(x) : null;
  const t = telegram ? telegramLink(telegram) : null;
  const d = discord ? discordLink(discord) : null;
  if (w) links.website = w;
  if (xl) links.x = xl;
  if (t) links.telegram = t;
  if (d) links.discord = d;
  const image = imageCid && ipfsCid(`ipfs://${imageCid}`) === imageCid && rawCidSha256(imageCid) && IMAGE_TYPES.includes(imageMime) ? { cid: imageCid, mimeType: imageMime } : null;
  return { status: 'ok', uri, verified, meta: { description: cleanDescription(description), image, links } };
}

export function encodeMetaCache(cache: MetaCache): MetaCacheWire {
  return { version: META_CACHE_VERSION, chainId: cache.chainId, updatedAt: cache.updatedAt, rows: [...cache.rows.values()] };
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

/** The cache from its wire form; null if it isn't one this code reads. Malformed rows are dropped. */
export function decodeMetaCache(json: unknown): MetaCache | null {
  const w = json as Partial<MetaCacheWire> | null;
  if (!w || w.version !== META_CACHE_VERSION || !Array.isArray(w.rows)) return null;
  const rows = new Map<string, MetaRow>();
  for (const r of w.rows) {
    if (!Array.isArray(r) || r.length !== 11 || !r.every((v) => typeof v === 'string') || !ADDRESS.test(r[0])) continue;
    rows.set(r[0], r as MetaRow);
  }
  return { chainId: Number(w.chainId), updatedAt: Number(w.updatedAt ?? 0), rows };
}

// ------------------------------------------------------------------ references in bulk (the scheduled job)

const normalize = (l: RawLog): RawLog => ({
  ...l,
  blockNumber: l.blockNumber === null ? null : BigInt(l.blockNumber as unknown as string),
  logIndex: l.logIndex === null ? null : Number(l.logIndex as unknown as string),
});

/**
 * The metadata reference of each launch, from its launch event: one eth_getLogs over the blocks
 * the launches span (split as the node needs). A launch whose event wasn't returned is left out
 * (ask again later); one whose event has no URI maps to null.
 */
export async function readLaunchMetadataRefs(
  client: PublicClient,
  launches: ReadonlyArray<Pick<Launch, 'token' | 'gen' | 'block' | 'logIndex'>>,
): Promise<Map<string, LaunchMetadataRef | null>> {
  const out = new Map<string, LaunchMetadataRef | null>();
  if (!launches.length) return out;
  const gens = new Set(launches.map((l) => l.gen));
  const factories = VIBE_FACTORIES.filter((f) => gens.has(f.gen)).map((f) => f.factory);
  const blocks = launches.map((l) => l.block);
  const from = BigInt(Math.min(...blocks));
  const to = BigInt(Math.max(...blocks));
  const logs = (await getLogsSplit(client, { address: factories, topics: [[...LAUNCH_TOPICS]] }, from, to)).map(normalize);
  const byPosition = new Map(logs.map((l) => [`${l.blockNumber}:${l.logIndex}`, l]));
  for (const l of launches) {
    const log = byPosition.get(`${l.block}:${l.logIndex}`);
    if (log) out.set(l.token.toLowerCase(), decodeLaunchMetadataRef(log));
  }
  return out;
}
