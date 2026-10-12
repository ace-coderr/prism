/**
 * Pre-warms the site's token picture cache so visitors rarely wait for IPFS (read-only: public RPC
 * and plain GETs to the site, no keys):
 *
 *   npx tsx packages/core/scripts/warm-pictures.ts launches.json.gz [https://seeprism.vercel.app] [--minutes 20]
 *
 * Which tokens: the newest 500 launches, the 300 most traded on their curve in the last 24h (counted
 * from the curves' own trade events), the 200 most recently graduated, every token with PRISM
 * reviews, and the test stocks. Sizes in the order pages use them (96 lists, 192 launch headers and
 * share images, 48 review cards). Already-cached pictures answer in a fraction of a second, so later
 * runs mostly warm what's new. Run by .github/workflows/launch-index.yml after each index build.
 *
 * The CDN keeps a copy per region; this warms the region the job runs from, and the image function
 * itself (its metadata and picture fetches are cached too).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createPublicClient, http, toEventSelector, type PublicClient } from 'viem';
import { EVENTS, REVIEWABLE_STOCK_IDS, blocksPerDay, decodeIndex, getLogsSplit, robinhoodChainTestnet, tokenById } from '../src';

const args = process.argv.slice(2);
const minutesAt = args.indexOf('--minutes');
const minutes = minutesAt >= 0 ? Number(args[minutesAt + 1]) : 20;
const [indexPath, site = 'https://seeprism.vercel.app'] = args.filter((a, i) => !a.startsWith('--') && (minutesAt < 0 || i !== minutesAt + 1));
if (!indexPath) {
  console.error('usage: warm-pictures.ts launches.json.gz [site] [--minutes 20]');
  process.exit(1);
}
const deadline = Date.now() + minutes * 60_000;

const index = decodeIndex(JSON.parse(gunzipSync(readFileSync(indexPath)).toString('utf8')));
if (!index) throw new Error(`${indexPath} is not a launch index`);
const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { retryCount: 3, retryDelay: 1000, timeout: 30_000 }),
}) as PublicClient;

const picks = new Map<string, string>(); // lower-case token → why
const add = (token: string, why: string) => picks.has(token.toLowerCase()) || picks.set(token.toLowerCase(), why);

// the newest launches
for (const l of index.launches.slice(-500).reverse()) add(l.token, 'newest');

// the most traded on their curves in the last 24h (any address: matched to known curves)
try {
  const head = await client.getBlockNumber();
  const day = await blocksPerDay(client, head);
  const topics = [EVENTS.v6Buy, EVENTS.v6Sell, EVENTS.bought, EVENTS.sold].map((e) => toEventSelector(e));
  const logs = await getLogsSplit(client, { topics: [topics] }, head - day, head);
  const byCurve = new Map(index.launches.map((l) => [l.curve.toLowerCase(), l.token]));
  const trades = new Map<string, number>();
  for (const log of logs) {
    const token = byCurve.get(log.address.toLowerCase());
    if (token) trades.set(token, (trades.get(token) ?? 0) + 1);
  }
  [...trades].sort((a, b) => b[1] - a[1]).slice(0, 300).forEach(([t]) => add(t, 'traded'));
  console.log(`${logs.length} curve trades in the last 24h across ${trades.size} launches`);
} catch (e) {
  console.warn(`couldn't rank by trades: ${String((e as Error).message).split('\n')[0]}`);
}

// the most recently graduated
index.launches
  .filter((l) => l.graduatedBlock !== null)
  .sort((a, b) => b.graduatedBlock! - a.graduatedBlock!)
  .slice(0, 200)
  .forEach((l) => add(l.token, 'graduated'));

// tokens with reviews, and the test stocks
try {
  const [boards, feed] = await Promise.all([
    fetch(`${site}/api/leaderboards`).then((r) => (r.ok ? r.json() : null)),
    fetch(`${site}/api/feed`).then((r) => (r.ok ? r.json() : null)),
  ]);
  for (const l of (boards?.launches ?? []) as Array<{ token: string }>) add(l.token, 'reviewed');
  for (const r of [...(feed?.latest ?? []), ...(feed?.caught ?? [])] as Array<{ token: string }>) add(r.token, 'reviewed');
} catch {
  console.warn('couldn’t read the reviewed tokens');
}
for (const id of REVIEWABLE_STOCK_IDS) add(tokenById(id)!.address, 'stock');

const tokens = [...picks.keys()];
console.log(`warming ${tokens.length} tokens (${[...new Set(picks.values())].map((w) => `${[...picks.values()].filter((v) => v === w).length} ${w}`).join(', ')}) on ${site}, for at most ${minutes} min`);

type Outcome = 'cached' | 'warmed' | 'identicon' | 'retry' | 'failed';
/** One picture through the site; 'retry' = an identicon served only for now (IPFS or metadata too slow). */
async function warm(token: string, size: number): Promise<Outcome> {
  try {
    const res = await fetch(`${site}/img/t/${token}.png?s=${size}`, { signal: AbortSignal.timeout(70_000) });
    await res.arrayBuffer();
    if (!res.ok) return 'failed';
    if (res.headers.get('x-prism-image') === 'identicon') return /max-age=60/.test(res.headers.get('cache-control') ?? '') ? 'retry' : 'identicon';
    return /HIT|STALE/i.test(res.headers.get('x-vercel-cache') ?? '') ? 'cached' : 'warmed';
  } catch {
    return 'failed';
  }
}

for (const size of [96, 192, 48]) {
  const stats: Record<Outcome, number> = { cached: 0, warmed: 0, identicon: 0, retry: 0, failed: 0 };
  let queue = tokens;
  // a second round for pictures that were only served as a stand-in the first time
  for (let round = 0; round < 2 && queue.length && Date.now() < deadline; round++) {
    const again: string[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < queue.length && Date.now() < deadline) {
          const token = queue[next++]!;
          const o = await warm(token, size);
          if (o === 'retry' && round === 0) again.push(token);
          else stats[o]++;
        }
      }),
    );
    queue = again;
  }
  console.log(`size ${size}: ${JSON.stringify(stats)}`);
  if (Date.now() >= deadline) {
    console.log('time budget reached; the next run carries on');
    break;
  }
}
