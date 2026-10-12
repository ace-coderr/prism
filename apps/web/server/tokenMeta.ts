/**
 * A launch's own metadata for GET /api/meta?token=0x…: the URI from its launch event, the file
 * from IPFS, verified against the chain (@prism/core meta.ts), then reduced to what PRISM shows:
 * description, picture and links. Cached in memory here and by the CDN (see data.ts).
 */
import type { Address } from 'viem';
import {
  IpfsError,
  MAX_METADATA_BYTES,
  fetchIpfs,
  ipfsCid,
  isHidden,
  parseTokenMetadata,
  readLaunchMetadataRef,
  type Launch,
  type TokenLinks,
} from '@prism/core';
import { client } from './chain';

export interface MetaBody {
  token: Address;
  /**
   * ok: verified metadata. none: the launch has none PRISM can use (no URI, not on IPFS, or it
   * doesn't match the chain). unavailable: IPFS didn't answer in time (try again later).
   * hidden: PRISM hides this token's picture and description (TOKEN_HIDE).
   */
  status: 'ok' | 'none' | 'unavailable' | 'hidden';
  description: string | null;
  image: { cid: string; mimeType: string } | null;
  links: TokenLinks;
  /** how the file was checked: its CID (SHA-256) and/or the launch event's keccak digest */
  verified: 'cid' | 'digest' | null;
  uri: string | null;
}

const OK_MS = 6 * 60 * 60_000;
const RETRY_MS = 60_000;
const cache = new Map<string, { at: number; body: MetaBody }>();

const empty = (token: Address, status: MetaBody['status'], uri: string | null = null): MetaBody => ({ token, status, description: null, image: null, links: {}, verified: null, uri });

/** `launch` null: a test stock or an unknown token (no metadata). */
export async function tokenMeta(token: Address, launch: Launch | null): Promise<MetaBody> {
  if (isHidden(token)) return empty(token, 'hidden');
  if (!launch) return empty(token, 'none');
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.body.status === 'unavailable' ? RETRY_MS : OK_MS)) return hit.body;
  const body = await read(token, launch);
  cache.set(key, { at: Date.now(), body });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return body;
}

async function read(token: Address, launch: Launch): Promise<MetaBody> {
  const ref = await readLaunchMetadataRef(client, launch);
  const cid = ref ? ipfsCid(ref.uri) : null;
  if (!ref || !cid) return empty(token, 'none', ref?.uri ?? null);
  try {
    const file = await fetchIpfs(cid, { digest: ref.digest, maxBytes: MAX_METADATA_BYTES, timeoutMs: 12_000 });
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(file.bytes));
    } catch {
      return empty(token, 'none', ref.uri);
    }
    const m = parseTokenMetadata(json);
    return { token, status: 'ok', description: m.description, image: m.image, links: m.links, verified: file.verified, uri: ref.uri };
  } catch (e) {
    return empty(token, e instanceof IpfsError && e.permanent ? 'none' : 'unavailable', ref.uri);
  }
}
