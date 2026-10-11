import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Address } from 'viem';
import type {
  Feeds,
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
 * chain. Answers are cached by the CDN for 20 s; `refresh` asks for a fresh read (right after posting).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, fresh = false): Promise<T> {
  const url = fresh ? `${path}${path.includes('?') ? '&' : '?'}fresh=1&t=${Date.now()}` : path;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new ApiError(res.status, body?.error ?? 'Couldn’t load this right now.');
  return body;
}

export interface TokenData {
  asset: ReviewableAsset;
  launch: { curve: Address; gen: number; block: number; graduatedBlock: number | null } | null;
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
export type FeedData = Feeds & { launches: number; reviews: number };
export interface LeaderboardData {
  launches: LaunchRank[];
  reviewers: ReviewerSummary[];
  truthKeepers: ReviewerSummary[];
}
export interface StocksData {
  stocks: Array<{ asset: ReviewableAsset; score: ScoreSummary; paired: ReviewableAsset[]; pairedCount: number }>;
}
export interface SearchData {
  items: ReviewableAsset[];
}

const opts = { staleTime: 15_000, retry: 1 } as const;

export const useToken = (address: string | undefined): UseQueryResult<TokenData, ApiError> =>
  useQuery({ queryKey: ['api', 'token', address?.toLowerCase()], enabled: !!address, queryFn: () => api<TokenData>(`/api/token?address=${address}`), ...opts });

export const useReview = (id: string | undefined): UseQueryResult<ReviewData, ApiError> =>
  useQuery({ queryKey: ['api', 'review', id], enabled: !!id, queryFn: () => api<ReviewData>(`/api/review?id=${id}`), ...opts });

export const useReviewer = (address: string | undefined): UseQueryResult<ReviewerData, ApiError> =>
  useQuery({ queryKey: ['api', 'reviewer', address?.toLowerCase()], enabled: !!address, queryFn: () => api<ReviewerData>(`/api/reviewer?address=${address}`), ...opts });

export const useFeed = (): UseQueryResult<FeedData, ApiError> => useQuery({ queryKey: ['api', 'feed'], queryFn: () => api<FeedData>('/api/feed'), ...opts });

export const useLeaderboards = (): UseQueryResult<LeaderboardData, ApiError> =>
  useQuery({ queryKey: ['api', 'leaderboards'], queryFn: () => api<LeaderboardData>('/api/leaderboards'), ...opts });

export const useStocks = (): UseQueryResult<StocksData, ApiError> => useQuery({ queryKey: ['api', 'stocks'], queryFn: () => api<StocksData>('/api/stocks'), ...opts });

export const useSearch = (q: string): UseQueryResult<SearchData, ApiError> =>
  useQuery({
    queryKey: ['api', 'search', q.trim().toLowerCase()],
    enabled: q.trim().length > 0,
    queryFn: () => api<SearchData>(`/api/launches?q=${encodeURIComponent(q.trim())}&limit=8`),
    staleTime: 60_000,
    retry: 1,
  });

/** Re-read everything about reviews from the chain (after posting or marking a sale). */
export function useRefreshReviews() {
  const qc = useQueryClient();
  return async (paths: { token?: string; author?: string; id?: number | bigint }) => {
    const jobs: Array<Promise<unknown>> = [api<FeedData>('/api/feed', true).then((d) => qc.setQueryData(['api', 'feed'], d))];
    if (paths.token) jobs.push(api<TokenData>(`/api/token?address=${paths.token}`, true).then((d) => qc.setQueryData(['api', 'token', paths.token!.toLowerCase()], d)));
    if (paths.author) jobs.push(api<ReviewerData>(`/api/reviewer?address=${paths.author}`, true).then((d) => qc.setQueryData(['api', 'reviewer', paths.author!.toLowerCase()], d)));
    if (paths.id !== undefined) jobs.push(api<ReviewData>(`/api/review?id=${paths.id}`, true).then((d) => qc.setQueryData(['api', 'review', String(paths.id)], d)));
    await Promise.allSettled(jobs);
    void qc.invalidateQueries({ queryKey: ['api', 'leaderboards'] });
  };
}
