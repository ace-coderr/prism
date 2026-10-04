/**
 * vibe vibers — vibe/vibe's characters, featured in PRISM with permission
 * (vibe/vibe team, Telegram, 2026-10-04). Rules: official images only, shown as-is
 * (no redrawing, tracing, recolouring, cropping into new characters or AI
 * generation), always with VIBERS_CREDIT nearby.
 *
 * Research (2026-10-04):
 * - Official character art: the "collection" list on https://testnet.vibevibe.fun/vibe-vibers
 *   (served from /vibers/collection/<file>-480.webp, 480×480 WebP). The server sends
 *   `Access-Control-Allow-Origin: *` with `Cross-Origin-Resource-Policy: same-origin`, so
 *   images must be requested in CORS mode (crossOrigin="anonymous") to display cross-site.
 * - NFT contract: none found. No ERC-721/1155 "viber" contract on Robinhood Chain Testnet
 *   (explorer token search, 46630); vibe/vibe's API answers UNSUPPORTED_CHAIN for mainnet
 *   (4663); the vibers page describes an upcoming free mint ("One NFT per 200,000 SPARK
 *   held", SPARK being a token on Base) and its bundles reference no NFT address.
 *   => VIBERS_NFT stays null until vibe/vibe publishes the contract.
 */
import { erc721Abi, type Address, type PublicClient } from 'viem';

export const VIBERS_CREDIT = 'vibe vibers © vibe/vibe, featured with permission.';
export const VIBERS_SITE = 'https://testnet.vibevibe.fun';
export const VIBERS_PAGE = `${VIBERS_SITE}/vibe-vibers`;

export interface OfficialViber {
  file: string;
  /** vibe/vibe's own description of the character (used as alt text). */
  description: string;
}

/** A subset of the official collection list published on the vibe/vibe vibers page. */
export const OFFICIAL_VIBERS: readonly OfficialViber[] = [
  { file: 'viber-10', description: 'Green Viber with a cap and oversized turquoise glasses' },
  { file: 'viber-48', description: 'Teal Viber with a propeller hat and mint glasses' },
  { file: 'viber-103', description: 'Gold-toned Viber with twin antennas and a striped chest' },
  { file: 'viber-6', description: 'Brown Viber with little mint eyes and twin antennas' },
  { file: 'viber-42', description: 'Orange Viber with a green hat and turquoise eyes' },
  { file: 'viber-141', description: 'Dark Viber with a silver fedora and green glasses' },
  { file: 'bureau-31', description: 'Turquoise Viber with glowing lime bars and a single antenna' },
  { file: 'bureau-4', description: 'Cream Viber with a white fedora and blue glasses' },
  { file: 'viber-71', description: 'Brown pirate Viber with an eye patch' },
  { file: 'viber-extra-15', description: 'Transparent turquoise Viber with a square smile' },
  { file: 'viber-123', description: 'Purple Viber with a white cap and blue eyes' },
  { file: 'viber-extra-12', description: 'Gold-toned Viber with glowing yellow eyes and a side antenna' },
];

/** Official 480×480 image URL for a collection file. */
export const viberImageUrl = (file: string) => `${VIBERS_SITE}/vibers/collection/${file}-480.webp`;

/** Pick an official viber deterministically (for rotating guides). */
export const viberAt = (i: number): OfficialViber =>
  OFFICIAL_VIBERS[((i % OFFICIAL_VIBERS.length) + OFFICIAL_VIBERS.length) % OFFICIAL_VIBERS.length]!;

// ---------------------------------------------------------------------------
// Holder's own viber (read-only) — switched on once the NFT contract exists.
// ---------------------------------------------------------------------------

export interface VibersNft {
  chainId: number;
  address: Address;
  /** Shown next to the image when the NFT lives on another chain, e.g. "mainnet". */
  label?: string;
}

/** The official vibe vibers NFT. Null: not deployed / not published yet (see research above). */
export const VIBERS_NFT: VibersNft | null = null;

export interface OwnedViber {
  tokenId: bigint;
  name: string;
  image: string;
  chainId: number;
  label?: string;
}

/** ipfs://… and ar://… → https gateway URLs; other URLs unchanged. */
export function resolveMediaUrl(uri: string): string {
  if (uri.startsWith('ipfs://ipfs/')) return `https://ipfs.io/ipfs/${uri.slice(12)}`;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

/** Parse ERC-721 metadata from a tokenURI (data:application/json[;base64], or fetched JSON). */
export async function readTokenMetadata(
  tokenUri: string,
  fetchImpl: typeof fetch,
): Promise<{ name?: string; image?: string }> {
  if (tokenUri.startsWith('data:application/json')) {
    const comma = tokenUri.indexOf(',');
    const body = tokenUri.slice(comma + 1);
    const json = tokenUri.slice(0, comma).includes(';base64') ? atob(body) : decodeURIComponent(body);
    return JSON.parse(json);
  }
  const r = await fetchImpl(resolveMediaUrl(tokenUri));
  if (!r.ok) throw new Error(`metadata HTTP ${r.status}`);
  return r.json();
}

const enumerableAbi = [
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * The first viber `owner` holds, with its official metadata image — or null when
 * there is no contract configured, no balance, or the token can't be resolved.
 * Needs ERC721Enumerable; collections without it are skipped (returns null).
 */
export async function readOwnedViber(
  client: PublicClient,
  owner: Address,
  fetchImpl: typeof fetch,
  nft: VibersNft | null = VIBERS_NFT,
): Promise<OwnedViber | null> {
  if (!nft) return null;
  const balance = await client.readContract({ address: nft.address, abi: erc721Abi, functionName: 'balanceOf', args: [owner] });
  if (balance === 0n) return null;
  const tokenId = await client
    .readContract({ address: nft.address, abi: enumerableAbi, functionName: 'tokenOfOwnerByIndex', args: [owner, 0n] })
    .catch(() => null);
  if (tokenId === null) return null;
  const uri = await client.readContract({ address: nft.address, abi: erc721Abi, functionName: 'tokenURI', args: [tokenId] });
  const meta = await readTokenMetadata(uri, fetchImpl);
  if (!meta.image) return null;
  return {
    tokenId,
    name: meta.name ?? `vibe viber #${tokenId}`,
    image: resolveMediaUrl(meta.image),
    chainId: nft.chainId,
    label: nft.label,
  };
}
