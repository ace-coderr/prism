import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseEther, type Address, type Hash, type Log } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  LINK_GAS_DEFAULT,
  activityOf,
  allGifts,
  badgesOf,
  claimKeyFromHash,
  claimPath,
  decodeLinkData,
  giftOf,
  giftsReceived,
  joinedViaGift,
  linkData,
  linkState,
  linksFromLogs,
  prismGiftLinksAbi,
  sweepValue,
  type CrystalEvent,
} from '../src';

const ME = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e' as Address;
const FRIEND = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const LINKS = '0x3333333333333333333333333333333333333333' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

describe('link data and the claim URL', () => {
  it('round-trips the claim key, expiry and note (any script or emoji)', () => {
    const key = privateKeyToAccount(generatePrivateKey()).address;
    const data = linkData(key, 1_800_000_000, 'for you 🎁 ✨');
    expect(decodeLinkData(data)).toEqual({ claimKey: key, expiry: 1_800_000_000, note: 'for you 🎁 ✨' });
    expect(decodeLinkData('0x1234')).toBeNull();
  });

  it('puts the private key only in the fragment, and reads it back', () => {
    const key = generatePrivateKey();
    const path = claimPath(42n, key);
    expect(path).toBe(`/claim/42#k=${key.slice(2)}`);
    const url = new URL(`https://prism-crystal.vercel.app${path}`);
    expect(url.pathname).toBe('/claim/42'); // what a server would see: no key
    expect(claimKeyFromHash(url.hash)).toBe(key);
    expect(claimKeyFromHash(`#k=${key}`)).toBe(key); // with 0x too
  });

  it('refuses a missing, short, non-hex or zero key', () => {
    expect(claimKeyFromHash('')).toBeNull();
    expect(claimKeyFromHash('#x=1')).toBeNull();
    expect(claimKeyFromHash('#k=abc')).toBeNull();
    expect(claimKeyFromHash(`#k=${'z'.repeat(64)}`)).toBeNull();
    expect(claimKeyFromHash(`#k=${'0'.repeat(64)}`)).toBeNull();
  });
});

describe('links from the contract’s events', () => {
  let n = 0;
  const log = (eventName: 'LinkCreated' | 'LinkClaimed' | 'LinkCancelled', args: Record<string, unknown>, data: `0x${string}` = '0x'): Log => {
    n++;
    return {
      address: LINKS,
      topics: encodeEventTopics({ abi: prismGiftLinksAbi, eventName, args } as never) as never,
      data,
      blockNumber: BigInt(100 + n),
      logIndex: n,
      transactionHash: `0x${n.toString(16).padStart(64, '0')}` as Hash,
      transactionIndex: 0,
      blockHash: `0x${'ab'.repeat(32)}`,
      removed: false,
    };
  };
  const key = privateKeyToAccount(generatePrivateKey()).address;
  const created = (id: bigint, crystalId: bigint, note: string) =>
    log('LinkCreated', { linkId: id, sender: ME, crystalId }, encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }, { type: 'string' }], [key, 2_000n, note]));

  it('builds each link with its note, and follows claims and cancels', () => {
    const links = linksFromLogs([
      created(1n, 5n, 'one'),
      created(2n, 6n, 'two'),
      created(3n, 7n, ''),
      log('LinkClaimed', { linkId: 1n, recipient: FRIEND, crystalId: 5n }),
      log('LinkCancelled', { linkId: 2n, sender: ME, crystalId: 6n }),
    ]);
    expect(links.map((l) => [l.id, l.crystalId, l.note, l.claimKey, l.expiry, l.claimedBy, l.cancelled])).toEqual([
      [1n, 5n, 'one', key, 2_000, FRIEND, false],
      [2n, 6n, 'two', key, 2_000, null, true],
      [3n, 7n, '', key, 2_000, null, false],
    ]);
    expect(links.map((l) => linkState(l, 1_000))).toEqual(['claimed', 'cancelled', 'waiting']);
    expect(linkState(links[2]!, 2_000)).toBe('expired');
  });
});

describe('the claim key’s leftover goes to the recipient', () => {
  it('sends the balance minus the most the transfer can cost', () => {
    expect(sweepValue(LINK_GAS_DEFAULT, 50_000n, 10_000_000n)).toBe(LINK_GAS_DEFAULT - 500_000_000_000n);
    expect(sweepValue(1000n, 21_000n, 1n)).toBeNull();
    expect(LINK_GAS_DEFAULT).toBe(parseEther('0.0005'));
  });
});

describe('gift links in gifts, activity and badges', () => {
  let n = 0;
  const t = (id: bigint, from: Address, to: Address): CrystalEvent => ({
    kind: 'transfer',
    id,
    from,
    to,
    block: BigInt(++n),
    logIndex: 0,
    tx: `0x${n.toString(16).padStart(64, '0')}` as Hash,
  });
  const forged = (id: bigint, owner: Address): CrystalEvent => ({ kind: 'forged', id, account: owner, block: BigInt(++n), logIndex: 1, tx: `0x${n.toString(16).padStart(64, '0')}` as Hash });
  // #1: me → link → claimed by FRIEND · #2: me → link → cancelled (back to me) · #3: me → link, still waiting
  const events = [
    t(1n, ZERO, ME),
    forged(1n, ME),
    t(2n, ZERO, ME),
    forged(2n, ME),
    t(3n, ZERO, ME),
    forged(3n, ME),
    t(1n, ME, LINKS),
    t(2n, ME, LINKS),
    t(3n, ME, LINKS),
    t(1n, LINKS, FRIEND),
    t(2n, LINKS, ME),
  ];
  const contracts = { giftLinks: LINKS };

  it('a claimed link is a gift from whoever made it; a deposit or a cancel is not', () => {
    const gifts = allGifts(events, contracts);
    expect(gifts.map((g) => [g.id, g.from, g.to, g.via])).toEqual([[1n, ME, FRIEND, 'link']]);
    expect(gifts[0]!.linkTx).toBe(events[6]!.tx); // where the note is
    expect(giftOf(events, 2n, contracts)).toBeNull();
    expect(giftOf(events, 3n, contracts)).toBeNull();
    expect([...giftsReceived(events, FRIEND, contracts).keys()]).toEqual([1n]);
    expect([...giftsReceived(events, ME, contracts).keys()]).toEqual([]);
    // without knowing the links contract it would look like a gift to the contract
    expect(giftOf(events, 3n)?.to).toBe(LINKS);
  });

  it('counts for the Gifter badge only once claimed, and as "joined via a gift" for the recipient', () => {
    const mine = activityOf(events, ME, contracts);
    expect(mine.filter((a) => a.kind === 'gifted').map((a) => [a.id, a.counterparty, a.via])).toEqual([[1n, FRIEND, 'link']]);
    expect(badgesOf({ activity: mine, owned: [] }).find((b) => b.id === 'gifter')?.isEarned).toBe(true);
    const waitingOnly = activityOf(events.slice(0, 9), ME, contracts); // links made, none claimed yet
    expect(badgesOf({ activity: waitingOnly, owned: [] }).find((b) => b.id === 'gifter')?.isEarned).toBe(false);

    const theirs = activityOf(events, FRIEND, contracts);
    expect(theirs.map((a) => [a.kind, a.counterparty, a.via])).toEqual([['received', ME, 'link']]);
    expect(joinedViaGift(theirs)?.counterparty).toBe(ME);
    expect(joinedViaGift(mine)).toBeNull(); // I joined by forging
    expect(activityOf(events, OTHER, contracts)).toEqual([]);
  });
});
