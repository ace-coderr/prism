/**
 * Fills the permanent metadata cache (read-only: public RPC and IPFS gateways, no keys):
 *
 *   npx tsx packages/core/scripts/cache-metadata.ts launches.json.gz [previous-meta.json.gz] out-meta.json.gz [--minutes 12]
 *
 * Carries over every answer already in the previous cache (they never change), then reads the
 * launches it doesn't have yet, newest first, until the time is up: each launch's metadata URI from
 * its launch event (a few eth_getLogs per batch), the file from IPFS, verified against the chain.
 * Final answers (ok / none) are kept; launches IPFS didn't serve in time are tried again next run.
 * Saved after every batch. Run by .github/workflows/launch-index.yml.
 *
 * Gentle on the gateways (they rate-limit bursts): launches take turns starting with a different
 * gateway, the others join only if that one is slow or fails, and when most reads fail the job
 * pauses, then stops for this run if they keep failing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeWhole } from './saveFile';
import { createPublicClient, http, type PublicClient } from 'viem';
import {
  IPFS_GATEWAYS,
  decodeIndex,
  decodeMetaCache,
  emptyMetaCache,
  encodeMetaCache,
  metaRow,
  readLaunchMetadataRefs,
  readLaunchMetadata,
  robinhoodChainTestnet,
  type Launch,
  type MetaCache,
} from '../src';

const args = process.argv.slice(2);
const minutesAt = args.indexOf('--minutes');
const minutes = minutesAt >= 0 ? Number(args[minutesAt + 1]) : 12;
const files = args.filter((a, i) => !a.startsWith('--') && (minutesAt < 0 || i !== minutesAt + 1));
const [indexPath, prevPath, outPath] = files.length >= 3 ? files : [files[0], undefined, files[1]];
if (!indexPath || !outPath) {
  console.error('usage: cache-metadata.ts launches.json.gz [previous-meta.json.gz] out-meta.json.gz [--minutes 12]');
  process.exit(1);
}
const deadline = Date.now() + minutes * 60_000;
/** launches per batch (one span of eth_getLogs), IPFS reads at once, and when the next gateway joins */
const BATCH = 240;
const PARALLEL = 4;
const STAGGER_MS = 4000;
/** after this many reads in a row that no gateway served: pause; after MAX_PAUSES pauses with nothing served, stop */
const FAILS_BEFORE_PAUSE = 12;
const PAUSE_MS = 90_000;
const MAX_PAUSES = 3;

const gunzipJson = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
const index = decodeIndex(gunzipJson(indexPath));
if (!index) throw new Error(`${indexPath} is not a launch index`);

let cache: MetaCache = emptyMetaCache(index.chainId);
for (const p of [prevPath, outPath]) {
  if (!p || !existsSync(p)) continue;
  const c = decodeMetaCache(gunzipJson(p));
  if (c && c.chainId === index.chainId && c.rows.size >= cache.rows.size) cache = c;
}
/** Saved at least this often, so a run stopped mid-batch keeps all but a few seconds of work. */
const SAVE_EVERY_MS = 10_000;
let lastSave = 0; // 0: the first result is saved straight away, so a file exists from the start
const save = () => {
  cache.updatedAt = Math.floor(Date.now() / 1000);
  writeWhole(outPath, gzipSync(JSON.stringify(encodeMetaCache(cache)), { level: 9 }));
  lastSave = Date.now();
};

const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { retryCount: 3, retryDelay: 1000, timeout: 30_000 }),
}) as PublicClient;

// newest first: what people are looking at now
const pending: Launch[] = index.launches.filter((l) => !cache.rows.has(l.token.toLowerCase())).reverse();
console.log(`${cache.rows.size} launches cached, ${pending.length} to go; reading for up to ${minutes} min`);

const counts = { ok: 0, none: 0, later: 0 };
const started = Date.now();
let turn = 0;
let failsInRow = 0;
let pauses = 0;
let pausing: Promise<void> | null = null;
const gatewaysFor = (n: number) => IPFS_GATEWAYS.map((_, i) => IPFS_GATEWAYS[(n + i) % IPFS_GATEWAYS.length]!);
const refused = () => pauses >= MAX_PAUSES;

for (let i = 0; i < pending.length && Date.now() < deadline && !refused(); i += BATCH) {
  const batch = pending.slice(i, i + BATCH);
  let refs;
  try {
    refs = await readLaunchMetadataRefs(client, batch);
  } catch (e) {
    console.warn(`  couldn't read launch events for blocks ${batch.at(-1)!.block}–${batch[0]!.block}: ${String((e as Error).message).split('\n')[0]}`);
    counts.later += batch.length;
    continue;
  }
  const queue = [...batch];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let l = queue.shift(); l && Date.now() < deadline && !refused(); l = queue.shift()) {
        if (pausing) await pausing;
        const key = l.token.toLowerCase();
        if (!refs.has(key)) {
          counts.later++;
          continue;
        }
        const read = await readLaunchMetadata(refs.get(key)!, { timeoutMs: 20_000, gateways: gatewaysFor(turn++), staggerMs: STAGGER_MS });
        if (Date.now() - lastSave > SAVE_EVERY_MS) save();
        const row = metaRow(key, read);
        if (row) {
          cache.rows.set(key, row);
          counts[row[2] === 'ok' ? 'ok' : 'none']++;
          if (row[2] === 'ok') (failsInRow = 0), (pauses = 0);
        } else {
          counts.later++;
          if (++failsInRow >= FAILS_BEFORE_PAUSE && !pausing) {
            pauses++;
            failsInRow = 0;
            console.warn(`  the gateways aren't serving files (rate-limited?): pausing ${PAUSE_MS / 1000}s (${pauses}/${MAX_PAUSES})`);
            pausing = new Promise<void>((r) => setTimeout(r, PAUSE_MS)).then(() => void (pausing = null));
            await pausing;
          }
        }
      }
    }),
  );
  save();
  console.log(`  ${Math.min(i + BATCH, pending.length)}/${pending.length}: ${counts.ok} ok, ${counts.none} none, ${counts.later} for a later run (${Math.round((Date.now() - started) / 1000)}s)`);
}
if (refused()) console.warn('stopped early: the gateways kept refusing; the next run carries on');
save();
console.log(`done: ${cache.rows.size} of ${index.launches.length} launches cached → ${outPath}`);
