/**
 * Reads PrismReviews from the chain (read-only): every review as the contract stores it, the text
 * from its ReviewPosted event, who called markSold, and the live balances and supplies scoring needs.
 * Incremental: pass the previous result back in and only new blocks' events are read.
 */
import { decodeEventLog, toFunctionSelector, type Address, type Hex, type PublicClient } from 'viem';
import { prismReviewsAbi } from './abi/prismReviews';
import { getLogsSplit } from './launchScan';
import { balancesOf } from './launchScan';
import { balanceKey, type Balances } from './scoring';
import { readSupplies } from './setup';
import type { ReviewChainData, StoredReview, Supply } from './reviews';

export interface ReviewChainState extends ReviewChainData {
  /** events are read up to and including this block */
  toBlock: bigint;
}

const MARK_SOLD = toFunctionSelector('markSold(uint256)');

type Raw = { topics: Hex[]; data: Hex; blockNumber: string; transactionHash: Hex };

export async function readReviewChain(
  client: PublicClient,
  contract: Address,
  fromBlock: bigint,
  prev: ReviewChainState | null = null,
): Promise<ReviewChainState> {
  const head = await client.getBlockNumber();
  const posted = new Map(prev?.posted ?? []);
  const markedBy = new Map(prev?.markedBy ?? []);
  const start = prev ? prev.toBlock + 1n : fromBlock;
  const logs = start <= head ? ((await getLogsSplit(client, { address: contract, topics: [] }, start, head)) as unknown as Raw[]) : [];
  const soldTxs: Array<{ id: number; hash: Hex }> = [];
  for (const l of logs) {
    try {
      const ev = decodeEventLog({ abi: prismReviewsAbi, topics: l.topics as [Hex, ...Hex[]], data: l.data });
      if (ev.eventName === 'ReviewPosted') {
        posted.set(Number(ev.args.id), { text: ev.args.text, block: Number(BigInt(l.blockNumber)), txHash: l.transactionHash });
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
    if (tx.to?.toLowerCase() === contract.toLowerCase() && tx.input.slice(0, 10).toLowerCase() === MARK_SOLD) markedBy.set(id, tx.from);
  }
  // every review's current state, straight from the contract (statuses change after posting)
  const count = Number(await client.readContract({ address: contract, abi: prismReviewsAbi, functionName: 'reviewCount', blockNumber: head }));
  const stored = new Map<number, StoredReview>();
  for (let a = 1; a <= count; a += 400) {
    const ids = Array.from({ length: Math.min(400, count - a + 1) }, (_, i) => a + i);
    const res = await client.multicall({
      allowFailure: false,
      blockNumber: head,
      contracts: ids.map((id) => ({ address: contract, abi: prismReviewsAbi, functionName: 'getReview', args: [BigInt(id)] }) as const),
    });
    ids.forEach((id, i) => {
      const r = res[i] as { author: Address; rating: number; status: number; postedAt: number; soldAt: number; token: Address; previous: bigint; heldAtPost: bigint };
      stored.set(id, {
        author: r.author,
        rating: Number(r.rating),
        status: Number(r.status),
        postedAt: Number(r.postedAt),
        soldAt: Number(r.soldAt),
        token: r.token,
        previous: Number(r.previous),
        heldAtPost: r.heldAtPost,
      });
    });
  }
  return { toBlock: head, stored, posted, markedBy };
}

/** Live balances of every (author, token) pair with an active review. */
export async function readReviewBalances(client: PublicClient, data: Pick<ReviewChainData, 'stored'>): Promise<Balances> {
  const byAuthor = new Map<Address, Set<Address>>();
  for (const s of data.stored.values()) {
    if (s.status !== 1) continue;
    const set = byAuthor.get(s.author) ?? new Set();
    set.add(s.token);
    byAuthor.set(s.author, set);
  }
  const out = new Map<string, bigint | null>();
  for (const [author, tokens] of byAuthor) {
    const list = [...tokens];
    const m = await balancesOf(client, author, list);
    for (const t of list) out.set(balanceKey(author, t), m.get(t.toLowerCase()) ?? null);
  }
  return out;
}

/** Supply and decimals of every reviewed token. */
export async function readReviewSupplies(client: PublicClient, data: Pick<ReviewChainData, 'stored'>): Promise<Map<string, Supply | null>> {
  const tokens = [...new Set([...data.stored.values()].map((s) => s.token.toLowerCase()))] as Address[];
  return readSupplies(client, tokens);
}
