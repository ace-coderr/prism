/**
 * Keeps the Launch X-ray ready, read-only (public RPC and plain GETs to the site, no keys):
 *
 *   npx tsx packages/core/scripts/warm-xray.ts launches.json.gz [previous-xray.json.gz] out-xray.json.gz \
 *     [https://seeprism.xyz] [--minutes 12]
 *
 * Two jobs, both bounded by the clock so they fit inside the scheduled workflow:
 *
 * 1. The creator watch. For every launch of the last WATCH_DAYS days (and every launch already
 *    watched, so one stays watched once it is), read the transfers into and out of the creator's
 *    own address: two filtered queries covering the launch's whole life, about half a second each,
 *    rather than its full history. The result is published next to the launch index, and the site
 *    builds the "creators selling" feed and the one-line flags from it without reading anything.
 * 2. Warming. Ask the site for the X-ray of the newest launches and of the ones people have opened
 *    recently, so a visitor doesn't pay for the first cold read of a launch from millions of blocks
 *    back. Exactly what warm-pictures.ts does for token pictures.
 *
 * Newest first, and whatever it doesn't reach this run it reaches on the next one.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createPublicClient, http, parseAbiItem, type Address, type PublicClient } from 'viem';
import {
  blockRanges,
  creatorMoves,
  decodeIndex,
  decodeXrayCache,
  emptyXrayCache,
  encodeXrayCache,
  robinhoodChainTestnet,
  soldMost,
  type Launch,
  type XrayCache,
  type XrayTransfer,
} from '../src';

const args = process.argv.slice(2);
const minutesAt = args.indexOf('--minutes');
const minutes = minutesAt >= 0 ? Number(args[minutesAt + 1]) : 12;
const rest = args.filter((a, i) => !a.startsWith('--') && (minutesAt < 0 || i !== minutesAt + 1));
const site = rest.find((a) => a.startsWith('http')) ?? 'https://seeprism.xyz';
const files = rest.filter((a) => !a.startsWith('http'));
const [indexPath, prevPath, outPath] = files.length >= 3 ? files : [files[0], undefined, files[1]];
if (!indexPath || !outPath) {
  console.error('usage: warm-xray.ts launches.json.gz [previous-xray.json.gz] out-xray.json.gz [site] [--minutes 12]');
  process.exit(1);
}

/** Launches this new are watched for their creator selling. */
const WATCH_DAYS = 7;
/** Re-check a watched launch at most this often (its creator may sell at any time). */
const RECHECK_MS = 25 * 60_000;
/** Creator checks at once, and how long to wait after the public RPC starts refusing. */
const PARALLEL = 6;
const RETRIES = 2;
const BACKOFF_MS = 1500;
/** The widest block range one filtered query covers (the RPC allows 10M). */
const WINDOW = 9_000_000n;
/** How much of the time goes to the creator watch; the rest warms the site. */
const WATCH_SHARE = 0.75;
/** The newest launches to warm on the site, and the most recently opened ones. */
const WARM_NEWEST = 25;
const WARM_OPENED = 40;

const deadline = Date.now() + minutes * 60_000;
const watchDeadline = Date.now() + minutes * 60_000 * WATCH_SHARE;
const gunzipJson = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));

const index = decodeIndex(gunzipJson(indexPath));
if (!index) throw new Error(`${indexPath} is not a launch index`);

let cache: XrayCache = emptyXrayCache(index.chainId);
for (const p of [prevPath, outPath]) {
  if (!p || !existsSync(p)) continue;
  const c = decodeXrayCache(gunzipJson(p));
  if (c && c.chainId === index.chainId && c.byToken.size >= cache.byToken.size) cache = c;
}
const save = () => {
  cache.updatedAt = Math.floor(Date.now() / 1000);
  writeFileSync(outPath, gzipSync(JSON.stringify(encodeXrayCache(cache)), { level: 9 }));
};

const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { batch: { batchSize: 20 }, retryCount: 2, retryDelay: 1000, timeout: 60_000 }),
}) as PublicClient;

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const head = await client.getBlockNumber();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The public RPC refuses bursts: wait and try again rather than giving up on the launch. */
async function withRetries<T>(job: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await job();
    } catch (e) {
      if (attempt >= RETRIES) throw e;
      await sleep(BACKOFF_MS * (attempt + 1));
    }
  }
}

/** Every transfer into or out of `creator` for `token`, from `fromBlock` to the head. */
async function creatorTransfers(token: Address, creator: Address, fromBlock: bigint): Promise<XrayTransfer[]> {
  const out: XrayTransfer[] = [];
  for (const [a, b] of blockRanges(fromBlock, head, WINDOW)) {
    const [sent, got] = await withRetries(() =>
      Promise.all([
        client.getLogs({ address: token, event: TRANSFER, args: { from: creator }, fromBlock: a, toBlock: b, strict: true }),
        client.getLogs({ address: token, event: TRANSFER, args: { to: creator }, fromBlock: a, toBlock: b, strict: true }),
      ]),
    );
    for (const l of [...sent, ...got]) {
      const x = l as unknown as { args: { from: string; to: string; value: bigint }; blockNumber: bigint; logIndex: number };
      out.push({ from: x.args.from, to: x.args.to, value: x.args.value, block: Number(x.blockNumber), logIndex: x.logIndex });
    }
  }
  // one log can appear in both queries (a transfer to oneself)
  const seen = new Set<string>();
  return out
    .filter((t) => {
      const k = `${t.block}:${t.logIndex}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
}

// ------------------------------------------------------------------ 1. the creator watch

const perDay = 86_400 / 0.12; // the chain makes a block about every 0.12 s
const watchFrom = Number(head) - Math.round(perDay * WATCH_DAYS);
const now = Date.now();
const recent = index.launches.filter((l) => l.block >= watchFrom);
const alreadyWatched = index.launches.filter((l) => l.block < watchFrom && cache.byToken.has(l.token.toLowerCase()));
// newest first, and nothing re-checked too soon
const queue: Launch[] = [...recent, ...alreadyWatched]
  .sort((a, b) => b.block - a.block)
  .filter((l) => {
    const had = cache.byToken.get(l.token.toLowerCase());
    return !had || now - had.checkedAt * 1000 > RECHECK_MS;
  });

console.log(`creator watch: ${recent.length.toLocaleString()} launches in the last ${WATCH_DAYS} days, ${cache.byToken.size.toLocaleString()} already watched, ${queue.length.toLocaleString()} to check`);
let checked = 0;
let selling = 0;
let failed = 0;
const started = Date.now();
const pending = [...queue];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let l = pending.shift(); l && Date.now() < watchDeadline; l = pending.shift()) {
      try {
        const moves = creatorMoves(await creatorTransfers(l.token, l.creator, BigInt(l.block)), l.creator);
        cache.byToken.set(l.token.toLowerCase(), { token: l.token, creator: l.creator, moves, checkedToBlock: Number(head), checkedAt: Math.floor(Date.now() / 1000) });
        checked++;
        if (soldMost(moves)) selling++;
        if (checked % 250 === 0) {
          save();
          console.log(`  ${checked.toLocaleString()} checked, ${selling} selling (${Math.round((Date.now() - started) / 1000)}s)`);
        }
      } catch (e) {
        failed++;
        if (failed <= 3) console.warn(`  ${l.symbol}: ${(String((e as Error).message ?? e).split('\n')[0] ?? '').slice(0, 120)}`);
      }
    }
  }),
);
save();
console.log(`creator watch done: ${checked.toLocaleString()} checked, ${selling} with a creator who sold most of their bag, ${failed} failed, ${cache.byToken.size.toLocaleString()} watched in all`);

// ------------------------------------------------------------------ 2. warming the site

const warm = async (token: string): Promise<string> => {
  for (let i = 0; i < 12 && Date.now() < deadline; i++) {
    try {
      const r = (await (await fetch(`${site}/api/xray?token=${token}`, { signal: AbortSignal.timeout(40_000) })).json()) as { ready?: boolean; error?: string };
      if (r.error) return 'error';
      if (r.ready) return 'ready';
    } catch {
      return 'failed';
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 'still reading';
};

const opened = await fetch(`${site}/api/xray?recent=1`, { signal: AbortSignal.timeout(30_000) })
  .then((r) => r.json() as Promise<{ tokens?: string[] }>)
  .then((r) => r.tokens ?? [])
  .catch(() => []);
const toWarm = [...new Set([...index.launches.slice(-WARM_NEWEST).reverse().map((l) => l.token), ...opened.slice(0, WARM_OPENED)])];
console.log(`warming ${toWarm.length} launches on the site (${opened.length} of them opened recently)`);
const counts: Record<string, number> = {};
for (const token of toWarm) {
  if (Date.now() > deadline) break;
  const r = await warm(token);
  counts[r] = (counts[r] ?? 0) + 1;
}
console.log('warmed:', Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing');
