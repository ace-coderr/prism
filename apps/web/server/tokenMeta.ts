/**
 * A launch's own metadata for GET /api/meta?token=0x…: the URI from its launch event, the file
 * from IPFS, verified against the chain (@prism/core meta.ts), then reduced to what PRISM shows:
 * description, picture and links.
 *
 * A launch's metadata never changes (its URI is fixed in the launch event, and IPFS content is
 * content-addressed), so a final answer is kept for good: first the cache the scheduled job
 * publishes (metaCache.ts), then anything this instance has read itself. IPFS is only asked about
 * launches neither has, and 'unavailable' only means PRISM has never managed to read the file.
 */
import type { Address } from 'viem';
import { isHidden, readLaunchMetadataRef, readLaunchMetadata, type CachedMeta, type Launch, type MetadataRead, type TokenLinks } from '@prism/core';
import { client } from './chain';
import { publishedMeta } from './metaCache';

export interface MetaBody {
  token: Address;
  /**
   * ok: verified metadata. none: the launch has none PRISM can use (no URI, not on IPFS, or it
   * doesn't match the chain). unavailable: PRISM has never read the file because IPFS didn't answer
   * in time (try again later). hidden: PRISM hides this token's picture and description (TOKEN_HIDE).
   */
  status: 'ok' | 'none' | 'unavailable' | 'hidden';
  description: string | null;
  image: { cid: string; mimeType: string } | null;
  links: TokenLinks;
  /** how the file was checked: its CID (SHA-256) and/or the launch event's keccak digest */
  verified: 'cid' | 'digest' | null;
  uri: string | null;
}

/** Final answers this instance has read itself (ok / none). */
const known = new Map<string, MetaBody>();
const KNOWN_MAX = 20_000;
/** Launches IPFS just failed on: when to ask again. */
const RETRY_MS = 60_000;
const failed = new Map<string, number>();

const empty = (token: Address, status: MetaBody['status'], uri: string | null = null): MetaBody => ({ token, status, description: null, image: null, links: {}, verified: null, uri });

export function metaBody(token: Address, read: MetadataRead | CachedMeta): MetaBody {
  if (read.status !== 'ok') return empty(token, read.status, read.uri);
  return { token, status: 'ok', description: read.meta.description, image: read.meta.image, links: read.meta.links, verified: read.verified, uri: read.uri };
}

function remember(key: string, body: MetaBody) {
  known.delete(key);
  known.set(key, body);
  if (known.size > KNOWN_MAX) known.delete(known.keys().next().value!);
}

/** `launch` null: a test stock or an unknown token (no metadata). */
export async function tokenMeta(token: Address, launch: Launch | null): Promise<MetaBody> {
  if (isHidden(token)) return empty(token, 'hidden');
  if (!launch) return empty(token, 'none');
  const key = token.toLowerCase();
  const hit = known.get(key);
  if (hit) return hit;
  const published = await publishedMeta(key).catch(() => null);
  if (published) {
    const body = metaBody(token, published);
    remember(key, body);
    return body;
  }
  if (Date.now() - (failed.get(key) ?? 0) < RETRY_MS) return empty(token, 'unavailable');
  const ref = await readLaunchMetadataRef(client, launch).catch(() => undefined);
  if (ref === undefined) return empty(token, 'unavailable'); // the RPC didn't answer: not final either
  const read = await readLaunchMetadata(ref);
  if (read.status === 'unavailable') {
    failed.set(key, Date.now());
    if (failed.size > 5000) failed.delete(failed.keys().next().value!);
    return metaBody(token, read);
  }
  failed.delete(key);
  const body = metaBody(token, read);
  remember(key, body);
  return body;
}
