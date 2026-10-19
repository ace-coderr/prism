/**
 * Builds or updates the launch index (read-only: public RPC, no keys):
 *
 *   npx tsx packages/core/scripts/index-launches.ts [previous.json.gz] out.json.gz
 *
 * Without a previous index (or if it's missing), scans from the first vibe/vibe factory's
 * deployment (a first build reads ~220k launches and takes a while). A version 1 index (built
 * before gen 0 was known) is upgraded by adding gen 0 only, then updated as usual. The output is
 * saved after every step, and a failed step is retried from the last save. Run by
 * .github/workflows/launch-index.yml.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeWhole } from './saveFile';
import { createPublicClient, http, type PublicClient } from 'viem';
import { LAUNCH_INDEX_VERSION, backfillGenerations, decodeIndex, encodeIndex, robinhoodChainTestnet, updateIndex, type LaunchIndex } from '../src';

const [a, b] = process.argv.slice(2);
const prevPath = b ? a : undefined;
const outPath = b ?? a;
if (!outPath) {
  console.error('usage: index-launches.ts [previous.json.gz] out.json.gz');
  process.exit(1);
}

const client = createPublicClient({
  chain: robinhoodChainTestnet,
  // a query the node can't answer in 30 s is split rather than waited on
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { retryCount: 3, retryDelay: 1000, timeout: 30_000 }),
}) as PublicClient;

function load(path: string | undefined): LaunchIndex | null {
  for (const p of [path, outPath]) {
    if (!p || !existsSync(p)) continue;
    const index = decodeIndex(JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')));
    if (index) return index;
    console.warn(`${p} is not a launch index this code understands; ignoring it`);
  }
  return null;
}

const save = (index: LaunchIndex) => writeWhole(outPath, gzipSync(JSON.stringify(encodeIndex(index)), { level: 9 }));
const started = Date.now();
const progress = (i: LaunchIndex, what: string) => {
  const graduated = i.launches.filter((l) => l.graduatedBlock !== null).length;
  console.log(`  ${what} ${i.toBlock}: ${i.launches.length} launches, ${graduated} graduated (${Math.round((Date.now() - started) / 1000)}s)`);
};

/** Runs `job`, retrying from the last saved index after a failure (up to 6 attempts). */
async function withRetries(job: (from: LaunchIndex | null) => Promise<LaunchIndex>, first: LaunchIndex | null): Promise<LaunchIndex> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await job(attempt === 1 ? first : (load(undefined) ?? first));
    } catch (e) {
      console.error(`attempt ${attempt} failed: ${String((e as Error).message ?? e).split('\n')[0]}`);
      if (attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 15_000 * attempt));
    }
  }
}

let index = load(prevPath);
const head = await client.getBlockNumber();

if (index && index.version < LAUNCH_INDEX_VERSION) {
  // version 1 lacks gen 0: add just that over the blocks it covers (minutes, not a full rebuild)
  console.log(`upgrading a version ${index.version} index (${index.launches.length} launches up to ${index.toBlock}): adding gen 0`);
  const old = index;
  index = await withRetries(
    (from) => backfillGenerations(client, from && from.version >= LAUNCH_INDEX_VERSION ? from : old, [0], { onStep: (i) => (save(i), progress(i, 'gen 0 up to block')) }),
    old,
  );
  save(index);
}

console.log(index ? `updating from block ${index.toBlock + 1} (${index.launches.length} launches)` : 'first build', `to ${head}`);
index = await withRetries(
  (from) => updateIndex(client, from, { to: head, onStep: (i) => (save(i), progress(i, 'block')) }),
  index,
);
save(index);
console.log(`done: ${index.launches.length} launches up to block ${index.toBlock} → ${outPath}`);
