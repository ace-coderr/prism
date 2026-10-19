/**
 * Launch X-ray on the server: gathers what @prism/core xray.ts needs, from the chain only.
 *
 * One Transfer history per token, read from its launch block and then only for new blocks, kept
 * while this instance is warm and shared with the holder count on /api/market (one scan, not two).
 * Exact timestamps are looked up for the handful of blocks the signals talk about (batched, well
 * inside the RPC's 20-call batch), because block times are too irregular to interpolate: over a
 * 6.5M-block span a straight line was out by six hours.
 *
 * It never blocks a page: an X-ray that isn't ready yet answers `ready: false`, and the token page
 * renders without it and fills in after.
 */
import type { Address } from 'viem';
import {
  POOL_MANAGER,
  blocksNeeded,
  blocksPerDay,
  readLaunchSetup,
  readTransferLog,
  xray,
  type Launch,
  type LaunchSetup,
  type ReviewableAsset,
  type TokenTransfer,
  type Xray,
} from '@prism/core';
import { erc20Abi } from 'viem';
import { client } from './chain';


/** Re-read a token's new blocks at most this often. */
const REFRESH_MS = 3 * 60_000;
/** How long one request waits for a cold read before the page gives up and fills in later. */
const WAIT_MS = 3_000;
/** The most block timestamps to look up for one X-ray. */
const MAX_TIMES = 60;
/** How long one request spends reading a launch's history before saving what it has and stopping. */
const READ_BUDGET_MS = 12_000;
/** Blocks read per step while catching up (one `logsOf` call fans out over this). */
const STEP = 2_000_000n;
/** Tokens kept warm. */
const MAX_TOKENS = 500;

interface History {
  transfers: TokenTransfer[];
  /** read up to and including this block (less than the head while still catching up) */
  toBlock: bigint;
  fromBlock: bigint;
}

const history = new Map<string, History>();
const reading = new Map<string, Promise<History>>();
const times = new Map<number, number>();
const results = new Map<string, { at: number; xray: Xray }>();
const setups = new Map<string, { at: number; setup: LaunchSetup | null }>();

/** Unix times for `blocks`, looked up once each and kept (a block's time never changes). */
async function timesFor(blocks: readonly number[]): Promise<Map<number, number>> {
  const want = [...new Set(blocks)].filter((b) => !times.has(b)).slice(0, MAX_TIMES);
  if (want.length) {
    const got = await Promise.all(
      want.map((b) =>
        client
          .getBlock({ blockNumber: BigInt(b) })
          .then((x) => [b, Number(x.timestamp)] as const)
          .catch(() => null),
      ),
    );
    for (const g of got) if (g) times.set(g[0], g[1]);
    if (times.size > 20_000) for (const k of [...times.keys()].slice(0, 5_000)) times.delete(k);
  }
  return new Map(blocks.flatMap((b) => (times.has(b) ? [[b, times.get(b)!] as [number, number]] : [])));
}

/**
 * The token's transfers from `fromBlock` to `head`, reading only what is new. A launch from millions
 * of blocks back takes longer than one request may last, so each read spends at most READ_BUDGET_MS,
 * keeps what it got, and the next request carries on from there. `toBlock < head` means "still
 * catching up": nothing is stated from a partial history.
 */
function historyOf(token: Address, fromBlock: bigint, head: bigint): Promise<History> {
  const key = token.toLowerCase();
  const have = history.get(key);
  if (have && have.fromBlock <= fromBlock && have.toBlock >= head) return Promise.resolve(have);
  const running = reading.get(key);
  if (running) return running;
  const job = (async () => {
    const usable = have && have.fromBlock <= fromBlock ? have : null;
    let state: History = usable ?? { transfers: [], toBlock: fromBlock - 1n, fromBlock };
    const deadline = Date.now() + READ_BUDGET_MS;
    while (state.toBlock < head) {
      const a = state.toBlock + 1n;
      const b = a + STEP - 1n < head ? a + STEP - 1n : head;
      const fresh = await readTransferLog(client, token, a, b);
      state = { transfers: [...state.transfers, ...fresh], toBlock: b, fromBlock: state.fromBlock };
      history.set(key, state);
      if (Date.now() > deadline) break;
    }
    if (history.size > MAX_TOKENS) history.delete(history.keys().next().value!);
    return state;
  })().finally(() => reading.delete(key));
  reading.set(key, job);
  return job;
}

/** The transfers a warm instance already has for a token (used by the holder count on /api/market). */
export const warmHistory = (token: Address, fromBlock: bigint): History | null => {
  const h = history.get(token.toLowerCase());
  return h && h.fromBlock <= fromBlock ? h : null;
};

let dayBlocks: { at: number; n: bigint } | null = null;
async function blocksInDay(head: bigint): Promise<bigint> {
  if (!dayBlocks || Date.now() - dayBlocks.at > 30 * 60_000) dayBlocks = { at: Date.now(), n: await blocksPerDay(client, head) };
  return dayBlocks.n;
}

async function setupOf(asset: ReviewableAsset, launch: Launch | null): Promise<LaunchSetup | null> {
  if (asset.kind === 'stock') return { kind: 'stock' };
  if (!launch) return null;
  const key = asset.token.toLowerCase();
  const hit = setups.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.setup;
  const setup = await readLaunchSetup(client, launch).catch(() => null);
  setups.set(key, { at: Date.now(), setup });
  if (setups.size > MAX_TOKENS) setups.delete(setups.keys().next().value!);
  return setup;
}

async function read(asset: ReviewableAsset, launch: Launch | null): Promise<Xray> {
  const head = await client.getBlockNumber();
  const base = {
    token: asset.token,
    symbol: asset.symbol,
    creator: launch?.creator ?? null,
    launchBlock: launch?.block ?? 0,
    curve: launch?.curve ?? null,
    poolManager: POOL_MANAGER,
    graduatedBlock: launch?.graduatedBlock ?? null,
    nowBlock: Number(head),
    now: Math.floor(Date.now() / 1000),
  };
  // a test stock has no launch, creator or curve: there is nothing to read its history for
  if (asset.kind === 'stock') {
    return xray({ ...base, transfers: [], complete: true, totalSupply: null, decimals: 18, setup: { kind: 'stock' }, timeOf: new Map(), secondsPerBlock: 1 });
  }
  const launchBlock = BigInt(launch?.block ?? 0);
  const [done, supply, decimals, setup, day] = await Promise.all([
    historyOf(asset.token, launchBlock, head),
    client.readContract({ address: asset.token, abi: erc20Abi, functionName: 'totalSupply' }).catch(() => null),
    client.readContract({ address: asset.token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
    setupOf(asset, launch),
    blocksInDay(head),
  ]);

  // still catching up on an old launch: say nothing from a partial history, and finish it next time
  if (done.toBlock < head) throw new StillReading();
  const rest = {
    ...base,
    transfers: done.transfers,
    complete: true,
    totalSupply: supply as bigint | null,
    decimals: Number(decimals ?? 18),
    setup,
    secondsPerBlock: 86400 / Number(day),
  };
  // look up the exact time of the blocks the signals talk about, then read it again knowing them
  const timeOf = await timesFor(blocksNeeded({ ...rest, timeOf: new Map() }));
  return xray({ ...rest, timeOf });
}

/** Thrown while a launch's history is still being read; the next request carries on. */
class StillReading extends Error {}

export interface XrayAnswer {
  /** false: PRISM is still reading this launch's history; ask again in a moment */
  ready: boolean;
  xray: Xray | null;
}

/**
 * The X-ray for one asset. A fresh one is read in the background; a request waits only WAIT_MS for
 * it, so a cold read of an old launch never holds up the page.
 */
export function xrayOf(asset: ReviewableAsset, launch: Launch | null): Promise<XrayAnswer> {
  const key = asset.token.toLowerCase();
  const hit = results.get(key);
  const fresh = hit && Date.now() - hit.at < REFRESH_MS;
  if (hit && fresh) return Promise.resolve({ ready: true, xray: hit.xray });
  const job = read(asset, launch)
    .then((x) => {
      results.set(key, { at: Date.now(), xray: x });
      if (results.size > MAX_TOKENS) results.delete(results.keys().next().value!);
      return x;
    })
    .catch(() => null); // including StillReading: ask again in a moment
  // an older answer is better than none while a new one is read
  if (hit) {
    void job;
    return Promise.resolve({ ready: true, xray: hit.xray });
  }
  return Promise.race([job.then((x) => ({ ready: x !== null, xray: x })), new Promise<XrayAnswer>((r) => setTimeout(() => r({ ready: false, xray: null }), WAIT_MS))]);
}

// ------------------------------------------------------------------ flags, and creators selling

/**
 * The one-line flags for launches whose X-ray this instance has already worked out. It never starts
 * a read: a list of search results can't pay for twenty launch histories, so flags appear for the
 * launches people have actually opened (and for the newest ones, which the feed below reads anyway).
 */
export function cachedFlags(tokens: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tokens) {
    const flag = results.get(t.toLowerCase())?.xray.flag;
    if (flag) out[t.toLowerCase()] = flag;
  }
  return out;
}

/** How many of the newest launches the "creators selling" feed watches. */
const WATCH_NEWEST = 12;
const FEED_MS = 3 * 60_000;
let feed: { at: number; items: CreatorSold[] } = { at: 0, items: [] };
let feeding: Promise<void> | null = null;

export interface CreatorSold {
  token: Address;
  symbol: string;
  name: string;
  /** what the creator did, in one line */
  text: string;
  /** share of what they bought that they have moved out, 0..1 */
  movedOut: number;
  launchBlock: number;
}

/**
 * The newest launches whose creator has already sold most of what they bought, read from the chain.
 * Only the newest few are watched: their history is short, so this stays cheap, and it is exactly
 * where a creator selling is news. Refreshed in the background; a page never waits for it.
 */
export function creatorsSelling(newest: ReadonlyArray<{ asset: ReviewableAsset; launch: Launch | null }>): CreatorSold[] {
  if (Date.now() - feed.at > FEED_MS && !feeding) {
    feeding = (async () => {
      const items: CreatorSold[] = [];
      const deadline = Date.now() + 20_000;
      for (const { asset, launch } of newest.slice(0, WATCH_NEWEST)) {
        if (Date.now() > deadline) break;
        const answer = await xrayOf(asset, launch).catch(() => null);
        const c = answer?.xray?.creator;
        if (!c || c.acquired === 0n || c.movedOut === 0n) continue;
        const part = Number((c.movedOut * 1000n) / c.acquired) / 1000;
        if (part < 0.5) continue;
        items.push({
          token: asset.token,
          symbol: asset.symbol,
          name: asset.name,
          text: answer!.xray!.signals.find((s) => s.id === 'creator')?.text ?? '',
          movedOut: Math.min(1, part),
          launchBlock: launch?.block ?? 0,
        });
      }
      feed = { at: Date.now(), items };
    })().finally(() => {
      feeding = null;
    });
  }
  return feed.items;
}
