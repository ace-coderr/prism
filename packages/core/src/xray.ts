/**
 * Launch X-ray: what the chain says about a launch, before anyone has reviewed it.
 *
 * Every line is a fact with the number behind it and a link to the transaction or address it came
 * from: what the creator acquired, holds and sold; how concentrated the holders are; what the first
 * buyers did; how the holder count moved in the last day; the tax; and how old it is. PRISM states
 * facts and lets people judge: no buy / sell / avoid wording, no risk score, no ranking.
 *
 * Anything that can't be read says so instead of guessing, and anything worked out rather than read
 * exactly (a block's time when its timestamp wasn't fetched) is flagged `estimated`.
 *
 * Pure: the caller passes the transfers, balances and times (see apps/web/server/xray.ts).
 *
 * On vibe/vibe the whole supply is minted to the bonding curve, not to the creator: a creator holds
 * only what they bought like anyone else. So there is no "creator allocation" here; what the creator
 * acquired, when, and whether they still hold it is the honest version of that question.
 */
import type { Address } from 'viem';
import type { LaunchSetup } from './setup';

/** One Transfer of the token, in chain order. */
export interface XrayTransfer {
  from: string;
  to: string;
  value: bigint;
  block: number;
  logIndex: number;
}

export interface XrayInput {
  token: Address;
  symbol: string;
  /** who launched it (from the launch event); null for test stocks */
  creator: Address | null;
  /** the block the launch event is in */
  launchBlock: number;
  /** its bonding curve (tokens leaving it are buys, tokens going back are sells) */
  curve: Address | null;
  /** the Uniswap V4 pool manager, once it has graduated */
  poolManager: Address | null;
  graduatedBlock: number | null;
  /** every Transfer since the launch block, oldest first */
  transfers: readonly XrayTransfer[];
  /** true when the transfers are the full history (false: don't state anything that needs all of them) */
  complete: boolean;
  totalSupply: bigint | null;
  decimals: number;
  setup: LaunchSetup | null;
  /** exact unix seconds for the blocks that were looked up */
  timeOf: ReadonlyMap<number, number>;
  /** seconds per block, for blocks whose time wasn't looked up (flagged estimated) */
  secondsPerBlock: number;
  nowBlock: number;
  /** unix seconds */
  now: number;
}

export type XraySignalId = 'creator' | 'concentration' | 'early' | 'holders' | 'tax' | 'age';

export interface XrayEvidence {
  kind: 'address' | 'block';
  /** an address, or a block number as a string */
  value: string;
}

export interface XraySignal {
  id: XraySignalId;
  /** one short plain sentence, with the real number in it */
  text: string;
  /** what it was read from, to open on the explorer */
  evidence: XrayEvidence | null;
  /** a time worked out from the block rate rather than a looked-up timestamp */
  estimated: boolean;
}

/** A signal PRISM couldn't read, said plainly rather than left out. */
export interface XrayUnread {
  id: XraySignalId;
  text: string;
}

export interface CreatorFacts {
  address: Address;
  /** everything that ever reached them */
  acquired: bigint;
  /** what they hold now */
  holds: bigint;
  /** everything that left their wallet (selling, or moving it anywhere else) */
  movedOut: bigint;
  /** their first buy or transfer in, if any */
  firstInBlock: number | null;
  /** when they first moved tokens out */
  firstOutBlock: number | null;
  /** the largest single transfer out */
  biggestOut: bigint;
  biggestOutBlock: number | null;
  /** holds nothing, having held something before */
  soldEverything: boolean;
  /** share of the supply they hold now, 0..1 */
  shareOfSupply: number | null;
}

export interface ConcentrationFacts {
  /** balances counted: holders only (no curve, pool, token contract or burn address) */
  holders: number;
  /** what those wallets hold between them */
  walletHeld: bigint;
  totalSupply: bigint | null;
  /**
   * The top wallets' share **of the whole supply**, 0..1. Measuring against what wallets hold
   * instead made almost every graduated launch look owned by three people: most of the supply sits
   * in the pool, so $BNB's top 3 were "91.5%" of a 4.2% sliver (3.8% of the token).
   */
  top3: number | null;
  top10: number | null;
  /** how much of the supply sits in its pool, curve or own reward pool rather than anyone's wallet */
  notInWallets: number | null;
  /** the biggest holder's address and share of the supply */
  biggest: { address: string; share: number } | null;
}

export interface EarlyBuyerFacts {
  /** how many of the first buyers were looked at (up to EARLY_BUYERS) */
  counted: number;
  stillHolding: number;
  /** sold or moved everything out within an hour of buying */
  goneWithinHour: number;
  /** true when every buy time came from a looked-up timestamp */
  exactTimes: boolean;
}

export interface Xray {
  signals: XraySignal[];
  unread: XrayUnread[];
  /** the one short line worth showing on a card or in search, or null */
  flag: string | null;
  creator: CreatorFacts | null;
  concentration: ConcentrationFacts | null;
  early: EarlyBuyerFacts | null;
  /** holders now and 24 hours ago (null when the history doesn't reach back a day) */
  holders: { now: number; dayAgo: number | null } | null;
  ageSeconds: number | null;
}

/** How many of the first buyers the early-buyer signal looks at. */
export const EARLY_BUYERS = 20;
const HOUR = 3600;
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dead';

const low = (a: string | null | undefined) => (a ?? '').toLowerCase();
const isBurn = (a: string) => a === ZERO || a === DEAD;

/** A whole-token amount, short: "1.2M", "480", "0.0005". */
export function amount(base: bigint, decimals: number): string {
  const n = Number(base) / 10 ** decimals;
  if (n === 0) return '0';
  if (n >= 100_000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return n.toLocaleString('en-US', { maximumSignificantDigits: n >= 1 ? 4 : 2 });
}

/** A share of a whole, keeping enough precision for small holders (1e-6 truncated them to 0%). */
const ratio = (part: bigint, whole: bigint): number | null => (whole > 0n ? Number((part * 10n ** 12n) / whole) / 1e12 : null);

/** "1 wallet holds", "143 wallets hold". */
const wallets = (n: number) => `${n.toLocaleString('en-US')} wallet${n === 1 ? ' holds' : 's hold'}`;

/** A share as a percentage: "92%", "0.4%", "<0.1%". */
export function share(v: number): string {
  const p = v * 100;
  if (p > 0 && p < 0.1) return '<0.1%';
  return `${p >= 10 ? Math.round(p) : Number(p.toFixed(1))}%`;
}

/** A length of time in plain words: "4 minutes", "12 days". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const units: Array<[number, string]> = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];
  for (const [size, name] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return 'less than a second';
}

/** Everything one pass over the transfers tells us; shared by `xray` and `blocksNeeded`. */
/** What a creator did with their own launch: filled in one transfer at a time. */
export interface CreatorMoves {
  acquired: bigint;
  movedOut: bigint;
  firstInBlock: number | null;
  firstOutBlock: number | null;
  biggestOut: bigint;
  biggestOutBlock: number | null;
}

export const noMoves = (): CreatorMoves => ({ acquired: 0n, movedOut: 0n, firstInBlock: null, firstOutBlock: null, biggestOut: 0n, biggestOutBlock: null });

/** Fold one transfer into a creator's moves (`creator` lower case). */
export function applyCreatorMove(c: CreatorMoves, t: XrayTransfer, creator: string): void {
  if (t.value === 0n || !creator) return;
  if (low(t.to) === creator) {
    c.acquired += t.value;
    c.firstInBlock ??= t.block;
  }
  if (low(t.from) === creator) {
    c.movedOut += t.value;
    c.firstOutBlock ??= t.block;
    if (t.value > c.biggestOut) {
      c.biggestOut = t.value;
      c.biggestOutBlock = t.block;
    }
  }
}

/**
 * A creator's moves from their own transfers alone. Reading only the transfers into and out of one
 * address is two filtered queries over the whole life of the launch, instead of its full history:
 * cheap enough to watch thousands of launches on a schedule (scripts/warm-xray.ts).
 */
export function creatorMoves(transfers: readonly XrayTransfer[], creator: string): CreatorMoves {
  const c = noMoves();
  for (const t of transfers) applyCreatorMove(c, t, creator.toLowerCase());
  return c;
}

/** What a creator holds, from their moves alone (every transfer in and out is counted). */
export const creatorHolds = (c: CreatorMoves): bigint => (c.acquired > c.movedOut ? c.acquired - c.movedOut : 0n);

function scan(input: XrayInput) {
  const curve = low(input.curve);
  const pool = low(input.poolManager);
  const token = low(input.token);
  const creator = low(input.creator);
  const balances = new Map<string, bigint>();
  const dayAgo = new Map<string, bigint>();
  const dayAgoBlock = input.nowBlock - Math.round(86400 / Math.max(input.secondsPerBlock, 1e-9));
  const firstBuy = new Map<string, number>();
  const firstOut = new Map<string, number>();
  const c = noMoves();
  const add = (m: Map<string, bigint>, who: string, v: bigint) => {
    if (!isBurn(who)) m.set(who, (m.get(who) ?? 0n) + v);
  };
  for (const t of input.transfers) {
    const from = low(t.from);
    const to = low(t.to);
    add(balances, from, -t.value);
    add(balances, to, t.value);
    if (t.block <= dayAgoBlock) {
      add(dayAgo, from, -t.value);
      add(dayAgo, to, t.value);
    }
    if (t.value === 0n) continue;
    // a buy is the curve (or the pool) sending tokens to a wallet
    if ((from === curve || from === pool) && to !== curve && to !== pool && to !== token && !isBurn(to) && !firstBuy.has(to) && firstBuy.size < EARLY_BUYERS) firstBuy.set(to, t.block);
    applyCreatorMove(c, t, creator);
  }
  // when each early buyer first sent tokens out again
  for (const t of input.transfers) {
    const from = low(t.from);
    if (t.value === 0n || !firstBuy.has(from) || t.block < (firstBuy.get(from) ?? 0)) continue;
    if (!firstOut.has(from)) firstOut.set(from, t.block);
  }
  return { curve, pool, token, creator, balances, dayAgo, firstBuy, firstOut, creatorStats: c };
}

/** A test stock: issued by vibe/vibe, with no launch, creator or curve to X-ray. */
const isStock = (input: Pick<XrayInput, 'setup'>) => input.setup?.kind === 'stock';

/**
 * The blocks whose exact times change what the X-ray says: the launch, now, what the creator did,
 * and when the first buyers bought and left. Look these up and pass them back in as `timeOf` and
 * nothing is left to the block rate; everything else is read from the transfers alone.
 */
export function blocksNeeded(input: XrayInput): number[] {
  if (isStock(input)) return [];
  const { firstBuy, firstOut, creatorStats: c } = scan(input);
  const out = new Set<number>([input.launchBlock, input.nowBlock]);
  for (const b of [c.firstInBlock, c.firstOutBlock, c.biggestOutBlock]) if (b !== null) out.add(b);
  for (const [who, b] of firstBuy) {
    out.add(b);
    const o = firstOut.get(who);
    if (o !== undefined) out.add(o);
  }
  return [...out];
}

/**
 * What the creator did with their own launch, in one plain sentence. Shared by the X-ray on a
 * launch's page and the "creators selling" feed, which is built from the published creator watch,
 * so the two can never say it differently.
 */
export function creatorLine(o: {
  moves: CreatorMoves;
  holds: bigint;
  symbol: string;
  decimals: number;
  /** what they hold now as a share of the supply, when it is known */
  shareOfSupply: number | null;
  /** how long ago the launch was, when it is known */
  ageSeconds: number | null;
  /** how long after buying they first moved tokens out, when it is known */
  soldAfterSeconds: number | null;
}): string {
  const { acquired, movedOut, biggestOut } = o.moves;
  const sym = `$${o.symbol}`;
  const ofSupply = o.shareOfSupply === null ? '' : ` (${share(o.shareOfSupply)} of the supply)`;
  if (acquired === 0n) return `The creator has never held any ${sym}.`;
  if (o.holds === 0n) {
    const when = o.soldAfterSeconds === null ? '' : `, starting ${duration(o.soldAfterSeconds)} after buying`;
    return `The creator sold every ${sym} they held (${amount(acquired, o.decimals)})${when}.`;
  }
  if (movedOut === 0n) {
    const since = o.ageSeconds === null ? '' : `, ${duration(o.ageSeconds)} after launching`;
    return `The creator still holds all ${amount(o.holds, o.decimals)} ${sym} they bought${ofSupply}${since}.`;
  }
  const sold = share(Math.min(1, ratio(movedOut, acquired) ?? 0));
  const how = biggestOut === movedOut ? 'all in one sale' : `biggest sale ${amount(biggestOut, o.decimals)}`;
  return `The creator has sold ${sold} of the ${sym} they bought (${how}) and still holds ${amount(o.holds, o.decimals)}${ofSupply}.`;
}

export function xray(input: XrayInput): Xray {
  const { decimals, totalSupply } = input;
  const signals: XraySignal[] = [];
  const unread: XrayUnread[] = [];
  const { curve, pool, token, creator, balances, dayAgo, firstBuy, firstOut, creatorStats } = scan(input);

  /** exact time of a block, or worked out from the block rate */
  const timeAt = (block: number): { at: number; estimated: boolean } => {
    const exact = input.timeOf.get(block);
    if (exact !== undefined) return { at: exact, estimated: false };
    const anchor = input.timeOf.get(input.nowBlock);
    const base = anchor ?? input.now;
    return { at: base - (input.nowBlock - block) * input.secondsPerBlock, estimated: true };
  };

  if (isStock(input)) {
    return {
      signals: [
        {
          id: 'age',
          text: 'A vibe/vibe test stock: no launch, creator or bonding curve to X-ray. Its price, holders and trading are above.',
          evidence: { kind: 'address', value: input.token },
          estimated: false,
        },
      ],
      unread: [],
      flag: null,
      creator: null,
      concentration: null,
      early: null,
      holders: null,
      ageSeconds: null,
    };
  }

  // ---------------------------------------------------------------- age and status
  const launchTime = timeAt(input.launchBlock);
  const ageSeconds = input.now - launchTime.at;
  const graduated = input.graduatedBlock !== null;
  const status = input.setup?.kind === 'stock' ? 'A test stock' : graduated ? 'Graduated to a pool' : 'Still on its bonding curve';
  signals.push({
    id: 'age',
    text: `${status}, launched ${duration(ageSeconds)} ago.`,
    evidence: { kind: 'block', value: String(input.launchBlock) },
    estimated: launchTime.estimated,
  });

  // ---------------------------------------------------------------- who holds what, now and a day ago
  const reachesADayBack = input.launchBlock <= input.nowBlock - Math.round(86400 / Math.max(input.secondsPerBlock, 1e-9));
  /** everyone holding some, leaving out the curve, the pool, the token's own reward pool and burns */
  const holdersIn = (m: ReadonlyMap<string, bigint>) => [...m].filter(([a, v]) => v > 0n && a !== curve && a !== pool && a !== token && !isBurn(a));
  const held = holdersIn(balances);
  const holdersNow = held.length;
  const holdersThen = reachesADayBack ? holdersIn(dayAgo).length : null;

  // ---------------------------------------------------------------- the creator
  let creatorFacts: CreatorFacts | null = null;
  if (!input.creator) {
    if (input.setup?.kind !== 'stock') unread.push({ id: 'creator', text: 'PRISM couldn’t read who launched this.' });
  } else if (!input.complete) {
    unread.push({ id: 'creator', text: 'PRISM couldn’t read this launch’s full history yet, so it can’t say what the creator did.' });
  } else {
    const { acquired, movedOut, firstInBlock, firstOutBlock, biggestOut, biggestOutBlock } = creatorStats;
    const holds = balances.get(creator) ?? 0n;
    const shareOfSupply = totalSupply ? ratio(holds, totalSupply) : null;
    creatorFacts = {
      address: input.creator,
      acquired,
      holds,
      movedOut,
      firstInBlock,
      firstOutBlock,
      biggestOut,
      biggestOutBlock,
      soldEverything: acquired > 0n && holds === 0n,
      shareOfSupply,
    };
    const evidence: XrayEvidence = { kind: 'address', value: input.creator };
    const out = timeAt(firstOutBlock ?? input.launchBlock);
    signals.push({
      id: 'creator',
      text: creatorLine({
        moves: creatorStats,
        holds,
        symbol: input.symbol,
        decimals,
        shareOfSupply,
        ageSeconds,
        soldAfterSeconds: firstOutBlock === null ? null : out.at - timeAt(firstInBlock ?? input.launchBlock).at,
      }),
      evidence,
      estimated: acquired === 0n ? false : movedOut > 0n ? out.estimated : launchTime.estimated,
    });
  }

  // ---------------------------------------------------------------- concentration
  let concentration: ConcentrationFacts | null = null;
  if (!input.complete) {
    unread.push({ id: 'concentration', text: 'PRISM couldn’t read every holder yet, so it can’t say how concentrated they are.' });
  } else if (holdersNow === 0) {
    unread.push({ id: 'concentration', text: `Nobody holds any $${input.symbol} yet.` });
  } else {
    const sorted = [...held].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
    const walletHeld = sorted.reduce((s, [, v]) => s + v, 0n);
    // what sits in the pool, the curve or the token's own reward pool belongs to nobody
    const parked = [curve, pool, token].reduce((s, a) => s + (a && (balances.get(a) ?? 0n) > 0n ? balances.get(a)! : 0n), 0n);
    // shares of the whole supply (what people mean by "the top 3 hold x%")
    const base = totalSupply && totalSupply > 0n ? totalSupply : null;
    const shareOf = (part: bigint) => (base ? ratio(part, base) : null);
    const sum = (n: number) => sorted.slice(0, n).reduce((s, [, v]) => s + v, 0n);
    const top3 = shareOf(sum(3));
    const top10 = shareOf(sum(10));
    const notInWallets = shareOf(parked);
    const biggest = sorted[0] ? { address: sorted[0][0], share: shareOf(sorted[0][1]) ?? 0 } : null;
    concentration = { holders: holdersNow, walletHeld, totalSupply: base, top3, top10, notInWallets, biggest };
    const evidence: XrayEvidence | null = biggest ? { kind: 'address', value: biggest.address } : null;
    const parkedLine = notInWallets !== null && notInWallets >= 0.005 ? ` Another ${share(notInWallets)} sits in its ${graduated ? 'pool' : 'bonding curve'}, in nobody’s wallet.` : '';
    if (base === null) {
      // without the supply, the only honest statement is about what wallets hold between them
      const n = Math.min(3, holdersNow);
      const ofHeld = ratio(sum(n), walletHeld) ?? 0;
      signals.push({
        id: 'concentration',
        text: `${wallets(holdersNow)} it. PRISM couldn’t read the supply, so it can only say the ${n === 1 ? 'biggest holder has' : `top ${n} hold`} ${share(ofHeld)} of what those wallets hold between them.`,
        evidence,
        estimated: false,
      });
    } else if (holdersNow === 1) {
      signals.push({ id: 'concentration', text: `One wallet holds ${share(top3 ?? 0)} of the supply, and nobody else holds any.${parkedLine}`, evidence, estimated: false });
    } else {
      const parts = [top3 === null ? null : `the top 3 hold ${share(top3)} of the supply`, holdersNow > 3 && top10 !== null ? `the top 10 hold ${share(top10)}` : null].filter(Boolean);
      signals.push({
        id: 'concentration',
        text: `Of the ${holdersNow.toLocaleString('en-US')} wallets holding $${input.symbol}, ${parts.join(' and ')}.${parkedLine}`,
        evidence,
        estimated: false,
      });
    }
  }

  // ---------------------------------------------------------------- the first buyers
  let early: EarlyBuyerFacts | null = null;
  const canSeeBuys = curve !== '' || pool !== '';
  if (!input.complete) {
    unread.push({ id: 'early', text: 'PRISM couldn’t read the first buyers yet.' });
  } else if (!canSeeBuys) {
    unread.push({ id: 'early', text: 'PRISM can’t tell buys apart for this token, so it can’t follow the first buyers.' });
  } else {
    if (firstBuy.size === 0) {
      unread.push({ id: 'early', text: `Nobody has bought $${input.symbol} yet.` });
    } else {
      let stillHolding = 0;
      let goneWithinHour = 0;
      let exactTimes = true;
      for (const [who, boughtAt] of firstBuy) {
        if ((balances.get(who) ?? 0n) > 0n) stillHolding++;
        const outBlock = firstOut.get(who);
        if (outBlock === undefined) continue;
        if ((balances.get(who) ?? 0n) > 0n) continue; // trimmed, not gone
        const bought = timeAt(boughtAt);
        const out = timeAt(outBlock);
        if (bought.estimated || out.estimated) exactTimes = false;
        if (out.at - bought.at <= HOUR) goneWithinHour++;
      }
      early = { counted: firstBuy.size, stillHolding, goneWithinHour, exactTimes };
      const gone = goneWithinHour > 0 ? ` and ${goneWithinHour} ${goneWithinHour === 1 ? 'was' : 'were'} out within an hour` : '';
      const text =
        firstBuy.size === 1
          ? `Its first buyer ${stillHolding === 1 ? 'still holds' : 'is out'}${goneWithinHour > 0 ? ', within an hour of buying' : ''}.`
          : `Of its first ${firstBuy.size} buyers, ${stillHolding} still hold${stillHolding === 1 ? 's' : ''}${gone}.`;
      signals.push({
        id: 'early',
        text,
        evidence: null,
        estimated: !exactTimes,
      });
    }
  }

  // ---------------------------------------------------------------- holders over a day
  if (!input.complete) {
    unread.push({ id: 'holders', text: 'PRISM couldn’t read the holder history yet.' });
  } else if (holdersThen === null) {
    signals.push({
      id: 'holders',
      text: `It is less than a day old, so there is nothing to compare yet: ${wallets(holdersNow)} it.`,
      evidence: null,
      estimated: false,
    });
  } else {
    const diff = holdersNow - holdersThen;
    const moved = diff === 0 ? 'the same as yesterday' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString('en-US')} in the last day`;
    signals.push({ id: 'holders', text: `${wallets(holdersNow)} it, ${moved}.`, evidence: null, estimated: true });
  }

  // ---------------------------------------------------------------- the tax
  const setup = input.setup;
  if (!setup) {
    unread.push({ id: 'tax', text: 'PRISM couldn’t read this launch’s setup.' });
  } else if (setup.kind === 'stock') {
    signals.push({ id: 'tax', text: 'A test stock: no launch, tax or bonding curve.', evidence: null, estimated: false });
  } else if (setup.kind === 'v6') {
    const s = setup.split;
    const toHolders = s ? s.holdersPair + s.holdersToken : null;
    const tax = `${Number((setup.taxBps / 100).toFixed(2))}% tax on every trade`;
    signals.push({
      id: 'tax',
      text: s === null ? `${tax}; PRISM couldn’t read how it is split.` : toHolders === 0 ? `${tax}, and none of it goes to holders.` : `${tax}, ${share(toHolders! / 10000)} of the creator’s part going back to holders.`,
      evidence: { kind: 'address', value: input.token },
      estimated: false,
    });
  } else {
    const fee = setup.feeBps;
    signals.push({
      id: 'tax',
      // gen 0/1/2: the creator picks no tax, the curve charges a fixed fee (nothing to do with the launch's age)
      text:
        fee === null
          ? 'From an earlier vibe/vibe generation: no creator tax, a fixed curve fee PRISM couldn’t read.'
          : `From an earlier vibe/vibe generation: no creator tax, a fixed ${Number((fee / 100).toFixed(2))}% curve fee, none of it to holders.`,
      evidence: { kind: 'address', value: input.token },
      estimated: false,
    });
  }

  return {
    signals,
    unread,
    flag: flagOf({ creator: creatorFacts, concentration, early }),
    creator: creatorFacts,
    concentration,
    early,
    holders: input.complete ? { now: holdersNow, dayAgo: holdersThen } : null,
    ageSeconds,
  };
}

/**
 * The one short line worth showing next to a launch in a list, or null when nothing stands out.
 * Facts only, in the order that most changes what someone is looking at.
 */
export function flagOf(x: Pick<Xray, 'creator' | 'concentration' | 'early'>): string | null {
  if (x.creator?.soldEverything) return 'Creator sold out';
  if (x.creator && x.creator.acquired > 0n && x.creator.movedOut > 0n) {
    const part = Number((x.creator.movedOut * 100n) / x.creator.acquired);
    if (part >= 50) return `Creator sold ${part >= 99 ? 'nearly all' : `${part}%`} of their bag`;
  }
  // of the whole supply: "80% of what wallets hold" fired on nearly every graduated launch, where
  // most of the supply sits in the pool
  if (x.concentration?.top3 != null && x.concentration.holders > 1 && x.concentration.top3 >= 0.5) {
    return `Top ${x.concentration.holders < 3 ? x.concentration.holders : 3} wallets hold ${share(x.concentration.top3)} of the supply`;
  }
  if (x.early && x.early.counted >= 5 && x.early.goneWithinHour * 2 >= x.early.counted) {
    return `${x.early.goneWithinHour} of the first ${x.early.counted} buyers left within an hour`;
  }
  if (x.creator && x.creator.acquired > 0n && x.creator.movedOut === 0n && x.creator.shareOfSupply !== null && x.creator.shareOfSupply >= 0.5) {
    return `Creator holds ${share(x.creator.shareOfSupply)} of the supply`;
  }
  return null;
}
