/**
 * Every reviewable asset (the five test stocks + every vibe/vibe launch), read from the chain only.
 *
 * The bulk of the index is built on a schedule by .github/workflows/launch-index.yml and published
 * as a release asset (LAUNCH_INDEX_URL); this module loads it once, then reads the blocks since
 * (eth_getLogs, a few calls) so new launches and graduations show within a minute.
 * LAUNCH_INDEX_FILE (a local .json.gz) replaces the download for local testing.
 *
 * The published file is 24 MB (47 MB of JSON, 257,000 launches) and decoding it costs about four
 * seconds of CPU, so this is built to do that as rarely as it can:
 *
 * - it is decoded once per instance. The tail is then folded into the live index in place
 *   (LiveLaunchIndex), which costs milliseconds, instead of rebuilding every list and map from
 *   scratch on each refresh (about two seconds, every 30 s while anyone was using the site);
 * - it is looked at again only every ADOPT_MS, with a conditional request (a 304 costs nothing), and
 *   only decoded again if a new one was published: the site used to download and decode it every
 *   ten minutes and then keep the copy it already had.
 */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { Address } from 'viem';
import { LAUNCH_INDEX_URL, LiveLaunchIndex, decodeIndex, readTokenNames, scanLaunches, type Launch, type LaunchIndex, type ReviewableAsset } from '@prism/core';
import { client } from './chain';

/** How often a newer published index is looked for (the scheduled job republishes it hourly or so). */
const ADOPT_MS = 6 * 3_600_000;
/** After a failed check, ask again after this long. */
const RETRY_MS = 5 * 60_000;
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

let idx: LiveLaunchIndex | null = null;
/** the block the published index we started from was read up to */
let publishedToBlock = 0;
let etag: string | null = null;
let lastCheck = 0;
let view: LiveIndex | null = null;
let loading: Promise<LiveIndex> | null = null;

/** The published index, or null when what is published is the one already held. */
async function fetchPublished(): Promise<LaunchIndex | null> {
  const file = process.env.LAUNCH_INDEX_FILE;
  if (file && idx) return null;
  const gz = file
    ? await readFile(file)
    : await (async () => {
        const res = await fetch(LAUNCH_INDEX_URL, { redirect: 'follow', headers: etag && idx ? { 'if-none-match': etag } : {} });
        if (res.status === 304) return null;
        if (!res.ok) throw new Error(res.status === 404 ? 'The launch index hasn’t been published yet.' : `Index download failed (${res.status}).`);
        etag = res.headers.get('etag');
        return Buffer.from(await res.arrayBuffer());
      })();
  if (!gz) return null;
  const index = decodeIndex(JSON.parse(gunzipSync(gz).toString('utf8')));
  if (!index) throw new Error('The published launch index is in a format this code doesn’t read (it is rebuilt on the next scheduled run).');
  return index;
}

async function refresh(): Promise<LiveIndex> {
  if (!idx || Date.now() - lastCheck > ADOPT_MS) {
    try {
      const published = await fetchPublished();
      lastCheck = Date.now();
      // adopt it if we have nothing, or it has caught up with what we hold (a fresh start from the file)
      if (published && (!idx || published.toBlock >= idx.index.toBlock)) {
        idx = new LiveLaunchIndex(published);
        publishedToBlock = published.toBlock;
      }
    } catch (e) {
      lastCheck = Date.now() - ADOPT_MS + RETRY_MS;
      if (!idx) throw e; // nothing to serve yet
    }
  }
  const live = idx!;
  const head = await client.getBlockNumber();
  let stale = false;
  if (head - BigInt(publishedToBlock) > MAX_TAIL_BLOCKS) stale = true;
  else if (head > BigInt(live.index.toBlock)) {
    try {
      const scan = await scanLaunches(client, BigInt(live.index.toBlock) + 1n, head);
      const names = await readTokenNames(client, live.tokensNeedingNames(scan));
      const added = live.apply(scan, names);
      // quote tokens that aren't ETH, a stock or a launch need their symbol read, once
      const quotes = live.quotesNeedingSymbols(added);
      if (quotes.length > 0) {
        const read = await readTokenNames(client, quotes);
        live.setQuoteSymbols(Object.fromEntries([...read].map(([k, v]) => [k, v.symbol || v.name || `${k.slice(0, 6)}…`])), added);
      }
      live.advanceTo(Number(head));
    } catch {
      stale = true;
    }
  }
  view = { index: live.index, stale, at: Date.now(), assets: live.assets, assetByToken: live.assetByToken, launchByToken: live.launchByToken };
  return view;
}

/** The index brought up to the chain head (cached for TAIL_MS). */
export async function currentIndex(): Promise<LiveIndex> {
  if (view && Date.now() - view.at < TAIL_MS) return view;
  loading ??= refresh().finally(() => {
    loading = null;
  });
  return loading;
}

export const assetOf = (live: LiveIndex, token: Address | string) => live.assetByToken.get(token.toLowerCase()) ?? null;
