/**
 * Reads vibe/vibe launches from the chain (read-only: eth_getLogs, eth_call): launch and
 * graduation events, token names and symbols, and live balances for holder checks.
 */
import { erc20Abi, type Address, type Hex, type PublicClient } from 'viem';
import {
  FIRST_LAUNCH_BLOCK,
  LAUNCH_TOPICS,
  TOPICS,
  V6_FROM_BLOCK,
  VIBE_FACTORIES,
  applyScan,
  decodeGraduationLog,
  decodeLaunchLog,
  emptyIndex,
  quotesNeedingSymbols,
  tokensNeedingNames,
  type Graduation,
  type LaunchIndex,
  type RawLog,
  type ScanResult,
} from './launches';
import { blockRanges } from './onchain';

/** The public RPC answers eth_getLogs for at most 100k blocks and ~10 MB per response. */
export const LOG_BLOCKS = 100_000n;

const TOO_BIG = /too large|exceed|limit|too many|range|10000|response size|timed out|timeout/i;

type GetLogsArgs = { address?: Address | Address[]; topics: (Hex | Hex[] | null)[] };

/** eth_getLogs over [from, to], halving the range whenever the node says the answer is too big. */
export async function getLogsSplit(client: PublicClient, args: GetLogsArgs, from: bigint, to: bigint): Promise<RawLog[]> {
  const out: RawLog[] = [];
  for (const [a, b] of blockRanges(from, to, LOG_BLOCKS)) out.push(...(await getRange(client, args, a, b)));
  return out;
}

async function getRange(client: PublicClient, args: GetLogsArgs, a: bigint, b: bigint): Promise<RawLog[]> {
  try {
    return (await client.request(
      {
        method: 'eth_getLogs',
        params: [{ address: args.address, topics: args.topics, fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}` }],
      },
      // one retry, then split: retrying a range the node can't answer in time only wastes minutes
      { retryCount: 1 },
    )) as unknown as RawLog[];
  } catch (e) {
    if (b <= a || !TOO_BIG.test(errorText(e))) throw e;
    const m = (a + b) / 2n;
    return [...(await getRange(client, args, a, m)), ...(await getRange(client, args, m + 1n, b))];
  }
}

const errorText = (e: unknown) => {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && i < 8; x = (x as { cause?: unknown }).cause, i++) {
    parts.push(String((x as { message?: unknown }).message ?? ''), String((x as { details?: unknown }).details ?? ''));
  }
  return parts.join(' ');
};

/** Raw JSON-RPC logs carry hex numbers: viem-style bigint / number fields. */
const normalize = (l: RawLog): RawLog => ({
  ...l,
  blockNumber: l.blockNumber === null ? null : BigInt(l.blockNumber as unknown as string),
  logIndex: l.logIndex === null ? null : Number(l.logIndex as unknown as string),
});

/** Every launch and graduation event in [from, to]. */
export async function scanLaunches(client: PublicClient, from: bigint, to: bigint): Promise<ScanResult> {
  const start = from < FIRST_LAUNCH_BLOCK ? FIRST_LAUNCH_BLOCK : from;
  const empty = { fromBlock: Number(from), toBlock: Number(to), launches: [], graduations: [] };
  if (to < start) return empty;
  const factories = VIBE_FACTORIES.map((f) => f.factory);
  const adapters = VIBE_FACTORIES.flatMap((f) => (f.adapter ? [f.adapter] : []));
  const v6Start = start < V6_FROM_BLOCK ? V6_FROM_BLOCK : start;
  const [launchLogs, adapterLogs, curveLogs] = await Promise.all([
    getLogsSplit(client, { address: factories, topics: [[...LAUNCH_TOPICS]] }, start, to),
    getLogsSplit(client, { address: adapters, topics: [TOPICS.poolGraduated] }, start, to),
    // any contract may emit this topic: graduations are matched to known v6 curves later
    to >= v6Start ? getLogsSplit(client, { topics: [TOPICS.curveGraduated] }, v6Start, to) : Promise.resolve([]),
  ]);
  return {
    fromBlock: Number(from),
    toBlock: Number(to),
    launches: launchLogs.map(normalize).flatMap((l) => decodeLaunchLog(l) ?? []),
    graduations: [...adapterLogs, ...curveLogs].map(normalize).flatMap((l): Graduation[] => {
      const g = decodeGraduationLog(l);
      return g ? [g] : [];
    }),
  };
}

/** name() and symbol() of many tokens (Multicall3, a few hundred per call); failures read as ''. */
export async function readTokenNames(client: PublicClient, tokens: readonly Address[], batch = 300): Promise<Map<string, { name: string; symbol: string }>> {
  const out = new Map<string, { name: string; symbol: string }>();
  for (let i = 0; i < tokens.length; i += batch) {
    const slice = tokens.slice(i, i + batch);
    const res = await client.multicall({
      contracts: slice.flatMap((address) => [
        { address, abi: erc20Abi, functionName: 'name' } as const,
        { address, abi: erc20Abi, functionName: 'symbol' } as const,
      ]),
      allowFailure: true,
    });
    slice.forEach((t, j) => {
      const s = (r: (typeof res)[number] | undefined) => (r?.status === 'success' && typeof r.result === 'string' ? r.result : '');
      out.set(t.toLowerCase(), { name: s(res[j * 2]), symbol: s(res[j * 2 + 1]) });
    });
  }
  return out;
}

/**
 * Bring an index up to `to` (default: the chain head): scan the new blocks, read the names the
 * events don't carry, then the symbols of any new quote assets. `step` blocks at a time, calling
 * `onStep` after each so a long first build can be saved as it goes.
 */
export async function updateIndex(
  client: PublicClient,
  prev: LaunchIndex | null,
  opts: { to?: bigint; step?: bigint; onStep?: (index: LaunchIndex) => void | Promise<void> } = {},
): Promise<LaunchIndex> {
  const to = opts.to ?? (await client.getBlockNumber());
  let index = prev ?? emptyIndex(client.chain?.id ?? 46630, Number(FIRST_LAUNCH_BLOCK) - 1);
  const step = opts.step ?? 2_000_000n;
  for (let a = BigInt(index.toBlock) + 1n; a <= to; a += step) {
    const b = a + step - 1n > to ? to : a + step - 1n;
    const scan = await scanLaunches(client, a, b);
    const names = await readTokenNames(client, tokensNeedingNames(scan, index));
    index = applyScan(index, scan, names);
    const quotes = quotesNeedingSymbols(index);
    if (quotes.length > 0) {
      const read = await readTokenNames(client, quotes);
      index = applyScan(index, { ...scan, launches: [], graduations: [] }, new Map(), Object.fromEntries([...read].map(([k, v]) => [k, v.symbol || v.name || `${k.slice(0, 6)}…`])));
    }
    await opts.onStep?.(index);
  }
  return index;
}

// ------------------------------------------------------------------ holder checks

/** `owner`'s balance of `token`, live (never cached). */
export const balanceOf = (client: PublicClient, token: Address, owner: Address) =>
  client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });

/** `owner`'s live balances of many tokens in one Multicall3 call (null where a read failed). */
export async function balancesOf(client: PublicClient, owner: Address, tokens: readonly Address[]): Promise<Map<string, bigint | null>> {
  const res = await client.multicall({
    contracts: tokens.map((address) => ({ address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }) as const),
    allowFailure: true,
  });
  return new Map(tokens.map((t, i) => [t.toLowerCase(), res[i]?.status === 'success' ? (res[i]!.result as bigint) : null]));
}

/** Does `owner` hold any of `token` right now? */
export const holds = async (client: PublicClient, token: Address, owner: Address) => (await balanceOf(client, token, owner)) > 0n;
