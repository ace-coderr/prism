/**
 * A launch's own metadata: the picture, description and links its creator published. vibe/vibe
 * pins it on IPFS and puts the URI in the launch event (every factory generation); gen 0/1/2 events
 * also carry keccak256 of the file. Every file is checked against the chain before it's used: a
 * raw CID (bafkrei…) is itself the SHA-256 of the bytes, and the gen 0/1/2 digest must match too.
 * Anything that doesn't verify is treated as missing (the identicon shows instead).
 *
 * Read from the chain and IPFS only: never vibe/vibe's API.
 */
import { keccak256, type Address, type Hex, type PublicClient } from 'viem';
import { LAUNCH_TOPICS, VIBE_FACTORIES, decodeLaunchMetadataRef, type Launch, type LaunchMetadataRef, type RawLog } from './launches';
import { TOKEN_HIDE } from './site';

// ------------------------------------------------------------------ the reference, from the chain

/** The metadata URI (and digest) in `launch`'s own launch event: one eth_getLogs over its block. */
export async function readLaunchMetadataRef(client: PublicClient, launch: Pick<Launch, 'gen' | 'block' | 'logIndex'>): Promise<LaunchMetadataRef | null> {
  const factory = VIBE_FACTORIES.find((f) => f.gen === launch.gen)?.factory;
  if (!factory) return null;
  const block = `0x${launch.block.toString(16)}` as Hex;
  const logs = (await client.request({
    method: 'eth_getLogs',
    params: [{ address: factory, topics: [[...LAUNCH_TOPICS]], fromBlock: block, toBlock: block }],
  })) as unknown as Array<Pick<RawLog, 'address' | 'topics' | 'data'> & { blockNumber: Hex; logIndex: Hex }>;
  const log = logs.find((l) => Number(l.logIndex) === launch.logIndex);
  return log ? decodeLaunchMetadataRef({ ...log, blockNumber: BigInt(log.blockNumber), logIndex: Number(log.logIndex) }) : null;
}

// ------------------------------------------------------------------ CIDs and verification

const CID_V1 = /^b[a-z2-7]{50,120}$/;
const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

/** The CID in an `ipfs://<cid>` URI (also `/ipfs/<cid>` gateway links), or null. */
export function ipfsCid(uri: string): string | null {
  const m = /^(?:ipfs:\/\/(?:ipfs\/)?|https:\/\/[^/]+\/ipfs\/)([A-Za-z0-9]+)\/?$/.exec(uri.trim());
  const cid = m?.[1];
  return cid && (CID_V1.test(cid) || CID_V0.test(cid)) ? cid : null;
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * The SHA-256 a raw-codec CIDv1 (bafkrei…) names, as hex: the hash of the file's bytes. null for
 * any other kind of CID (those hash a DAG node, not the file, so the bytes can't be checked alone).
 */
export function rawCidSha256(cid: string): string | null {
  if (!CID_V1.test(cid)) return null;
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of cid.slice(1)) {
    const v = BASE32.indexOf(c);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // version 1, codec 0x55 (raw), multihash 0x12 (sha2-256), length 32
  if (bytes[0] !== 1 || bytes[1] !== 0x55 || bytes[2] !== 0x12 || bytes[3] !== 32 || bytes.length < 36) return null;
  return bytes
    .slice(4, 36)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * How `bytes` were verified against the chain: 'cid' (SHA-256 = the raw CID) and/or 'digest'
 * (keccak256 = the launch event's digest). null if nothing confirms them, or anything contradicts.
 */
export async function verifyIpfsBytes(bytes: Uint8Array, cid: string, digest: Hex | null = null): Promise<'cid' | 'digest' | null> {
  const want = rawCidSha256(cid);
  const sha = want ? hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)) : null;
  if (want && sha !== want) return null;
  if (digest && /^0x0{64}$/.test(digest) === false) {
    if (keccak256(bytes).toLowerCase() !== digest.toLowerCase()) return null;
    return want ? 'cid' : 'digest';
  }
  return want ? 'cid' : null;
}

// ------------------------------------------------------------------ fetching from IPFS

/**
 * Gateways, all asked at once: Pinata (where vibe/vibe pins; slow, but it has every file) and three
 * public ones. Any of them can be rate-limited or down for minutes; the first that answers with
 * bytes that verify wins. Measured October 2026 on real launch files: Pinata 8/8 (~6 s), Filebase
 * 6/8 (~3 s); ipfs.io and dweb.link were refusing (HTTP 429, "switching to a service worker
 * gateway") but refuse fast, so asking them costs little if they come back. w3s.link and
 * 4everland were dropped (always 429 / timing out).
 */
export const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.filebase.io/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
] as const;

export class IpfsError extends Error {
  constructor(
    message: string,
    /** true: the file itself is wrong (too big, doesn't verify); false: no gateway answered in time */
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/**
 * The bytes behind `cid`, verified (see verifyIpfsBytes). Every gateway is asked in parallel; the
 * first response that verifies wins and the rest are cancelled. Throws IpfsError.
 *
 * `staggerMs` (bulk reads only, so one file costs one request): gateway i joins after i × staggerMs,
 * or as soon as i of the others have failed.
 */
export async function fetchIpfs(
  cid: string,
  opts: { digest?: Hex | null; maxBytes: number; timeoutMs?: number; fetchImpl?: typeof fetch; gateways?: readonly string[]; staggerMs?: number },
): Promise<{ bytes: Uint8Array; verified: 'cid' | 'digest'; contentType: string | null }> {
  const f = opts.fetchImpl ?? fetch;
  const gateways = opts.gateways ?? IPFS_GATEWAYS;
  const stagger = opts.staggerMs ?? 0;
  const all = new AbortController();
  const timer = setTimeout(() => all.abort(), opts.timeoutMs ?? 12_000);
  let wrongBytes = 0;
  let tooBig = false;
  let failures = 0;
  const waiting: Array<() => void> = [];
  const turn = (i: number) =>
    new Promise<void>((go) => {
      if (i === 0 || stagger <= 0) return go();
      const t = setTimeout(go, i * stagger);
      all.signal.addEventListener('abort', () => (clearTimeout(t), go())); // decided: don't wait
      const check = () => (failures >= i ? (clearTimeout(t), go()) : waiting.push(check));
      check();
    });
  const attempt = async (gw: string, i: number) => {
    await turn(i);
    if (all.signal.aborted) throw new Error('done');
    try {
      const res = await f(`${gw}${cid}`, { signal: all.signal, redirect: 'follow', headers: { accept: '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > opts.maxBytes) {
        tooBig = true;
        throw new Error('too big');
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > opts.maxBytes) {
        tooBig = true;
        throw new Error('too big');
      }
      const verified = await verifyIpfsBytes(bytes, cid, opts.digest ?? null);
      if (!verified) {
        wrongBytes++;
        throw new Error('does not verify');
      }
      return { bytes, verified, contentType: res.headers.get('content-type') };
    } catch (e) {
      failures++;
      waiting.splice(0).forEach((w) => w());
      throw e;
    }
  };
  try {
    return await Promise.any(gateways.map(attempt));
  } catch {
    if (tooBig) throw new IpfsError('The file is larger than PRISM accepts.', true);
    // every gateway that answered returned bytes that don't match the chain
    if (wrongBytes > 0 && wrongBytes >= Math.ceil(gateways.length / 2)) throw new IpfsError('The file doesn’t match its on-chain hash.', true);
    throw new IpfsError('No IPFS gateway answered in time.', false);
  } finally {
    clearTimeout(timer);
    all.abort();
  }
}

// ------------------------------------------------------------------ the metadata itself

export interface TokenLinks {
  website?: string;
  x?: string;
  telegram?: string;
  discord?: string;
}

export interface TokenMetadata {
  description: string | null;
  /** the picture's raw CID and type (only images PRISM can show) */
  image: { cid: string; mimeType: string } | null;
  links: TokenLinks;
}

/** Picture types PRISM shows. */
export const IMAGE_TYPES: readonly string[] = ['image/webp', 'image/png', 'image/jpeg', 'image/gif'];
export const MAX_DESCRIPTION = 1000;

/** Plain text people can read: no control or direction-override characters, collapsed blank lines. */
export function cleanDescription(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t ? [...t].slice(0, MAX_DESCRIPTION).join('') : null;
}

/** An http(s) link that is safe to put in an href: no credentials, no other schemes, ≤ 200 chars. */
export function safeUrl(v: unknown, hosts?: readonly string[]): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s || s.length > 200 || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) return null;
    s = `https://${s}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.')) return null;
  if (hosts && !hosts.includes(host)) return null;
  return u.toString();
}

const handle = (v: string, re: RegExp) => (re.test(v) ? v.replace(/^@/, '') : null);

/** An X account: "@handle", "handle" or an x.com / twitter.com link → https://x.com/handle. */
export function xLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const h = handle(v.trim(), /^@?[A-Za-z0-9_]{1,15}$/);
  if (h) return `https://x.com/${h}`;
  const u = safeUrl(v, ['x.com', 'twitter.com', 'mobile.twitter.com']);
  const name = u ? new URL(u).pathname.split('/')[1] : null;
  return name && /^[A-Za-z0-9_]{1,15}$/.test(name) ? `https://x.com/${name}` : null;
}

/** A Telegram group or channel: "@name", "name" or a t.me link → https://t.me/name. */
export function telegramLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const h = handle(v.trim(), /^@?[A-Za-z0-9_]{5,32}$/);
  if (h) return `https://t.me/${h}`;
  const u = safeUrl(v, ['t.me', 'telegram.me']);
  if (!u) return null;
  const path = new URL(u).pathname.replace(/\/+$/, '');
  return /^\/(\+|joinchat\/)?[A-Za-z0-9_-]{5,64}$/.test(path) ? `https://t.me${path}` : null;
}

/** A Discord invite: discord.gg/… or discord.com/invite/… */
export function discordLink(v: unknown): string | null {
  const u = safeUrl(v, ['discord.gg', 'discord.com']);
  if (!u) return null;
  const { hostname, pathname } = new URL(u);
  const code = hostname.endsWith('discord.gg') ? pathname.slice(1) : /^\/invite\/([^/]+)/.exec(pathname)?.[1];
  return code && /^[A-Za-z0-9-]{2,32}$/.test(code) ? `https://discord.gg/${code}` : null;
}

/** Hidden by PRISM (site.ts TOKEN_HIDE): no picture or description is shown for it. */
export const isHidden = (token: Address | string) => TOKEN_HIDE.some((t) => t.toLowerCase() === token.toLowerCase());

/** vibe/vibe's metadata JSON (schema 1) → what PRISM shows. Unknown or unsafe fields are dropped. */
export function parseTokenMetadata(json: unknown): TokenMetadata {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const img = (o.image && typeof o.image === 'object' ? o.image : {}) as Record<string, unknown>;
  const cid = typeof img.uri === 'string' ? ipfsCid(img.uri) : null;
  const mime = typeof img.mimeType === 'string' ? img.mimeType.toLowerCase() : '';
  const socials = (o.socials && typeof o.socials === 'object' ? o.socials : {}) as Record<string, unknown>;
  const links: TokenLinks = {};
  const website = safeUrl(socials.website);
  const x = xLink(socials.x ?? socials.twitter);
  const telegram = telegramLink(socials.telegram);
  const discord = discordLink(socials.discord);
  if (website) links.website = website;
  if (x) links.x = x;
  if (telegram) links.telegram = telegram;
  if (discord) links.discord = discord;
  return {
    description: cleanDescription(o.description),
    // only raw CIDs: their bytes can be checked against the CID itself
    image: cid && rawCidSha256(cid) && IMAGE_TYPES.includes(mime) ? { cid, mimeType: mime } : null,
    links,
  };
}

/** The most bytes PRISM reads for a metadata file and a picture. */
export const MAX_METADATA_BYTES = 64 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * What a launch's metadata reference leads to:
 * - ok: the file, verified against the chain and reduced to what PRISM shows;
 * - none: nothing PRISM can use, for good (no URI, not on IPFS, too big, not JSON, or it doesn't
 *   match the chain): IPFS content never changes, so neither will this answer;
 * - unavailable: no gateway answered in time (worth asking again later).
 */
export type MetadataRead =
  | { status: 'ok'; uri: string; verified: 'cid' | 'digest'; meta: TokenMetadata }
  | { status: 'none'; uri: string | null }
  | { status: 'unavailable'; uri: string };

/** Fetch, verify and parse the metadata a launch event points to. */
export async function readLaunchMetadata(
  ref: LaunchMetadataRef | null,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; gateways?: readonly string[]; staggerMs?: number } = {},
): Promise<MetadataRead> {
  const cid = ref ? ipfsCid(ref.uri) : null;
  if (!ref || !cid) return { status: 'none', uri: ref?.uri ?? null };
  try {
    const file = await fetchIpfs(cid, { digest: ref.digest, maxBytes: MAX_METADATA_BYTES, timeoutMs: opts.timeoutMs ?? 12_000, fetchImpl: opts.fetchImpl, gateways: opts.gateways, staggerMs: opts.staggerMs });
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(file.bytes));
    } catch {
      return { status: 'none', uri: ref.uri };
    }
    return { status: 'ok', uri: ref.uri, verified: file.verified, meta: parseTokenMetadata(json) };
  } catch (e) {
    return e instanceof IpfsError && e.permanent ? { status: 'none', uri: ref.uri } : { status: 'unavailable', uri: ref.uri };
  }
}
