/**
 * Gift links (PrismGiftLinks): send a crystal as a link to someone who may not have a wallet.
 *
 * The sender's browser makes a one-time keypair, the claim key. The crystal goes into the
 * contract with `safeTransferFrom(sender, giftLinks, id, linkData(claimKey, expiry, note))`,
 * and the private key travels only in the link's URL fragment (#k=…): browsers never send the
 * fragment to any server. Whoever opens the link has the key, so the link is a bearer token.
 * The claim is sent by the claim key itself (paying gas from the little test ETH the sender
 * put on it), which is also why nobody can redirect it on the way.
 */
import { decodeAbiParameters, encodeAbiParameters, isHex, parseEther, parseEventLogs, type Address, type Hash, type Hex, type PublicClient } from 'viem';
import { prismGiftLinksAbi } from './abi/prismGiftLinks';
import { blockRanges } from './onchain';
import { LOG_RANGE } from './reader';

/** Test ETH the sender puts on the claim key by default (pays the claim; the rest goes to the recipient). */
export const LINK_GAS_DEFAULT = parseEther('0.0005');
/** How long a link can be claimed (the contract allows at most 365 days). */
export const LINK_DAY_CHOICES = [7, 30, 90] as const;
export const LINK_DAYS_DEFAULT = 30;

const LINK_DATA = [{ type: 'address' }, { type: 'uint64' }, { type: 'string' }] as const;

/** The `data` for safeTransferFrom that turns the transfer into a link. */
export const linkData = (claimKey: Address, expiry: number, note: string): Hex => encodeAbiParameters(LINK_DATA, [claimKey, BigInt(expiry), note]);

export function decodeLinkData(data: Hex): { claimKey: Address; expiry: number; note: string } | null {
  try {
    const [claimKey, expiry, note] = decodeAbiParameters(LINK_DATA, data);
    return { claimKey, expiry: Number(expiry), note };
  } catch {
    return null;
  }
}

/** The link to share: /claim/<id>#k=<private key, 64 hex>. The key is only ever in the fragment. */
export const claimPath = (linkId: bigint, key: Hex) => `/claim/${linkId}#k=${key.replace(/^0x/, '')}`;

/** The claim key from a URL fragment ("#k=…"), or null when it's missing or malformed. */
export function claimKeyFromHash(hash: string): Hex | null {
  const k = new URLSearchParams(hash.replace(/^#/, '')).get('k');
  if (!k) return null;
  const key = (k.startsWith('0x') ? k : `0x${k}`).toLowerCase();
  return isHex(key) && key.length === 66 && !/^0x0+$/.test(key) ? (key as Hex) : null;
}

export type LinkState = 'waiting' | 'claimed' | 'cancelled' | 'expired';

export interface GiftLink {
  id: bigint;
  sender: Address;
  crystalId: bigint;
  claimKey: Address;
  /** unix seconds */
  expiry: number;
  note: string;
  /** the transaction that made it */
  tx: Hash;
  block: bigint;
  claimedBy: Address | null;
  cancelled: boolean;
}

/** Where a link stands at `now` (unix seconds). */
export function linkState(link: Pick<GiftLink, 'claimedBy' | 'cancelled' | 'expiry'>, now: number): LinkState {
  if (link.claimedBy) return 'claimed';
  if (link.cancelled) return 'cancelled';
  return now >= link.expiry ? 'expired' : 'waiting';
}

/** Every link from the contract's events (created, claimed, cancelled), oldest first. */
export function linksFromLogs(logs: Parameters<typeof parseEventLogs>[0]['logs']): GiftLink[] {
  const byId = new Map<bigint, GiftLink>();
  for (const l of parseEventLogs({ abi: prismGiftLinksAbi, logs })) {
    if (l.eventName === 'LinkCreated') {
      const a = l.args;
      byId.set(a.linkId, {
        id: a.linkId,
        sender: a.sender,
        crystalId: a.crystalId,
        claimKey: a.claimKey,
        expiry: Number(a.expiry),
        note: a.note,
        tx: l.transactionHash!,
        block: l.blockNumber!,
        claimedBy: null,
        cancelled: false,
      });
    } else if (l.eventName === 'LinkClaimed') {
      const link = byId.get(l.args.linkId);
      if (link) link.claimedBy = l.args.recipient;
    } else if (l.eventName === 'LinkCancelled') {
      const link = byId.get(l.args.linkId);
      if (link) link.cancelled = true;
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Every gift link since the contract's deployment block, in RPC-safe block ranges. */
export async function readGiftLinks(client: PublicClient, address: Address, fromBlock: bigint): Promise<GiftLink[]> {
  const head = await client.getBlockNumber();
  const logs = [];
  for (const [a, b] of blockRanges(fromBlock, head, LOG_RANGE)) logs.push(...(await client.getLogs({ address, fromBlock: a, toBlock: b })));
  return linksFromLogs(logs);
}

/**
 * How much of the claim key's leftover ETH can go to the recipient: its balance minus the most
 * a transfer can cost (`gas` × `gasPrice`, sent as a legacy transaction so that's the cap).
 * Null when nothing would be left.
 */
export function sweepValue(balance: bigint, gas: bigint, gasPrice: bigint): bigint | null {
  const v = balance - gas * gasPrice;
  return v > 0n ? v : null;
}
