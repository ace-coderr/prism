/**
 * Reads vibe/vibe launches from the chain (read-only: eth_getLogs, eth_call): launch and
 * graduation events, token names and symbols, and live balances for holder checks.
 */
import { erc20Abi, type Address, type Hex, type PublicClient } from 'viem';
import {
  FIRST_LAUNCH_BLOCK,
  LAUNCH_INDEX_VERSION,
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
  type LaunchGen,
  type LaunchIndex,
  type RawLog,
  type ScanResult,
} from './launches';
import { blockRanges } from './onchain';

/** The public RPC answers eth_getLogs for at most 100k blocks and ~10 MB per response. */
export const LOG_BLOCKS = 100_000n;
/** …and at most 30k blocks for a query without an address filter. */
export const LOG_BLOCKS_NO_ADDRESS = 25_000n;

const TOO_BIG = /too large|exceed|limit|too many|range|10000|response size|timed out|timeout/i;
/** Errors a smaller range won't fix. */
const NOT_RANGE = /execution reverted|method not found|invalid argument|unauthorized|forbidden/i;

type GetLogsArgs = { address?: Address | Address[]; topics: (Hex | Hex[] | null)[] };

/** eth_getLogs over [from, to], halving the range whenever the node says the answer is too big. */
export async function getLogsSplit(client: PublicClient, args: GetLogsArgs, from: bigint, to: bigint): Promise<RawLog[]> {
  const out: RawLog[] = [];
  const size = args.address ? LOG_BLOCKS : LOG_BLOCKS_NO_ADDRESS;
  for (const [a, b] of blockRanges(from, to, size)) out.push(...(await getRange(client, args, a, b)));
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
    if (b <= a || NOT_RANGE.test(errorText(e))) throw e;
    // too big or too slow: split at once; anything else (a hiccup, a rate limit): wait a moment, then split
    if (!TOO_BIG.test(errorText(e))) await sleep(1500);
    const m = (a + b) / 2n;
    return [...(await getRange(client, args, a, m)), ...(await getRange(client, args, m + 1n, b))];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Every launch and graduation event in [from, to] (of every factory generation, or only ). */
export async function scanLaunches(client: PublicClient, from: bigint, to: bigint, gens?: readonly LaunchGen[]): Promise<ScanResult> {
  const included = VIBE_FACTORIES.filter((f) => !gens || gens.includes(f.gen));
  const first = included.reduce((m, f) => (f.fromBlock < m ? f.fromBlock : m), included[0]?.fromBlock ?? FIRST_LAUNCH_BLOCK);
  const start = from < first ? first : from;
  const empty = { fromBlock: Number(from), toBlock: Number(to), launches: [], graduations: [] };
  if (to < start || included.length === 0) return empty;
  const factories = included.map((f) => f.factory);
  const adapters = included.flatMap((f) => (f.adapter ? [f.adapter] : []));
  const v6Start = start < V6_FROM_BLOCK ? V6_FROM_BLOCK : start;
  const withV6 = included.some((f) => f.gen === 6);
  const [launchLogs, adapterLogs, curveLogs] = await Promise.all([
    getLogsSplit(client, { address: factories, topics: [[...LAUNCH_TOPICS]] }, start, to),
    adapters.length ? getLogsSplit(client, { address: adapters, topics: [TOPICS.poolGraduated] }, start, to) : Promise.resolve([]),
    // any contract may emit this topic: graduations are matched to known v6 curves later
    withV6 && to >= v6Start ? getLogsSplit(client, { topics: [TOPICS.curveGraduated] }, v6Start, to) : Promise.resolve([]),
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
  for (let i = 0; i < tokens.length; i += batch) await readNameBatch(client, tokens.slice(i, i + batch), out);
  return out;
}

/** One multicall; if the whole call fails (too much gas, a hiccup), halve it, down to one token (then ''). */
async function readNameBatch(client: PublicClient, slice: readonly Address[], out: Map<string, { name: string; symbol: string }>): Promise<void> {
  try {
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
  } catch {
    if (slice.length === 1) {
      out.set(slice[0]!.toLowerCase(), { name: '', symbol: '' });
      return;
    }
    await sleep(1000);
    const half = Math.ceil(slice.length / 2);
    await readNameBatch(client, slice.slice(0, half), out);
    await readNameBatch(client, slice.slice(half), out);
  }
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
  const start = prev ?? emptyIndex(client.chain?.id ?? 46630, Number(FIRST_LAUNCH_BLOCK) - 1);
  return scanInto(client, start, BigInt(start.toBlock) + 1n, to, undefined, opts);
}

/**
 * Add generations an index was built without (`gens`, e.g. [0] for a version 1 index), over the
 * blocks it already covers; the result is a current-version index. Much cheaper than a rebuild.
 */
export async function backfillGenerations(
  client: PublicClient,
  index: LaunchIndex,
  gens: readonly LaunchGen[],
  opts: { step?: bigint; onStep?: (index: LaunchIndex) => void | Promise<void> } = {},
): Promise<LaunchIndex> {
  const from = VIBE_FACTORIES.filter((f) => gens.includes(f.gen)).reduce((m, f) => (f.fromBlock < m ? f.fromBlock : m), BigInt(index.toBlock));
  const out = await scanInto(client, index, from, BigInt(index.toBlock), gens, {
    step: opts.step ?? 4_000_000n,
    // a step saved midway keeps the old version, so an interrupted backfill starts over next time
    onStep: (i) => opts.onStep?.({ ...i, version: index.version }),
  });
  return { ...out, version: LAUNCH_INDEX_VERSION };
}

async function scanInto(
  client: PublicClient,
  start: LaunchIndex,
  from: bigint,
  to: bigint,
  gens: readonly LaunchGen[] | undefined,
  opts: { step?: bigint; onStep?: (index: LaunchIndex) => void | Promise<void> },
): Promise<LaunchIndex> {
  let index = start;
  const step = opts.step ?? 2_000_000n;
  for (let a = from; a <= to; a += step) {
    const b = a + step - 1n > to ? to : a + step - 1n;
    const scan = await scanLaunches(client, a, b, gens);
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
