/**
 * Gifts with the existing PrismCrystal contract (no new contract):
 * - optionally seal(id, unlockTime) first, then safeTransferFrom(from, to, id, data);
 * - the note is `data`, UTF-8. ERC-721 doesn't store or emit it: it lives only in the
 *   transaction's input, so reading it back means fetching that transaction and decoding it.
 * Pure helpers: note rules and coding, recipient parsing, the seal → send plan, the countdown,
 * and finding a crystal's gift in the contract's event log.
 */
import { decodeFunctionData, getAddress, isAddress, stringToHex, type Address, type Hash, type Hex } from 'viem';
import { prismCrystalAbi } from './abi/prismCrystal';
import type { CrystalEvent } from './activity';
import { NAME_MAX, NAME_MIN } from './profiles';

export const NOTE_MAX = 140;
/** Seals are capped by the contract (MAX_SEAL_DURATION). */
export const MAX_SEAL_SECONDS = 100 * 365 * 86400;
const ZERO = '0x0000000000000000000000000000000000000000';
/** safeTransferFrom(address,address,uint256,bytes) */
const SAFE_TRANSFER_WITH_DATA = 'b88d4fde';
// control characters (line breaks included): a note is one line of text
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const chars = (s: string) => [...s].length;

/** Why a note can't be sent as it is (null = fine; empty = no note). */
export function noteProblem(note: string): string | null {
  const n = note.trim();
  if (!n) return null;
  if (chars(n) > NOTE_MAX) return `Keep the note to ${NOTE_MAX} characters.`;
  if (CONTROL.test(n)) return 'Keep the note on one line.';
  // a lone UTF-16 surrogate has no UTF-8 form
  try {
    encodeURIComponent(n);
  } catch {
    return 'The note has a character that can’t be stored.';
  }
  return null;
}

/** The note as safeTransferFrom's `data` bytes (UTF-8); empty note → no bytes. */
export function encodeNote(note: string): Hex {
  const n = note.trim();
  if (noteProblem(n)) throw new Error(noteProblem(n)!);
  return n ? stringToHex(n) : '0x';
}

/** UTF-8 bytes → a safe one-line note, or null when empty or not valid UTF-8. */
export function decodeNoteBytes(data: Hex): string | null {
  if (!data || data === '0x') return null;
  const bytes = new Uint8Array((data.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(data.slice(2 + i * 2, 4 + i * 2), 16);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  // whatever was sent, show it as one tidy line no longer than the limit
  const clean = text.replace(new RegExp(CONTROL.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return chars(clean) > NOTE_MAX ? [...clean].slice(0, NOTE_MAX).join('') + '…' : clean;
}

/**
 * The note of a gift, from its transaction's input: a direct safeTransferFrom call, or one
 * wrapped inside another call (a smart-contract wallet). When `expect` is given the call
 * must move that crystal between those wallets. Null when there's no readable note.
 */
export function noteFromInput(input: Hex | undefined, expect: { from?: Address; to?: Address; id?: bigint } = {}): string | null {
  if (!input) return null;
  const hex = input.toLowerCase();
  for (let at = hex.indexOf(SAFE_TRANSFER_WITH_DATA, 2); at !== -1; at = hex.indexOf(SAFE_TRANSFER_WITH_DATA, at + 1)) {
    if ((at - 2) % 2 !== 0) continue; // must start on a byte boundary
    try {
      const call = decodeFunctionData({ abi: prismCrystalAbi, data: `0x${hex.slice(at)}` as Hex });
      if (call.functionName !== 'safeTransferFrom' || call.args.length !== 4) continue;
      const [from, to, id, data] = call.args as readonly [Address, Address, bigint, Hex];
      if (expect.from && from.toLowerCase() !== expect.from.toLowerCase()) continue;
      if (expect.to && to.toLowerCase() !== expect.to.toLowerCase()) continue;
      if (expect.id !== undefined && id !== expect.id) continue;
      return decodeNoteBytes(data);
    } catch {
      /* not a call at this offset: keep looking */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recipient
// ---------------------------------------------------------------------------

export type Recipient =
  | { kind: 'empty' }
  | { kind: 'address'; address: Address }
  | { kind: 'name'; name: string }
  | { kind: 'invalid'; problem: string };

/** What was typed in the "To" field: a 0x address, an @username, or neither. */
export function parseRecipient(input: string): Recipient {
  const s = input.trim();
  if (!s) return { kind: 'empty' };
  if (/^0x/i.test(s)) {
    if (!isAddress(s, { strict: false })) return { kind: 'invalid', problem: 'That isn’t a valid 0x address (42 characters, 0–9 and a–f).' };
    return { kind: 'address', address: getAddress(s) };
  }
  // only the contract's own rules here: a name the app wouldn't offer can still exist on-chain
  const name = s.replace(/^@/, '').toLowerCase();
  if (name.length < NAME_MIN || name.length > NAME_MAX || !/^[a-z0-9_]+$/.test(name)) {
    return { kind: 'invalid', problem: `Type an @username (${NAME_MIN}–${NAME_MAX} letters, numbers or _) or a 0x address.` };
  }
  return { kind: 'name', name };
}

/** Why a crystal can't go to `to` (null = fine). */
export function recipientProblem(to: Address, me: Address | undefined): string | null {
  if (to.toLowerCase() === ZERO) return 'That’s the zero address: the crystal would be lost for good.';
  if (me && to.toLowerCase() === me.toLowerCase()) return 'That’s your own wallet. Pick someone else.';
  return null;
}

// ---------------------------------------------------------------------------
// Plan: seal (optional) → send
// ---------------------------------------------------------------------------

export type GiftStep = 'seal' | 'send';

/**
 * The transactions a gift needs, in order. With an "opens on" time the crystal is sealed
 * first (while it's still yours), then sent; a seal can only be set or extended.
 */
export function planGift({ unlock, sealedUntil, now }: { unlock: number | null; sealedUntil: number; now: number }): {
  steps: GiftStep[];
  problem: string | null;
} {
  if (unlock === null) return { steps: ['send'], problem: null };
  if (unlock <= now) return { steps: [], problem: 'Pick an opening time in the future.' };
  if (unlock <= sealedUntil) return { steps: [], problem: 'It’s already sealed past that time. A seal can only be extended: pick a later time, or none.' };
  if (unlock > now + MAX_SEAL_SECONDS) return { steps: [], problem: 'Seals are limited to 100 years.' };
  return { steps: ['seal', 'send'], problem: null };
}

/** "3d 4h", "4h 12m", "12m", "<1m"; null once `unlock` has passed. */
export function timeLeft(unlock: number, now: number): string | null {
  const s = Math.floor(unlock - now);
  if (s <= 0) return null;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

/** "Opens in 3d 4h", or null once it can be opened. */
export const opensIn = (unlock: number, now: number) => {
  const left = timeLeft(unlock, now);
  return left ? `Opens in ${left}` : null;
};

// ---------------------------------------------------------------------------
// Finding gifts in the event log
// ---------------------------------------------------------------------------

export interface Gift {
  id: bigint;
  /** who gave it (for a gift link: who made the link) */
  from: Address;
  to: Address;
  /** the transfer that delivered it (for a gift link: the claim) */
  tx: Hash;
  block: bigint;
  logIndex: number;
  /** sent as a gift link (PrismGiftLinks) rather than straight to a wallet */
  via?: 'link';
  /** for a gift link: the transaction that made the link (its note is there) */
  linkTx?: Hash;
}

/** Contracts that move crystals without being a gift themselves. */
export interface GiftContracts {
  /** PrismForgeRouter: Swap & forge mints to it, then it hands the crystal over (not a gift) */
  router?: Address | null;
  /** PrismGiftLinks: a deposit makes a link (not yet a gift); the claim is the gift, from the link's maker; a cancel just returns it */
  giftLinks?: Address | null;
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Every gift in the log, oldest first: crystals changing hands between people (see GiftContracts). */
export function allGifts(events: CrystalEvent[], contracts: GiftContracts = {}): Gift[] {
  const out: Gift[] = [];
  // per crystal: who put it into a gift link (and in which transaction)
  const deposited = new Map<bigint, { from: Address; tx: Hash }>();
  for (const e of events) {
    if (e.kind !== 'transfer' || !e.from || !e.to) continue;
    if (same(e.from, ZERO) || same(e.to, ZERO) || same(e.from, contracts.router)) continue;
    if (same(e.to, contracts.giftLinks)) {
      deposited.set(e.id, { from: e.from, tx: e.tx });
      continue;
    }
    if (same(e.from, contracts.giftLinks)) {
      const d = deposited.get(e.id);
      deposited.delete(e.id);
      // back to whoever made the link: a cancel, not a gift
      if (d && !same(e.to, d.from)) out.push({ id: e.id, from: d.from, to: e.to, tx: e.tx, block: e.block, logIndex: e.logIndex, via: 'link', linkTx: d.tx });
      continue;
    }
    out.push({ id: e.id, from: e.from, to: e.to, tx: e.tx, block: e.block, logIndex: e.logIndex });
  }
  return out;
}

/** The crystal's latest gift, if it was ever given. */
export function giftOf(events: CrystalEvent[], id: bigint, contracts: GiftContracts = {}): Gift | null {
  const gifts = allGifts(
    events.filter((e) => e.id === id),
    contracts,
  );
  return gifts[gifts.length - 1] ?? null;
}

/** Gifts `owner` holds right now: crystals whose latest move was a gift to them. */
export function giftsReceived(events: CrystalEvent[], owner: Address, contracts: GiftContracts = {}): Map<bigint, Gift> {
  const latest = new Map<bigint, CrystalEvent>();
  for (const e of events) if (e.kind === 'transfer') latest.set(e.id, e);
  const out = new Map<bigint, Gift>();
  for (const g of allGifts(events, contracts)) {
    const last = latest.get(g.id);
    if (last && last.tx === g.tx && last.logIndex === g.logIndex && same(g.to, owner)) out.set(g.id, g);
  }
  return out;
}
