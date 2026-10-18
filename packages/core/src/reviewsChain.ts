/**
 * Reads PrismReviews from the chain (read-only): every review as the contract stores it, the text
 * and position of its ReviewPosted event, who called markSold, and the live balances and supplies
 * scoring needs. Incremental: pass the previous result back in and only new blocks' events are read.
 * Reads both the current contract (v2) and PRISM's first one (v1, history only: its reviews up to
 * the last id before v2's first).
 */
import { decodeEventLog, erc20Abi, toFunctionSelector, type Abi, type Address, type Hex, type PublicClient } from 'viem';
import { prismReviewsAbi } from './abi/prismReviews';
import { prismReviewsV1Abi } from './abi/prismReviewsV1';
import { getLogsSplit } from './launchScan';
import { balanceKey, type Balances } from './scoring';
import { readSupplies } from './setup';
import type { BalanceMove } from './replay';
import type { ReviewChainData, StoredReview, Supply } from './reviews';

export interface ReviewChainState extends ReviewChainData {
  /** events are read up to and including this block */
  toBlock: bigint;
}

/** Which contract to read. */
export interface ReviewsSource {
  contract: Address;
  version: 1 | 2;
  /** its creation block (events are read from here) */
  fromBlock: bigint;
  /** v1: the last id to read (later posts on the retired contract are ignored) */
  lastId?: number;
  /**
   * v1: the blocks its reviews were posted in. The retired contract's history is frozen, so only
   * these blocks are read for their text (one call each, instead of millions of blocks per cold start).
   */
  postBlocks?: readonly bigint[];
}

const MARK_SOLD = toFunctionSelector('markSold(uint256)');

type Raw = { topics: Hex[]; data: Hex; blockNumber: string; logIndex: string; transactionHash: Hex };

export async function readReviewChain(client: PublicClient, src: ReviewsSource, prev: ReviewChainState | null = null, head?: bigint): Promise<ReviewChainState> {
  const abi: Abi = src.version === 2 ? prismReviewsAbi : prismReviewsV1Abi;
  const to = head ?? (await client.getBlockNumber());
  const posted = new Map(prev?.posted ?? []);
  const markedBy = new Map(prev?.markedBy ?? []);
  const start = prev ? prev.toBlock + 1n : src.fromBlock;
  let logs: Raw[] = [];
  if (src.postBlocks) {
    // frozen history: just the blocks the reviews were posted in, once
    if (!prev) for (const b of src.postBlocks) logs.push(...((await getLogsSplit(client, { address: src.contract, topics: [] }, b, b)) as unknown as Raw[]));
  } else if (start <= to) logs = (await getLogsSplit(client, { address: src.contract, topics: [] }, start, to)) as unknown as Raw[];
  const soldTxs: Array<{ id: number; hash: Hex }> = [];
  for (const l of logs) {
    try {
      const ev = decodeEventLog({ abi, topics: l.topics as [Hex, ...Hex[]], data: l.data }) as unknown as { eventName: string; args: { id: bigint; text?: string } };
      if (ev.eventName === 'ReviewPosted') {
        posted.set(Number(ev.args.id), { text: ev.args.text ?? '', block: Number(BigInt(l.blockNumber)), logIndex: Number(BigInt(l.logIndex)), txHash: l.transactionHash });
      } else if (ev.eventName === 'ReviewSold') {
        soldTxs.push({ id: Number(ev.args.id), hash: l.transactionHash });
      }
    } catch {
      /* not one of ours */
    }
  }
  // who made each sale permanent: only direct markSold calls count (a sale caught by the author's own update doesn't)
  for (const { id, hash } of soldTxs) {
    const tx = await client.getTransaction({ hash });
    if (tx.to?.toLowerCase() === src.contract.toLowerCase() && tx.input.slice(0, 10).toLowerCase() === MARK_SOLD) markedBy.set(id, tx.from);
  }
  // every review's current state, straight from the contract (statuses change after posting)
  const count = Number(await client.readContract({ address: src.contract, abi, functionName: 'reviewCount', blockNumber: to }));
  const first = src.version === 2 ? Number(await client.readContract({ address: src.contract, abi, functionName: 'firstId', blockNumber: to })) : 1;
  const last = src.lastId !== undefined ? Math.min(count, src.lastId) : count;
  const stored = new Map<number, StoredReview>();
  for (let a = first; a <= last; a += 400) {
    const ids = Array.from({ length: Math.min(400, last - a + 1) }, (_, i) => a + i);
    const res = await client.multicall({
      allowFailure: false,
      blockNumber: to,
      contracts: ids.map((id) => ({ address: src.contract, abi, functionName: 'getReview', args: [BigInt(id)] }) as const),
    });
    ids.forEach((id, i) => {
      const r = res[i] as { author: Address; rating: number; status: number; postedAt: number; soldAt: number; token: Address; previous: bigint; heldAtPost: bigint; baseline?: bigint };
      stored.set(id, {
        author: r.author,
        rating: Number(r.rating),
        status: Number(r.status),
        postedAt: Number(r.postedAt),
        soldAt: Number(r.soldAt),
        token: r.token,
        previous: Number(r.previous),
        heldAtPost: r.heldAtPost,
        // v1 measured SOLD from the balance at posting
        baseline: r.baseline ?? r.heldAtPost,
      });
    });
  }
  // drop events of ids outside the range (v1 posts after the cutoff)
  for (const id of posted.keys()) if (!stored.has(id)) posted.delete(id);
  return { toBlock: to, stored, posted, markedBy };
}

/** Live balances (at `block`) of every (author, token) pair with an active review, in the given data sets. */
export async function readReviewBalances(client: PublicClient, sets: ReadonlyArray<Pick<ReviewChainData, 'stored'>>, block?: bigint): Promise<Balances> {
  const pairs = new Map<string, { author: Address; token: Address }>();
  for (const data of sets) for (const s of data.stored.values()) if (s.status === 1) pairs.set(balanceKey(s.author, s.token), { author: s.author, token: s.token });
  const list = [...pairs.values()];
  const out = new Map<string, bigint | null>();
  for (let i = 0; i < list.length; i += 400) {
    const slice = list.slice(i, i + 400);
    const res = await client.multicall({
      allowFailure: true,
      blockNumber: block,
      contracts: slice.map((p) => ({ address: p.token, abi: erc20Abi, functionName: 'balanceOf', args: [p.author] }) as const),
    });
    slice.forEach((p, j) => out.set(balanceKey(p.author, p.token), res[j]?.status === 'success' ? (res[j]!.result as bigint) : null));
  }
  return out;
}

/** Supply and decimals of every reviewed token. */
export async function readReviewSupplies(client: PublicClient, sets: ReadonlyArray<Pick<ReviewChainData, 'stored'>>): Promise<Map<string, Supply | null>> {
  const tokens = [...new Set(sets.flatMap((d) => [...d.stored.values()].map((s) => s.token.toLowerCase())))] as Address[];
  return readSupplies(client, tokens);
}

const TRANSFER: Hex = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const addressTopic = (a: Address) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}` as Hex;

/**
 * Every Transfer of `token` into or out of `authors` in [from, to], as balance moves per author
 * (for the replay in replay.ts): two filtered eth_getLogs per 100k blocks (from them, to them).
 */
export async function readAuthorMoves(client: PublicClient, token: Address, authors: readonly Address[], from: bigint, to: bigint): Promise<Map<string, BalanceMove[]>> {
  const out = new Map<string, BalanceMove[]>(authors.map((a) => [a.toLowerCase(), []]));
  if (!authors.length || from > to) return out;
  const topics = authors.map(addressTopic);
  const [outgoing, incoming] = await Promise.all([
    getLogsSplit(client, { address: token, topics: [TRANSFER, topics] }, from, to),
    getLogsSplit(client, { address: token, topics: [TRANSFER, null, topics] }, from, to),
  ]);
  const add = (l: Raw, who: Hex | undefined, sign: 1n | -1n) => {
    if (!who) return;
    const a = `0x${who.slice(26)}`.toLowerCase();
    const list = out.get(a);
    if (!list || l.data.length < 66) return;
    list.push({ block: Number(BigInt(l.blockNumber)), logIndex: Number(BigInt(l.logIndex)), delta: sign * BigInt(l.data.slice(0, 66)) });
  };
  for (const l of outgoing as unknown as Raw[]) add(l, l.topics[1], -1n);
  for (const l of incoming as unknown as Raw[]) add(l, l.topics[2], 1n);
  return out;
}

/** Unix time of a block. */
export async function blockTime(client: PublicClient, block: number): Promise<number> {
  return Number((await client.getBlock({ blockNumber: BigInt(block) })).timestamp);
}
