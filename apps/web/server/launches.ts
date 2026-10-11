/**
 * GET /api/launches: every reviewable asset (the five test stocks + every vibe/vibe launch),
 * read from the chain only.
 *
 *   /api/launches                       the test stocks + the newest launches (?limit=24&offset=0)
 *   /api/launches?q=moon                search by name, symbol or address (?limit=20)
 *   /api/launches?token=0x…             one asset
 *
 * The bulk of the index is built on a schedule by .github/workflows/launch-index.yml and
 * published as a release asset (LAUNCH_INDEX_URL); this function loads it, then reads the
 * blocks since (eth_getLogs, a few calls) so new launches and graduations show within a minute.
 * Vercel's CDN caches each answer for 60 s. Read-only: no keys, no writes, no vibe/vibe API.
 * Packaged as a Vercel function by scripts/vercel-output.mjs; served by Vite in dev.
 * LAUNCH_INDEX_FILE (a local .json.gz) replaces the download for local testing.
 */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createPublicClient, http, isAddress, type PublicClient } from 'viem';
import {
  LAUNCH_INDEX_URL,
  allAssets,
  decodeIndex,
  reviewableStocks,
  robinhoodChainTestnet,
  searchAssets,
  updateIndex,
  type LaunchIndex,
  type ReviewableAsset,
} from '@prism/core';

const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { batch: { batchSize: 20 }, retryCount: 3, retryDelay: 300 }),
}) as PublicClient;

export const CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';
/** Re-download the published index this often (it changes every ~30 minutes). */
const BASE_MS = 10 * 60_000;
/** Re-read the newest blocks this often. */
const TAIL_MS = 30_000;
/** Don't read more than this many blocks on top of the published index (~12 hours). */
const MAX_TAIL_BLOCKS = 300_000n;

let base: { index: LaunchIndex; at: number } | null = null;
interface Live {
  index: LaunchIndex;
  stale: boolean;
  at: number;
  assets: ReviewableAsset[];
}
let live: Live | null = null;
let loading: Promise<Live> | null = null;

async function loadBase(): Promise<LaunchIndex> {
  if (base && Date.now() - base.at < BASE_MS) return base.index;
  try {
    const file = process.env.LAUNCH_INDEX_FILE;
    const gz = file ? await readFile(file) : Buffer.from(await (await fetchOk(LAUNCH_INDEX_URL)).arrayBuffer());
    const index = decodeIndex(JSON.parse(gunzipSync(gz).toString('utf8')));
    if (!index) throw new Error('The published launch index is in a format this code doesn’t read.');
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

async function current(): Promise<Live> {
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
    const assets = live?.index === index ? live.assets : allAssets(index);
    const next: Live = { index, stale, at: Date.now(), assets };
    live = next;
    return next;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

const int = (v: string | null, def: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def;
};

function send(res: ServerResponse, req: IncomingMessage, status: number, body: unknown, cache = CACHE_CONTROL) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', cache);
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, HEAD');
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const token = url.searchParams.get('token');
  const q = url.searchParams.get('q');
  if (token !== null && !isAddress(token, { strict: false })) {
    return send(res, req, 400, { error: 'token must be a 0x address.' }, 'no-store');
  }
  try {
    const { index, stale, assets } = await current();
    const meta = { block: index.toBlock, generatedAt: index.generatedAt, stale, launches: index.launches.length };
    if (token !== null) {
      const asset = assets.find((a) => a.token.toLowerCase() === token.toLowerCase());
      return asset ? send(res, req, 200, { ...meta, asset }) : send(res, req, 404, { ...meta, error: 'Not a test stock or a vibe/vibe launch.' });
    }
    if (q !== null) return send(res, req, 200, { ...meta, items: searchAssets(assets, q, int(url.searchParams.get('limit'), 20, 50)) });
    const limit = int(url.searchParams.get('limit'), 24, 100);
    const offset = int(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    const launches = assets.filter((a) => a.kind === 'launch');
    return send(res, req, 200, { ...meta, stocks: reviewableStocks(), items: launches.slice(offset, offset + limit) });
  } catch (e) {
    // never cache a failure
    return send(res, req, 503, { error: 'Launch data isn’t available right now. Try again in a minute.', detail: String((e as Error).message ?? e).split('\n')[0] }, 'no-store');
  }
}
