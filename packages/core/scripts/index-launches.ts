/**
 * Builds or updates the launch index (read-only: public RPC, no keys):
 *
 *   npx tsx packages/core/scripts/index-launches.ts [previous.json.gz] out.json.gz
 *
 * Without a previous index (or if it's missing), scans from the first vibe/vibe factory's
 * deployment (a first build reads ~200k launches and takes a while). The output is saved after
 * every step, so an interrupted build can resume from it. Run by .github/workflows/launch-index.yml.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createPublicClient, http, type PublicClient } from 'viem';
import { LAUNCH_INDEX_VERSION, decodeIndex, encodeIndex, robinhoodChainTestnet, updateIndex, type LaunchIndex } from '../src';

const [a, b] = process.argv.slice(2);
const prevPath = b ? a : undefined;
const outPath = b ?? a;
if (!outPath) {
  console.error('usage: index-launches.ts [previous.json.gz] out.json.gz');
  process.exit(1);
}

const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { retryCount: 6, retryDelay: 1000, timeout: 120_000 }),
}) as PublicClient;

function load(path: string | undefined): LaunchIndex | null {
  for (const p of [path, outPath]) {
    if (!p || !existsSync(p)) continue;
    const index = decodeIndex(JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')));
    if (index && index.version === LAUNCH_INDEX_VERSION) return index;
    if (index) {
      console.warn(`${p} is an older index (version ${index.version}): rebuilding from scratch`);
      continue;
    }
    console.warn(`${p} is not a launch index this code understands; ignoring it`);
  }
  return null;
}

const save = (index: LaunchIndex) => writeFileSync(outPath, gzipSync(JSON.stringify(encodeIndex(index)), { level: 9 }));

const prev = load(prevPath);
const head = await client.getBlockNumber();
const started = Date.now();
console.log(prev ? `updating from block ${prev.toBlock + 1} (${prev.launches.length} launches)` : 'first build', `to ${head}`);
// a long build survives RPC hiccups: each step is saved, and a failed step is retried from the last save
let current = prev;
let index: LaunchIndex | null = null;
for (let attempt = 1; !index; attempt++) {
  try {
    index = await updateIndex(client, current, {
      to: head,
      onStep: (i) => {
        current = i;
        save(i);
        const graduated = i.launches.filter((l) => l.graduatedBlock !== null).length;
        console.log(`  block ${i.toBlock}: ${i.launches.length} launches, ${graduated} graduated (${Math.round((Date.now() - started) / 1000)}s)`);
      },
    });
  } catch (e) {
    console.error(`attempt ${attempt} failed at block ${current ? current.toBlock + 1 : 'start'}: ${String((e as Error).message ?? e).split('\n')[0]}`);
    if (attempt >= 6) throw e;
    await new Promise((r) => setTimeout(r, 15_000 * attempt));
  }
}
save(index);
console.log(`done: ${index.launches.length} launches up to block ${index.toBlock} → ${outPath}`);
