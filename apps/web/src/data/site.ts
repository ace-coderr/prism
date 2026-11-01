/**
 * Where the site's data comes from now that nothing computes it on request.
 *
 *   static files   the feed, leaderboards, stocks, every review, every reviewer and the launch index
 *                  in small pieces (/data/…), written by the scheduled job (scripts/build-site-data.ts);
 *   this browser   the reads that are per token and live (market, X-ray, setup, metadata that isn't in
 *                  a file yet), by the server's own code, loaded on demand (./live);
 *   a live read    right after someone posts a review, the review state as of that block, the same way.
 *
 * Every function returns what the matching /api route used to, so the pages are unchanged.
 */
import { getAddress, isAddress, type Address } from 'viem';
import {
  applyScan,
  emptyIndex,
  findRowIn,
  firstSearchWord,
  fromLaunchRow,
  isSplitSearchFile,
  launchAsset,
  launchShardKey,
  readTokenNames,
  reviewableStocks,
  scanLaunches,
  searchAssets,
  searchKey3Of,
  searchKeyForQuery,
  type Launch,
  type LaunchShardRow,
  type ReviewableAsset,
  type ScoreSummary,
} from '@prism/core';
import { ApiError } from './errors';
import { client } from './local/chain';
import { publishedMeta } from './local/metaCache';
import type { FeedData, LeaderboardData, MarketData, MetaData, ReviewData, ReviewerData, SearchData, SearchItem, StocksData, TokenData, XrayData } from './api';

// ------------------------------------------------------------------ the files

const BASE = '/data';
const KEEP_MS = 5 * 60_000;
const texts = new Map<string, { at: number; p: Promise<string | null> }>();

/**
 * A file's text, or null when there is none. A missing file is not a 404 here: Cloudflare Pages
 * answers a path it doesn't have with the app's own page (status 200), so what came back has to
 * be JSON to count. Kept for KEEP_MS (the launch files are big and a page asks for the same one twice).
 */
export function staticText(path: string, keepMs = KEEP_MS): Promise<string | null> {
  const hit = texts.get(path);
  if (hit && Date.now() - hit.at < keepMs) return hit.p;
  const p = fetch(`${BASE}/${path}`)
    .then(async (r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
      return r.text();
    })
    .catch(() => {
      texts.delete(path);
      throw new ApiError(503, 'Couldn’t load this right now. Try again in a minute.');
    });
  texts.set(path, { at: Date.now(), p });
  return p;
}

export async function staticJson<T>(path: string, keepMs = KEEP_MS): Promise<T | null> {
  const t = await staticText(path, keepMs);
  return t === null ? null : (JSON.parse(t) as T);
}

const must = async <T>(path: string, keepMs?: number): Promise<T> => {
  const v = await staticJson<T>(path, keepMs);
  if (v === null) throw new ApiError(503, 'Live data isn’t available right now. Try again in a minute.');
  return v;
};

/** When the files were written and what they cover. */
export interface SiteInfo {
  builtAt: number;
  indexBlock: number;
  indexGeneratedAt: number;
  launches: number;
  reviewsBlock: number;
  stale: boolean;
  /** the reviewed tokens' launches (what a live read of the reviews needs) */
  reviewed: LaunchShardRow[];
  /** the score of a token nobody has reviewed */
  emptyScore: ScoreSummary;
}
export const siteInfo = () => must<SiteInfo>('info.json', 60_000);

// ------------------------------------------------------------------ launches

export interface Found {
  asset: ReviewableAsset;
  launch: Launch | null;
  /** its row in the launch files (null for a test stock) */
  row: LaunchShardRow | null;
}

let tail: { at: number; byToken: Map<string, Found> } | null = null;

/** Launches since the files were written, read from the chain (a new launch is findable at once). */
async function launchesSinceFiles(): Promise<Map<string, Found>> {
  if (tail && Date.now() - tail.at < 60_000) return tail.byToken;
  const out = new Map<string, Found>();
  try {
    const info = await siteInfo();
    const head = await client.getBlockNumber();
    // a stretch longer than this is for the next publish: the files are never that old in practice
    if (head - BigInt(info.indexBlock) < 400_000n) {
      const scan = await scanLaunches(client, BigInt(info.indexBlock) + 1n, head);
      const names = await readTokenNames(client, scan.launches.filter((l) => l.name === null || l.symbol === null).map((l) => l.token));
      const index = applyScan(emptyIndex(46630, info.indexBlock), scan, names);
      const byToken = new Map(index.launches.map((l) => [l.token.toLowerCase(), l]));
      for (const l of index.launches) {
        const asset = launchAsset(l, index, byToken);
        out.set(l.token.toLowerCase(), { asset, launch: l, row: [l.token, l.name, l.symbol, l.quote ?? '', asset.quote?.kind ?? 'eth', asset.quote?.symbol ?? 'ETH', l.creator, l.curve, l.gen, l.launchId, l.block, l.logIndex, l.graduatedBlock ?? 0] });
      }
    }
  } catch {
    /* the files alone: a launch from the last few hours may not be found until they are rewritten */
  }
  tail = { at: Date.now(), byToken: out };
  return out;
}

/** The launch or test stock at this address, or null. */
export async function findLaunch(token: string): Promise<Found | null> {
  const lower = token.toLowerCase();
  const stock = reviewableStocks().find((a) => a.token.toLowerCase() === lower);
  if (stock) return { asset: stock, launch: null, row: null };
  const text = await staticText(`l/${launchShardKey(lower)}.json`);
  const row = text ? findRowIn(text, lower) : null;
  if (row) return { ...fromLaunchRow(row), row };
  return (await launchesSinceFiles()).get(lower) ?? null;
}

const notAToken = () => new ApiError(404, 'Not a test stock or a vibe/vibe launch.');

// ------------------------------------------------------------------ the pages' data

export const getFeed = () => must<FeedData>('feed.json', 30_000);
export const getLeaderboards = () => must<LeaderboardData>('leaderboards.json', 30_000);
export const getStocks = () => must<StocksData>('stocks.json', 30_000);

export async function getReview(id: string): Promise<ReviewData> {
  const r = /^\d{1,9}$/.test(id) ? await staticJson<ReviewData>(`review/${id}.json`, 30_000) : null;
  if (!r) throw new ApiError(404, 'No review with that number.');
  return r;
}

export async function getReviewer(address: string): Promise<ReviewerData> {
  if (!isAddress(address, { strict: false })) throw new ApiError(400, 'address must be a 0x address.');
  return (await staticJson<ReviewerData>(`reviewer/${address.toLowerCase()}.json`, 30_000)) ?? { summary: null, reviews: [] };
}

/** Race a slow read against a deadline: the page shows what it has rather than wait for the chain. */
const within = <T>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export async function getToken(address: string): Promise<TokenData> {
  if (!isAddress(address, { strict: false })) throw new ApiError(400, 'address must be a 0x address.');
  const lower = address.toLowerCase();
  const [found, base, info] = await Promise.all([findLaunch(lower), staticJson<TokenData>(`token/${lower}.json`, 30_000), siteInfo()]);
  if (!found) throw notAToken();
  const { asset, launch } = found;
  // setup (tax, split, progress) and the smallest position that counts are read now, by this browser
  const live = await within(import('./live').then((m) => m.setupAndFloor(asset, launch)), 6_000);
  return {
    asset,
    launch: launch ? { curve: launch.curve, gen: launch.gen, block: launch.block, graduatedBlock: launch.graduatedBlock, creator: launch.creator } : null,
    floor: live?.floor ?? base?.floor ?? null,
    setup: live?.setup ?? base?.setup ?? null,
    setupLines: live?.setupLines ?? base?.setupLines ?? null,
    score: base?.score ?? info.emptyScore,
    reviews: base?.reviews ?? [],
    paired: base?.paired ?? null,
  };
}

export async function getMeta(token: string): Promise<MetaData> {
  const found = await findLaunch(token);
  if (!found) throw notAToken();
  const { tokenMeta } = await import('./live');
  return (await tokenMeta(getAddress(token.toLowerCase()), found.launch)) as unknown as MetaData;
}

export async function getMarket(token: string): Promise<MarketData> {
  const found = await findLaunch(token);
  if (!found) throw notAToken();
  const { marketOf } = await import('./live');
  return (await marketOf(found.asset, found.launch)) as unknown as MarketData;
}

export async function getXray(token: string): Promise<XrayData> {
  const found = await findLaunch(token);
  if (!found) throw notAToken();
  const { xrayOf } = await import('./live');
  return (await xrayOf(found.asset, found.launch)) as unknown as XrayData;
}

/** The one-line flags the creator watch has already worked out (no reads). */
export async function getXrayFlags(tokens: readonly string[]): Promise<{ flags: Record<string, string> }> {
  const all = (await staticJson<Record<string, string>>('flags.json', 60_000)) ?? {};
  return { flags: Object.fromEntries(tokens.flatMap((t) => (all[t.toLowerCase()] ? [[t.toLowerCase(), all[t.toLowerCase()]!]] : []))) };
}

/** A token's picture from its verified metadata, if the files have it (no IPFS read, no chain read). */
export async function tokenPicture(token: string, live = false): Promise<{ cid: string; mimeType: string } | null> {
  if (reviewableStocks().some((a) => a.token.toLowerCase() === token.toLowerCase())) return null;
  const m = await publishedMeta(token);
  if (m) return m.status === 'ok' ? m.meta.image : null;
  // not in the files yet: a token's own page reads it from the chain and IPFS (a list of twenty doesn't)
  return live ? ((await getMeta(token).catch(() => null))?.image ?? null) : null;
}

// ------------------------------------------------------------------ search

const MAX_QUERY = 80;

export async function search(query: string, limit = 8): Promise<SearchData> {
  const q = query.trim();
  if (!q || q.length > MAX_QUERY) return { items: [] };
  const stocks = reviewableStocks();
  let launches: ReviewableAsset[] = [];
  if (isAddress(q, { strict: false })) {
    const hit = await findLaunch(q);
    launches = hit && hit.asset.kind === 'launch' ? [hit.asset] : [];
  } else if (/^0x[0-9a-f]{4,39}$/i.test(q)) {
    const text = await staticText(`l/${q.slice(2, 4).toLowerCase()}.json`);
    const rows = text ? (JSON.parse(text) as LaunchShardRow[]) : [];
    launches = rows.filter((r) => r[0].toLowerCase().startsWith(q.toLowerCase())).slice(0, 50).map((r) => fromLaunchRow(r).asset);
  } else {
    const key = searchKeyForQuery(q);
    const word = firstSearchWord(q);
    let rows: LaunchShardRow[] = [];
    if (key) {
      let file = await staticJson<LaunchShardRow[] | { split: true; top: LaunchShardRow[] }>(`s/${key}.json`);
      // a common start ("vi") is split by its third letter; before that is typed, the newest are shown
      if (isSplitSearchFile(file)) file = word && word.length >= 3 ? ((await staticJson<LaunchShardRow[]>(`s/${searchKey3Of(word)}.json`)) ?? []) : file.top;
      rows = Array.isArray(file) ? file : [];
    }
    launches = rows.map((r) => fromLaunchRow(r).asset);
    // a launch since the files were written
    for (const f of (await launchesSinceFiles()).values()) launches.push(f.asset);
  }
  const scores = (await staticJson<Record<string, { reviews: number; score: ScoreSummary | null }>>('scores.json', 60_000)) ?? {};
  const items: SearchItem[] = searchAssets([...stocks, ...launches], q, Math.min(limit, 50)).map((a) => {
    const s = scores[a.token.toLowerCase()];
    return { ...a, reviews: s?.reviews ?? 0, score: s?.score ?? null };
  });
  return { items };
}

// ------------------------------------------------------------------ right after posting

/**
 * The review state as of `block`, read now by this browser: the files are rewritten by the scheduled
 * job, which is too late for someone who has just posted. Returns the pages' data in the same shapes.
 */
export async function readAfterPost(block: bigint, want: { token?: string; author?: string; id?: number | bigint }) {
  const info = await siteInfo();
  const live = await import('./live');
  const known: LaunchShardRow[] = [...info.reviewed];
  if (want.token) {
    const f = await findLaunch(want.token);
    if (f?.row) known.push(f.row);
  }
  const stocks = reviewableStocks();
  const fresh = `fresh=${block}`;
  const route = <T>(path: string) => live.liveRoute<T>(`${path}${path.includes('?') ? '&' : '?'}${fresh}`, known, stocks);
  const staticFeed = await getFeed().catch(() => null);
  const feed = await route<FeedData>('/api/feed').then((f) => (staticFeed ? { ...f, creatorsSelling: staticFeed.creatorsSelling, creatorWatchReady: staticFeed.creatorWatchReady, creatorWatchUpdatedAt: staticFeed.creatorWatchUpdatedAt } : f));
  return {
    feed,
    token: want.token ? await route<TokenData>(`/api/token?address=${want.token}`) : null,
    reviewer: want.author ? await route<ReviewerData>(`/api/reviewer?address=${want.author}`) : null,
    review: want.id !== undefined ? await route<ReviewData>(`/api/review?id=${want.id}`) : null,
  };
}
