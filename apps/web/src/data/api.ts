import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Address } from 'viem';
import { ApiError } from './errors';
import * as site from './site';
import type {
  Feeds,
  Xray,
  LaunchRank,
  LaunchSetup,
  ReviewView,
  ReviewableAsset,
  ReviewerSummary,
  ScoreSummary,
  SetupLine,
} from '@prism/core';

/*
 * What the pages read. There is no server computing it on request any more: the feed, boards,
 * reviews and the launch index are static files the scheduled job writes, and the per-token reads
 * (market, X-ray, setup, metadata) run in this browser. See ./site.ts. Each hook returns what the
 * /api route of the same name used to.
 */

export { ApiError } from './errors';

export interface TokenData {
  asset: ReviewableAsset;
  launch: { curve: Address; gen: number; block: number; graduatedBlock: number | null; creator: Address } | null;
  /** the smallest position that counts (base units): worth $1 now ('usd'), or a millionth of the supply ('supply') */
  floor: { units: string; basis: 'usd' | 'supply' } | null;
  setup: (LaunchSetup & { airdrop?: { wallets: number; tokens: string } | null }) | null;
  setupLines: SetupLine[] | null;
  score: ScoreSummary;
  reviews: ReviewView[];
  paired: { count: number } | null;
}
export interface ReviewData {
  review: ReviewView;
  asset: ReviewableAsset | null;
  score: ScoreSummary;
  history: ReviewView[];
}
export interface ReviewerData {
  summary: ReviewerSummary | null;
  reviews: ReviewView[];
}
/** One of the newest launches whose creator has already sold most of what they bought. */
export interface CreatorSold {
  token: Address;
  symbol: string;
  name: string;
  text: string;
  movedOut: number;
  launchBlock: number;
}
export type FeedData = Feeds & {
  creatorsSelling: CreatorSold[];
  /** false while the published creator watch hasn't reached the server: an empty list means nothing yet. */
  creatorWatchReady: boolean;
  /** unix seconds when the watch these lines come from was published (0 when it hasn't been read). */
  creatorWatchUpdatedAt: number;
  launches: number;
  reviews: number;
};
export interface LeaderboardData {
  launches: LaunchRank[];
  reviewers: ReviewerSummary[];
  truthKeepers: ReviewerSummary[];
}
export interface StocksData {
  stocks: Array<{ asset: ReviewableAsset; score: ScoreSummary; paired: ReviewableAsset[]; pairedCount: number }>;
}
/** A search result: the asset plus PRISM's own numbers (null while reviews can't be read). */
export type SearchItem = ReviewableAsset & { reviews: number | null; score: ScoreSummary | null };
export interface SearchData {
  items: SearchItem[];
}

/** /api/meta: the launch's own metadata from IPFS, verified against its launch event. */
export interface MetaData {
  token: Address;
  status: 'ok' | 'none' | 'unavailable' | 'hidden';
  description: string | null;
  image: { cid: string; mimeType: string } | null;
  links: { website?: string; x?: string; telegram?: string; discord?: string };
  verified: 'cid' | 'digest' | null;
  uri: string | null;
}

/** /api/xray: what the chain says about a launch, before anyone has reviewed it. */
export interface XrayData {
  /** false: PRISM is still reading this launch's history; ask again in a moment */
  ready: boolean;
  xray: Xray | null;
}

/** /api/market: price, market cap, progress, holders and the last 24h, read from the chain. */
export interface MarketData {
  token: Address;
  status: 'curve' | 'graduated' | 'stock';
  progress: number | null;
  pair: { symbol: string; address: Address | null; decimals: number };
  ethPerPair: number | null;
  cap: string | null;
  capEth: number | null;
  priceEth: number | null;
  liquidityEth: number | null;
  usdPerEth: number | null;
  holders: number | null;
  day: { volume: string; volumeEth: number | null; buys: number; sells: number; change: number | null } | null;
  block: number;
  updatedAt: number;
}

const opts = { staleTime: 15_000, retry: 1 } as const;

export const useToken = (address: string | undefined): UseQueryResult<TokenData, ApiError> =>
  useQuery({ queryKey: ['api', 'token', address?.toLowerCase()], enabled: !!address, queryFn: () => site.getToken(address!), ...opts });

export const useReview = (id: string | undefined): UseQueryResult<ReviewData, ApiError> =>
  useQuery({ queryKey: ['api', 'review', id], enabled: !!id, queryFn: () => site.getReview(id!), ...opts });

export const useReviewer = (address: string | undefined): UseQueryResult<ReviewerData, ApiError> =>
  useQuery({ queryKey: ['api', 'reviewer', address?.toLowerCase()], enabled: !!address, queryFn: () => site.getReviewer(address!), ...opts });

export const useMeta = (token: string | undefined): UseQueryResult<MetaData, ApiError> =>
  useQuery({ queryKey: ['api', 'meta', token?.toLowerCase()], enabled: !!token, queryFn: () => site.getMeta(token!), staleTime: 3_600_000, retry: 1 });

/** Market details refresh every few minutes (the server reads the chain; the CDN caches 3 minutes). */
export const useMarket = (token: string | undefined): UseQueryResult<MarketData, ApiError> =>
  useQuery({ queryKey: ['api', 'market', token?.toLowerCase()], enabled: !!token, queryFn: () => site.getMarket(token!), staleTime: 120_000, refetchInterval: 180_000, retry: 1 });

/**
 * How long to wait before asking for an X-ray that wasn't ready: 3 s, then a little longer each
 * time (3, 4.5, 6.8 … 30 s), and null (stop) after XRAY_POLLS tries, about five minutes. A fixed 3 s
 * forever meant a tab left open on a slow launch kept the server reading it for as long as it lived.
 */
export const XRAY_POLLS = 14;
export const xrayPollDelay = (tries: number): number | null => (tries >= XRAY_POLLS ? null : Math.min(30_000, Math.round(3_000 * 1.5 ** tries)));

/**
 * The Launch X-ray. A launch from millions of blocks back takes a few requests to read, so this
 * asks again while the answer says it isn't ready; the page shows everything else meanwhile.
 */
export function useXray(token: string | undefined): UseQueryResult<XrayData, ApiError> {
  return useQuery({
    queryKey: ['api', 'xray', token?.toLowerCase()],
    enabled: !!token,
    queryFn: () => site.getXray(token!),
    staleTime: 60_000,
    retry: 1,
    refetchInterval: (q) => (q.state.data && !q.state.data.ready ? (xrayPollDelay(q.state.dataUpdateCount) ?? false) : false),
  });
}

/** The one-line X-ray flags PRISM has already worked out for these launches (it starts no reads). */
export function useXrayFlags(tokens: string[]): Record<string, string> {
  const key = [...new Set(tokens.map((t) => t.toLowerCase()))].sort();
  const q = useQuery({
    queryKey: ['api', 'xray-flags', key.join(',')],
    enabled: key.length > 0,
    queryFn: () => site.getXrayFlags(key),
    staleTime: 60_000,
    retry: 1,
  });
  return q.data?.flags ?? {};
}

export const useFeed = (): UseQueryResult<FeedData, ApiError> => useQuery({ queryKey: ['api', 'feed'], queryFn: () => site.getFeed(), ...opts });

export const useLeaderboards = (): UseQueryResult<LeaderboardData, ApiError> =>
  useQuery({ queryKey: ['api', 'leaderboards'], queryFn: () => site.getLeaderboards(), ...opts });

export const useStocks = (): UseQueryResult<StocksData, ApiError> => useQuery({ queryKey: ['api', 'stocks'], queryFn: () => site.getStocks(), ...opts });

export const useSearch = (q: string, limit = 8): UseQueryResult<SearchData, ApiError> =>
  useQuery({
    queryKey: ['api', 'search', q.trim().toLowerCase(), limit],
    enabled: q.trim().length > 0,
    queryFn: () => site.search(q, limit),
    staleTime: 60_000,
    retry: 1,
  });

/**
 * Re-read everything about reviews right after posting or marking a sale in `block`. The files are
 * rewritten by the scheduled job, which is too late for someone who has just posted, so this reads the
 * review state as of that block in this browser (site.readAfterPost) and puts it where the pages look.
 */
export function useRefreshReviews() {
  const qc = useQueryClient();
  return async (paths: { block: bigint; token?: string; author?: string; id?: number | bigint }) => {
    const after = await site.readAfterPost(paths.block, paths);
    qc.setQueryData(['api', 'feed'], after.feed);
    if (paths.token && after.token) qc.setQueryData(['api', 'token', paths.token.toLowerCase()], after.token);
    if (paths.author && after.reviewer) qc.setQueryData(['api', 'reviewer', paths.author.toLowerCase()], after.reviewer);
    if (paths.id !== undefined && after.review) qc.setQueryData(['api', 'review', String(paths.id)], after.review);
    void qc.invalidateQueries({ queryKey: ['api', 'leaderboards'] });
  };
}
