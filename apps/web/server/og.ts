/**
 * GET /api/og/t/<address>.png and /api/og/r/<id>.png (rewritten to /api/og?kind=…&id=…): the share
 * images X and other apps show for a launch page and a review page. Data comes from this site's own
 * /api/token and /api/review (CDN-cached), the username from PrismProfiles; rendered with resvg.
 * Anything missing falls back to the site's own card, never an error image.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAddress, type Address } from 'viem';
import { getDeployment, prismProfilesAbi, robinhoodChainTestnet, type ReviewView, type ReviewableAsset, type ScoreSummary } from '@prism/core';
import { client } from './chain';
import { renderPng } from './render';
import { launchCardSvg, reviewCardSvg, siteCardSvg } from './svg';

export const originOf = (req: IncomingMessage) => {
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost:5173';
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0]}://${host.split(',')[0]}`;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function usernameOf(address: Address): Promise<string | null> {
  const contract = getDeployment(robinhoodChainTestnet.id)?.prismProfiles;
  if (!contract) return null;
  try {
    const p = await client.readContract({ address: contract, abi: prismProfilesAbi, functionName: 'profileOf', args: [address] });
    return (p as { name: string }).name || null;
  } catch {
    return null;
  }
}

type TokenBody = { asset: ReviewableAsset; score: ScoreSummary; setup: { progress?: number | null } | null };
type ReviewBody = { review: ReviewView };

export async function cardSvg(origin: string, kind: string, id: string): Promise<string | null> {
  if (kind === 't' && isAddress(id, { strict: false })) {
    const t = await getJson<TokenBody>(`${origin}/api/token?address=${id}`);
    if (!t) return null;
    return launchCardSvg({
      token: t.asset.token,
      symbol: t.asset.symbol,
      name: t.asset.name,
      pair: t.asset.quote?.symbol ?? 'ETH',
      status: t.asset.status,
      progress: t.setup?.progress ?? null,
      score: t.score,
    });
  }
  if (kind === 'r' && /^\d+$/.test(id)) {
    const r = await getJson<ReviewBody>(`${origin}/api/review?id=${id}`);
    if (!r) return null;
    const v = r.review;
    return reviewCardSvg({ id: v.id, author: v.author, name: await usernameOf(v.author), symbol: v.symbol, rating: v.rating, text: v.text, state: v.state, days: v.days });
  }
  return null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let kind = url.searchParams.get('kind') ?? '';
  let id = url.searchParams.get('id') ?? '';
  const m = /^\/api\/og\/(t|r)\/([^/]+)\.png$/.exec(url.pathname);
  if (m) [, kind, id] = m as unknown as [string, string, string];
  let svg: string | null = null;
  try {
    svg = await cardSvg(originOf(req), kind, id);
  } catch {
    svg = null;
  }
  const png = await renderPng(svg ?? siteCardSvg());
  res.statusCode = 200;
  res.setHeader('content-type', 'image/png');
  // a real card for 10 minutes; the fallback only briefly, so the real one replaces it soon
  res.setHeader('cache-control', svg ? 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400' : 'public, max-age=60, s-maxage=60');
  res.end(req.method === 'HEAD' ? undefined : Buffer.from(png));
}
