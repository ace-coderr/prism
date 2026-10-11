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
import { decodeIndex, encodeIndex, robinhoodChainTestnet, updateIndex, type LaunchIndex } from '../src';

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
    if (index) return index;
    console.warn(`${p} is not a launch index this code understands; ignoring it`);
  }
  return null;
}

const save = (index: LaunchIndex) => writeFileSync(outPath, gzipSync(JSON.stringify(encodeIndex(index)), { level: 9 }));

const prev = load(prevPath);
const head = await client.getBlockNumber();
const started = Date.now();
console.log(prev ? `updating from block ${prev.toBlock + 1} (${prev.launches.length} launches)` : 'first build', `to ${head}`);
const index = await updateIndex(client, prev, {
  to: head,
  onStep: (i) => {
    save(i);
    const graduated = i.launches.filter((l) => l.graduatedBlock !== null).length;
    console.log(`  block ${i.toBlock}: ${i.launches.length} launches, ${graduated} graduated (${Math.round((Date.now() - started) / 1000)}s)`);
  },
});
save(index);
console.log(`done: ${index.launches.length} launches up to block ${index.toBlock} → ${outPath}`);
