/**
 * Every reviewable asset (the five test stocks + every vibe/vibe launch), read from the chain only.
 *
 * The bulk of the index is built on a schedule by .github/workflows/launch-index.yml and published
 * as a release asset (LAUNCH_INDEX_URL); this module loads it, then reads the blocks since
 * (eth_getLogs, a few calls) so new launches and graduations show within a minute.
 * LAUNCH_INDEX_FILE (a local .json.gz) replaces the download for local testing.
 */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { Address } from 'viem';
import { LAUNCH_INDEX_URL, allAssets, decodeIndex, updateIndex, type Launch, type LaunchIndex, type ReviewableAsset } from '@prism/core';
import { client } from './chain';

/** Re-download the published index this often (it changes every ~30 minutes). */
const BASE_MS = 10 * 60_000;
/** Re-read the newest blocks this often. */
const TAIL_MS = 30_000;
/** Don't read more than this many blocks on top of the published index (~12 hours). */
const MAX_TAIL_BLOCKS = 300_000n;

export interface LiveIndex {
  index: LaunchIndex;
  stale: boolean;
  at: number;
  /** stocks first, then launches newest first */
  assets: ReviewableAsset[];
  assetByToken: Map<string, ReviewableAsset>;
  launchByToken: Map<string, Launch>;
}

let base: { index: LaunchIndex; at: number } | null = null;
let live: LiveIndex | null = null;
let loading: Promise<LiveIndex> | null = null;

async function loadBase(): Promise<LaunchIndex> {
  if (base && Date.now() - base.at < BASE_MS) return base.index;
  try {
    const file = process.env.LAUNCH_INDEX_FILE;
    const gz = file ? await readFile(file) : Buffer.from(await (await fetchOk(LAUNCH_INDEX_URL)).arrayBuffer());
    const index = decodeIndex(JSON.parse(gunzipSync(gz).toString('utf8')));
    if (!index) throw new Error('The published launch index is in a format this code doesn’t read (it is rebuilt on the next scheduled run).');
    base = { index, at: Date.now() };
    return index;
  } catch (e) {
    if (base) return base.index; // keep serving the last good copy
    throw e;
  }
}

async function fetchOk(url: string) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(res.status === 404 ? 'The launch index hasn’t been published yet.' : `Index download failed (${res.status}).`);
  return res;
}

/** The index brought up to the chain head (cached for TAIL_MS). */
export async function currentIndex(): Promise<LiveIndex> {
  if (live && Date.now() - live.at < TAIL_MS) return live;
  loading ??= (async () => {
    const published = await loadBase();
    // carry on from the last live copy unless a newer index has been published since
    const from = live && live.index.toBlock >= published.toBlock ? live.index : published;
    const head = await client.getBlockNumber();
    let index = from;
    let stale = false;
    if (head - BigInt(published.toBlock) > MAX_TAIL_BLOCKS) stale = true;
    else if (head > BigInt(from.toBlock)) {
      index = await updateIndex(client, from, { to: head }).catch(() => {
        stale = true;
        return from;
      });
    }
    const reuse = live?.index === index ? live : null;
    const assets = reuse ? reuse.assets : allAssets(index);
    const next: LiveIndex = {
      index,
      stale,
      at: Date.now(),
      assets,
      assetByToken: reuse ? reuse.assetByToken : new Map(assets.map((a) => [a.token.toLowerCase(), a])),
      launchByToken: reuse ? reuse.launchByToken : new Map(index.launches.map((l) => [l.token.toLowerCase(), l])),
    };
    live = next;
    return next;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export const assetOf = (idx: LiveIndex, token: Address | string) => idx.assetByToken.get(token.toLowerCase()) ?? null;
