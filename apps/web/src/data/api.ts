import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Address } from 'viem';
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
 * The site's own read-only API (apps/web/server/data.ts): everything it returns was read from the
 * chain. Answers are cached by the CDN for 20 s; right after posting, `refresh` asks for a state that
 * includes the block the transaction landed in.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** `freshBlock`: the answer must include this block (a review just posted there). */
export async function api<T>(path: string, freshBlock: bigint | null = null): Promise<T> {
  const url = freshBlock !== null ? `${path}${path.includes('?') ? '&' : '?'}fresh=${freshBlock}` : path;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new ApiError(res.status, body?.error ?? 'Couldn’t load this right now.');
  return body;
}

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
export type FeedData = Feeds & { creatorsSelling: CreatorSold[]; launches: number; reviews: number };
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
  useQuery({ queryKey: ['api', 'token', address?.toLowerCase()], enabled: !!address, queryFn: () => api<TokenData>(`/api/token?address=${address}`), ...opts });

export const useReview = (id: string | undefined): UseQueryResult<ReviewData, ApiError> =>
  useQuery({ queryKey: ['api', 'review', id], enabled: !!id, queryFn: () => api<ReviewData>(`/api/review?id=${id}`), ...opts });

export const useReviewer = (address: string | undefined): UseQueryResult<ReviewerData, ApiError> =>
  useQuery({ queryKey: ['api', 'reviewer', address?.toLowerCase()], enabled: !!address, queryFn: () => api<ReviewerData>(`/api/reviewer?address=${address}`), ...opts });

export const useMeta = (token: string | undefined): UseQueryResult<MetaData, ApiError> =>
  useQuery({ queryKey: ['api', 'meta', token?.toLowerCase()], enabled: !!token, queryFn: () => api<MetaData>(`/api/meta?token=${token}`), staleTime: 3_600_000, retry: 1 });

/** Market details refresh every few minutes (the server reads the chain; the CDN caches 3 minutes). */
export const useMarket = (token: string | undefined): UseQueryResult<MarketData, ApiError> =>
  useQuery({ queryKey: ['api', 'market', token?.toLowerCase()], enabled: !!token, queryFn: () => api<MarketData>(`/api/market?token=${token}`), staleTime: 120_000, refetchInterval: 180_000, retry: 1 });

/**
 * The Launch X-ray. A launch from millions of blocks back takes a few requests to read, so this
 * asks again while the answer says it isn't ready; the page shows everything else meanwhile.
 */
export function useXray(token: string | undefined): UseQueryResult<XrayData, ApiError> {
  return useQuery({
    queryKey: ['api', 'xray', token?.toLowerCase()],
    enabled: !!token,
    queryFn: () => api<XrayData>(`/api/xray?token=${token}`),
    staleTime: 60_000,
    retry: 1,
    refetchInterval: (q) => (q.state.data && !q.state.data.ready ? 3_000 : false),
  });
}

/** The one-line X-ray flags PRISM has already worked out for these launches (it starts no reads). */
export function useXrayFlags(tokens: string[]): Record<string, string> {
  const key = [...new Set(tokens.map((t) => t.toLowerCase()))].sort();
  const q = useQuery({
    queryKey: ['api', 'xray-flags', key.join(',')],
    enabled: key.length > 0,
    queryFn: () => api<{ flags: Record<string, string> }>(`/api/xray?tokens=${key.join(',')}`),
    staleTime: 60_000,
    retry: 1,
  });
  return q.data?.flags ?? {};
}

export const useFeed = (): UseQueryResult<FeedData, ApiError> => useQuery({ queryKey: ['api', 'feed'], queryFn: () => api<FeedData>('/api/feed'), ...opts });

export const useLeaderboards = (): UseQueryResult<LeaderboardData, ApiError> =>
  useQuery({ queryKey: ['api', 'leaderboards'], queryFn: () => api<LeaderboardData>('/api/leaderboards'), ...opts });

export const useStocks = (): UseQueryResult<StocksData, ApiError> => useQuery({ queryKey: ['api', 'stocks'], queryFn: () => api<StocksData>('/api/stocks'), ...opts });

export const useSearch = (q: string, limit = 8): UseQueryResult<SearchData, ApiError> =>
  useQuery({
    queryKey: ['api', 'search', q.trim().toLowerCase(), limit],
    enabled: q.trim().length > 0,
    queryFn: () => api<SearchData>(`/api/launches?q=${encodeURIComponent(q.trim())}&limit=${limit}`),
    staleTime: 60_000,
    retry: 1,
  });

/** Re-read everything about reviews (after posting or marking a sale in `block`). */
export function useRefreshReviews() {
  const qc = useQueryClient();
  return async (paths: { block: bigint; token?: string; author?: string; id?: number | bigint }) => {
    const b = paths.block;
    const jobs: Array<Promise<unknown>> = [api<FeedData>('/api/feed', b).then((d) => qc.setQueryData(['api', 'feed'], d))];
    if (paths.token) jobs.push(api<TokenData>(`/api/token?address=${paths.token}`, b).then((d) => qc.setQueryData(['api', 'token', paths.token!.toLowerCase()], d)));
    if (paths.author) jobs.push(api<ReviewerData>(`/api/reviewer?address=${paths.author}`, b).then((d) => qc.setQueryData(['api', 'reviewer', paths.author!.toLowerCase()], d)));
    if (paths.id !== undefined) jobs.push(api<ReviewData>(`/api/review?id=${paths.id}`, b).then((d) => qc.setQueryData(['api', 'review', String(paths.id)], d)));
    await Promise.allSettled(jobs);
    void qc.invalidateQueries({ queryKey: ['api', 'leaderboards'] });
  };
}
