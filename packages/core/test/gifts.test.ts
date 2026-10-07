import { describe, expect, it } from 'vitest';
import { encodeFunctionData, stringToHex, type Address, type Hash } from 'viem';
import {
  NOTE_MAX,
  decodeNoteBytes,
  encodeNote,
  giftOf,
  giftsReceived,
  noteFromInput,
  noteProblem,
  opensIn,
  parseRecipient,
  planGift,
  prismCrystalAbi,
  recipientProblem,
  timeLeft,
  type CrystalEvent,
} from '../src';

const ME = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e' as Address;
const FRIEND = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

const transferCall = (from: Address, to: Address, id: bigint, note: string) =>
  encodeFunctionData({ abi: prismCrystalAbi, functionName: 'safeTransferFrom', args: [from, to, id, encodeNote(note)] });

describe('gift notes', () => {
  it('round-trips through safeTransferFrom data as UTF-8 (emoji and accents too)', () => {
    for (const note of ['Happy birthday!', 'Joyeux anniversaire, café ☕', 'For you 🎁🔮 — open it in spring']) {
      expect(decodeNoteBytes(encodeNote(note))).toBe(note);
      expect(noteFromInput(transferCall(ME, FRIEND, 2n, note), { from: ME, to: FRIEND, id: 2n })).toBe(note);
    }
    expect(encodeNote('  hi  ')).toBe(stringToHex('hi'));
    expect(encodeNote('')).toBe('0x');
  });

  it('allows up to 140 characters, counting an emoji as one', () => {
    expect(noteProblem('a'.repeat(NOTE_MAX))).toBeNull();
    expect(noteProblem('🎁'.repeat(NOTE_MAX))).toBeNull();
    expect(noteProblem('a'.repeat(NOTE_MAX + 1))).toMatch(/140/);
    expect(noteProblem('line one\nline two')).toMatch(/one line/);
    expect(noteProblem('broken \ud83d surrogate')).toMatch(/can’t be stored/);
    expect(() => encodeNote('a'.repeat(NOTE_MAX + 1))).toThrow();
  });

  it('reads nothing from a transfer without a note, a different crystal or wallet, or junk', () => {
    expect(noteFromInput(transferCall(ME, FRIEND, 2n, ''), { id: 2n })).toBeNull();
    expect(noteFromInput(encodeFunctionData({ abi: prismCrystalAbi, functionName: 'transferFrom', args: [ME, FRIEND, 2n] }))).toBeNull();
    expect(noteFromInput(transferCall(ME, FRIEND, 2n, 'hi'), { id: 3n })).toBeNull();
    expect(noteFromInput(transferCall(ME, FRIEND, 2n, 'hi'), { to: OTHER })).toBeNull();
    expect(noteFromInput('0xdeadbeef')).toBeNull();
    expect(noteFromInput(undefined)).toBeNull();
    // bytes that aren't UTF-8
    expect(decodeNoteBytes('0xff')).toBeNull();
  });

  it('finds the note inside a call wrapped by a smart-contract wallet', () => {
    const walletAbi = [{ type: 'function', name: 'exec', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [] }] as const;
    const wrapped = encodeFunctionData({ abi: walletAbi, functionName: 'exec', args: [OTHER, transferCall(ME, FRIEND, 7n, 'via my safe')] });
    expect(noteFromInput(wrapped, { from: ME, to: FRIEND, id: 7n })).toBe('via my safe');
  });

  it('shows whatever was sent as one tidy line, capped at the limit', () => {
    expect(decodeNoteBytes(stringToHex('two\nlines\t here'))).toBe('two lines here');
    const long = decodeNoteBytes(stringToHex('x'.repeat(300)))!;
    expect([...long].length).toBe(NOTE_MAX + 1); // 140 + "…"
  });
});

describe('gift recipient', () => {
  it('takes a 0x address (any case) or an @username', () => {
    expect(parseRecipient('')).toEqual({ kind: 'empty' });
    expect(parseRecipient(ME.toLowerCase())).toEqual({ kind: 'address', address: ME });
    expect(parseRecipient(`  ${ME}  `)).toEqual({ kind: 'address', address: ME });
    expect(parseRecipient('@Ace_Won')).toEqual({ kind: 'name', name: 'ace_won' });
    expect(parseRecipient('tester')).toEqual({ kind: 'name', name: 'tester' });
  });

  it('refuses invalid input', () => {
    expect(parseRecipient('0x123').kind).toBe('invalid');
    expect(parseRecipient('0xZZ5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e').kind).toBe('invalid');
    expect(parseRecipient('@a').kind).toBe('invalid');
    expect(parseRecipient('not a name!').kind).toBe('invalid');
  });

  it('blocks the zero address and your own wallet', () => {
    expect(recipientProblem(ZERO, ME)).toMatch(/zero address/);
    expect(recipientProblem(ME.toLowerCase() as Address, ME)).toMatch(/your own wallet/);
    expect(recipientProblem(FRIEND, ME)).toBeNull();
  });
});

describe('gift plan', () => {
  const now = 1_800_000_000;
  it('seals first, then sends', () => {
    expect(planGift({ unlock: now + 86400, sealedUntil: 0, now })).toEqual({ steps: ['seal', 'send'], problem: null });
    expect(planGift({ unlock: null, sealedUntil: 0, now })).toEqual({ steps: ['send'], problem: null });
    // already sealed: sending is still fine, the seal stays as it is
    expect(planGift({ unlock: null, sealedUntil: now + 999, now }).steps).toEqual(['send']);
  });

  it('refuses an opening time that is past, shorter than the current seal, or over 100 years', () => {
    expect(planGift({ unlock: now - 1, sealedUntil: 0, now }).problem).toMatch(/future/);
    expect(planGift({ unlock: now + 100, sealedUntil: now + 500, now }).problem).toMatch(/only be extended/);
    expect(planGift({ unlock: now + 101 * 365 * 86400, sealedUntil: 0, now }).problem).toMatch(/100 years/);
  });
});

describe('countdown', () => {
  const now = 1_800_000_000;
  it('counts down in days, hours and minutes', () => {
    expect(opensIn(now + 3 * 86400 + 4 * 3600 + 59, now)).toBe('Opens in 3d 4h');
    expect(timeLeft(now + 4 * 3600 + 12 * 60, now)).toBe('4h 12m');
    expect(timeLeft(now + 12 * 60 + 30, now)).toBe('12m');
    expect(timeLeft(now + 20, now)).toBe('<1m');
  });
  it('stops once it can be opened', () => {
    expect(opensIn(now, now)).toBeNull();
    expect(opensIn(now - 5, now)).toBeNull();
  });
});

describe('finding gifts', () => {
  let n = 0;
  const t = (id: bigint, from: Address, to: Address): CrystalEvent => ({ kind: 'transfer', id, from, to, block: BigInt(++n), logIndex: 0, tx: `0x${n.toString(16).padStart(64, '0')}` as Hash });
  const events = [t(1n, ZERO, ME), t(2n, ZERO, ME), t(2n, ME, FRIEND), t(3n, ZERO, FRIEND), t(3n, FRIEND, ME), t(4n, ZERO, ME), t(4n, ME, FRIEND), t(4n, FRIEND, OTHER)];

  it('a mint is not a gift; the latest transfer between wallets is', () => {
    expect(giftOf(events, 1n)).toBeNull();
    expect(giftOf(events, 2n)).toMatchObject({ from: ME, to: FRIEND });
    expect(giftOf(events, 4n)).toMatchObject({ from: FRIEND, to: OTHER });
  });

  it('lists the gifts a wallet holds right now', () => {
    expect([...giftsReceived(events, FRIEND).keys()]).toEqual([2n]);
    expect([...giftsReceived(events, ME).keys()]).toEqual([3n]);
    expect([...giftsReceived(events, OTHER).keys()]).toEqual([4n]);
    // burned (sent to 0x0): no longer anyone's gift
    expect([...giftsReceived([...events, t(2n, FRIEND, ZERO)], FRIEND).keys()]).toEqual([]);
  });

  it('Swap & forge’s hand-off from the router is not a gift (the router mints to itself, then sends it on)', () => {
    const ROUTER = '0xD1340ad67A4b5C0995CC050bE773ee74293fD24D' as Address;
    const viaRouter = [t(9n, ZERO, ROUTER), t(9n, ROUTER, ME)];
    expect(giftOf(viaRouter, 9n, { router: ROUTER })).toBeNull();
    expect([...giftsReceived(viaRouter, ME, { router: ROUTER }).keys()]).toEqual([]);
    // given away later: that one is a gift
    const thenGiven = [...viaRouter, t(9n, ME, FRIEND)];
    expect(giftOf(thenGiven, 9n, { router: ROUTER })).toMatchObject({ from: ME, to: FRIEND });
    expect([...giftsReceived(thenGiven, FRIEND, { router: ROUTER }).keys()]).toEqual([9n]);
  });
});
