/**
 * The site's read-only data, one function for every route (the launch index and the review state
 * load once per instance and are shared):
 *
 *   /api/launches[?q=…|?token=0x…]   reviewable assets: test stocks + every vibe/vibe launch, search
 *   /api/token?address=0x…           one asset: setup (from its contracts), true colors, reviews
 *   /api/review?id=N                 one review, its token and score
 *   /api/reviewer?address=0x…        honesty rep, counts, badges, reviews
 *   /api/feed                        Home: latest, caught selling, top launches, top reviewers
 *   /api/leaderboards                launches, reviewers, truth keepers
 *   /api/stocks                      the test stocks, their scores and the launches paired with them
 *   /api/meta?token=0x…              a launch's own metadata: description, picture, links (IPFS, verified)
 *   /api/market?token=0x…            price, market cap, progress, holders, liquidity and the last 24h
 *   /api/xray?token=0x…               Launch X-ray: what the chain says about a launch (no reviews needed)
 *   /badge/0x….svg                   a live true colors badge for creators
 *
 * Everything comes from the chain (public RPC, read-only): the launch index (see launchIndex.ts),
 * PrismReviews and live balances. `?fresh=<block>` asks for a state that includes that block (right
 * after posting); fresh reads are shared and rate-limited per instance (reviewState.ts).
 * Packaged as a Vercel function by scripts/vercel-output.mjs; served by Vite in dev.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getAddress, isAddress, type Address } from 'viem';
import {
  REVIEWABLE_STOCK_IDS,
  filterReviews,
  rankLaunches,
  rankReviewers,
  readLaunchSetup,
  reviewableStocks,
  searchAssets,
  setupLines,
  tokenById,
  tokenScore,
  type LaunchSetup,
  type ReviewableAsset,
} from '@prism/core';
import { client, json } from './chain';
import { currentIndex } from './launchIndex';
import { reviewState, type ReviewState } from './reviewState';
import { marketOf } from './marketData';
import { badgeSvg } from './svg';
import { tokenMeta } from './tokenMeta';
import { floorFor } from './floors';
import { cachedFlags, creatorsSelling, xrayOf } from './xray';

export const CACHE_CONTROL = 'public, max-age=0, s-maxage=20, stale-while-revalidate=120';

/** A body with its own cache lifetime (the default is CACHE_CONTROL). */
class Cached {
  constructor(
    readonly body: unknown,
    readonly cache: string,
  ) {}
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const int = (v: string | null, def: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def;
};

function addressParam(url: URL, name = 'address'): Address {
  const v = url.searchParams.get(name);
  if (!v || !isAddress(v, { strict: false })) throw new HttpError(400, `${name} must be a 0x address.`);
  return getAddress(v.toLowerCase());
}

const setups = new Map<string, { at: number; setup: LaunchSetup }>();
async function setupOf(asset: ReviewableAsset, s: ReviewState): Promise<LaunchSetup> {
  if (asset.kind === 'stock') return { kind: 'stock' };
  const key = asset.token.toLowerCase();
  const hit = setups.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.setup;
  const launch = s.index.launchByToken.get(key)!;
  const setup = await readLaunchSetup(client, launch);
  setups.set(key, { at: Date.now(), setup });
  return setup;
}

const pairedWith = (s: ReviewState, stock: Address) => {
  const k = stock.toLowerCase();
  return s.index.assets.filter((a) => a.kind === 'launch' && a.quote?.address?.toLowerCase() === k);
};

/** One handler per route: returns a JSON-able body. */
const routes: Record<string, (url: URL, minBlock: bigint) => Promise<unknown>> = {
  async launches(url) {
    const { index, stale, assets } = await currentIndex();
    const meta = { block: index.toBlock, generatedAt: index.generatedAt, stale, launches: index.launches.length };
    const token = url.searchParams.get('token');
    if (token !== null) {
      const asset = assets.find((a) => a.token.toLowerCase() === addressParam(url, 'token').toLowerCase());
      if (!asset) throw new HttpError(404, 'Not a test stock or a vibe/vibe launch.');
      return { ...meta, asset };
    }
    const q = url.searchParams.get('q');
    if (q !== null) {
      const items = searchAssets(assets, q, int(url.searchParams.get('limit'), 20, 50));
      // PRISM's own numbers next to each result: current reviews and the true colors score
      const s = await reviewState().catch(() => null);
      return {
        ...meta,
        items: items.map((a) => {
          if (!s) return { ...a, reviews: null, score: null };
          const k = a.token.toLowerCase();
          const reviews = s.world.views.filter((v) => v.token.toLowerCase() === k && !v.retired && v.status !== 'replaced').length;
          return { ...a, reviews, score: reviews ? tokenScore(s.world, a.token, s.balances) : null };
        }),
      };
    }
    const limit = int(url.searchParams.get('limit'), 24, 100);
    const offset = int(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    return { ...meta, stocks: reviewableStocks(), items: assets.filter((a) => a.kind === 'launch').slice(offset, offset + limit) };
  },

  async token(url, minBlock) {
    const address = addressParam(url);
    const s = await reviewState(minBlock);
    const asset = s.index.assetByToken.get(address.toLowerCase());
    if (!asset) throw new HttpError(404, 'Not a test stock or a vibe/vibe launch.');
    const setup = await setupOf(asset, s).catch(() => null);
    const pair = asset.quote?.symbol ?? 'ETH';
    const reviews = s.world.views.filter((v) => v.token.toLowerCase() === address.toLowerCase()).sort((a, b) => b.id - a.id);
    const launch = s.index.launchByToken.get(address.toLowerCase());
    const floor = s.floors.get(address.toLowerCase()) ?? (await floorFor(asset, launch ?? null).catch(() => null));
    return {
      asset,
      launch: launch ? { curve: launch.curve, gen: launch.gen, block: launch.block, graduatedBlock: launch.graduatedBlock, creator: launch.creator } : null,
      /** the smallest position that counts (base units): worth $1 now, or a millionth of the supply if unpriced */
      floor: floor ? { units: floor.units.toString(), basis: floor.basis } : null,
      setup,
      setupLines: setup ? setupLines(setup, `$${asset.symbol}`, pair) : null,
      score: tokenScore(s.world, address, s.balances),
      reviews,
      paired: asset.kind === 'stock' ? { count: pairedWith(s, address).length } : null,
    };
  },

  async meta(url) {
    const address = addressParam(url, 'token');
    const { assetByToken, launchByToken } = await currentIndex();
    if (!assetByToken.has(address.toLowerCase())) throw new HttpError(404, 'Not a test stock or a vibe/vibe launch.');
    const body = await tokenMeta(address, launchByToken.get(address.toLowerCase()) ?? null);
    // a launch's metadata never changes (its URI is in the launch event, IPFS is content-addressed):
    // final answers are kept for a year (a deploy clears the CDN, e.g. after hiding a token);
    // 'unavailable' (never read yet) is asked again within a minute
    return new Cached(body, body.status === 'unavailable' ? 'public, max-age=0, s-maxage=60' : 'public, max-age=86400, s-maxage=31536000, stale-while-revalidate=31536000');
  },

  async market(url) {
    const address = addressParam(url, 'token');
    const { assetByToken, launchByToken } = await currentIndex();
    const asset = assetByToken.get(address.toLowerCase());
    if (!asset) throw new HttpError(404, 'Not a test stock or a vibe/vibe launch.');
    const body = await marketOf(asset, launchByToken.get(address.toLowerCase()) ?? null);
    return new Cached(body, 'public, max-age=60, s-maxage=180, stale-while-revalidate=600');
  },

  async xray(url) {
    const many = url.searchParams.get('tokens');
    if (many !== null) {
      const tokens = many.split(',').filter((t) => isAddress(t, { strict: false })).slice(0, 50);
      return new Cached({ flags: cachedFlags(tokens) }, 'public, max-age=30, s-maxage=60');
    }
    const address = addressParam(url, 'token');
    const { assetByToken, launchByToken } = await currentIndex();
    const asset = assetByToken.get(address.toLowerCase());
    if (!asset) throw new HttpError(404, 'Not a test stock or a vibe/vibe launch.');
    const answer = await xrayOf(asset, launchByToken.get(address.toLowerCase()) ?? null);
    // reading an old launch's whole history takes a while: don't cache "still reading"
    return new Cached(answer, answer.ready ? 'public, max-age=60, s-maxage=180, stale-while-revalidate=600' : 'no-store');
  },

  async review(url, minBlock) {
    const id = int(url.searchParams.get('id'), -1, Number.MAX_SAFE_INTEGER);
    const s = await reviewState(minBlock);
    const review = s.world.byId.get(id);
    if (!review) throw new HttpError(404, 'No review with that number.');
    const asset = s.index.assetByToken.get(review.token.toLowerCase()) ?? null;
    // the whole chain of this author's reviews of this token, newest first
    const history = s.world.views.filter((v) => v.author === review.author && v.token === review.token && v.retired === review.retired).sort((a, b) => b.id - a.id);
    return { review, asset, score: tokenScore(s.world, review.token, s.balances), history };
  },

  async reviewer(url, minBlock) {
    const address = addressParam(url);
    const s = await reviewState(minBlock);
    const summary = s.reviewers.get(address.toLowerCase()) ?? null;
    // reviews of tokens PRISM lists (retired ones too, as history)
    const reviews = s.world.views.filter((v) => v.author.toLowerCase() === address.toLowerCase() && v.listed).sort((a, b) => b.id - a.id);
    return { summary, reviews };
  },

  async feed(_url, minBlock) {
    const s = await reviewState(minBlock);
    // the newest launches, for the chain-only "creators selling" feed
    const newest = s.index.assets
      .filter((a) => a.kind === 'launch')
      .slice(0, 40)
      .map((asset) => ({ asset, launch: s.index.launchByToken.get(asset.token.toLowerCase()) ?? null }));
    // the count includes the first contract's reviews: they show in "latest" as history
    return { ...s.feeds, creatorsSelling: creatorsSelling(newest), launches: s.index.index.launches.length, reviews: filterReviews(s.world.views.filter((v) => v.listed), 'all').length };
  },

  async leaderboards() {
    const s = await reviewState();
    // counted reviews only: listed tokens, not the creator, at least the floor, current contract
    const tokens = [...new Map(s.world.counted.map((r) => [r.token.toLowerCase(), s.world.byId.get(r.id)!])).values()];
    const reviewers = [...s.reviewers.values()];
    return {
      launches: rankLaunches(s.world, tokens, s.balances).slice(0, 50),
      reviewers: rankReviewers(reviewers).slice(0, 50),
      truthKeepers: reviewers.filter((r) => r.marks > 0).sort((a, b) => b.marks - a.marks).slice(0, 50),
    };
  },

  async stocks(url) {
    const s = await reviewState();
    const only = url.searchParams.get('symbol');
    return {
      stocks: REVIEWABLE_STOCK_IDS.filter((id) => !only || id === only).map((id) => {
        const asset = s.index.assetByToken.get(tokenById(id)!.address.toLowerCase())!;
        const paired = pairedWith(s, asset.token);
        // graduated launches first, then the newest
        const top = [...paired].sort((a, b) => Number(b.status === 'graduated') - Number(a.status === 'graduated') || (b.block ?? 0) - (a.block ?? 0));
        return {
          asset,
          score: tokenScore(s.world, asset.token, s.balances),
          paired: top.slice(0, int(url.searchParams.get('limit'), 12, 100)),
          pairedCount: paired.length,
        };
      }),
    };
  },
};

function send(res: ServerResponse, req: IncomingMessage, status: number, body: string, type: string, cache: string) {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', cache);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, HEAD');
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  // the route comes from the rewrite (?route=…) or, if the platform passes the original URL, its path
  const route =
    url.searchParams.get('route') ??
    (/^\/badge\//.test(url.pathname) ? 'badge' : url.pathname.replace(/^\/api\//, '').replace(/\/$/, ''));
  if (route === 'badge' && !url.searchParams.get('address')) {
    const m = /^\/badge\/(0x[0-9a-fA-F]{40})\.svg$/.exec(url.pathname);
    if (m) url.searchParams.set('address', m[1]!);
  }
  // ?fresh=<block>: a state that includes that block (fresh=1, from older pages, means "recent")
  const freshParam = url.searchParams.get('fresh');
  const fresh = freshParam !== null;
  const minBlock = freshParam && /^\d{1,12}$/.test(freshParam) ? BigInt(freshParam) : 0n;
  try {
    if (route === 'badge') {
      const address = addressParam(url);
      const s = await reviewState();
      const asset = s.index.assetByToken.get(address.toLowerCase());
      if (!asset) throw new HttpError(404, 'Not a test stock or a vibe/vibe launch.');
      return send(res, req, 200, badgeSvg(asset.symbol, tokenScore(s.world, address, s.balances)), 'image/svg+xml; charset=utf-8', 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600');
    }
    const fn = routes[route];
    if (!fn) throw new HttpError(404, 'Not found');
    const out = await fn(url, minBlock);
    const [body, cache] = out instanceof Cached ? [out.body, out.cache] : [out, CACHE_CONTROL];
    return send(res, req, 200, json(body), 'application/json; charset=utf-8', fresh ? 'no-store' : cache);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 503;
    const message = e instanceof HttpError ? e.message : 'Data isn’t available right now. Try again in a minute.';
    const detail = e instanceof HttpError ? undefined : String((e as Error).message ?? e).split('\n')[0];
    // never cache a failure
    return send(res, req, status, json({ error: message, detail }), 'application/json; charset=utf-8', 'no-store');
  }
}
