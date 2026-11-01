/**
 * /t/<address> and /r/<id> (rewritten to /api/page?kind=…&id=…): the app's index.html with that
 * page's own title, description and share image, so a link posted on X shows the token's score or
 * the review itself. Link-preview bots don't run JavaScript, so this has to happen on the server.
 * The browser then loads the app as usual. Falls back to the plain page if the data is slow.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAddress } from 'viem';
import { SITE_URL, reviewPageMeta, tokenPageMeta, withMeta, type PageMeta, type ReviewView, type ReviewableAsset, type ScoreSummary } from '@prism/core';
import { originOf } from './og';

const here = dirname(fileURLToPath(import.meta.url));
let template: string | null = null;
const html = () => {
  template ??= readFileSync([join(here, 'index.html'), join(here, '../dist/index.html')].find((p) => existsSync(p))!, 'utf8');
  return template;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export { withMeta };

async function metaFor(origin: string, kind: string, id: string): Promise<PageMeta | null> {
  if (kind === 't' && isAddress(id, { strict: false })) {
    const t = await getJson<{ asset: ReviewableAsset; score: ScoreSummary }>(`${origin}/api/token?address=${id}`);
    return t ? tokenPageMeta(t, `${SITE_URL}/api/og/t/${t.asset.token}.png`) : null;
  }
  if (kind === 'r' && /^\d+$/.test(id)) {
    const r = await getJson<{ review: ReviewView }>(`${origin}/api/review?id=${id}`);
    return r ? reviewPageMeta(r.review, `${SITE_URL}/api/og/r/${r.review.id}.png`) : null;
  }
  return null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let kind = url.searchParams.get('kind') ?? '';
  let id = url.searchParams.get('id') ?? '';
  const m = /^\/(t|r)\/([^/]+)\/?$/.exec(url.pathname);
  if (m) [, kind, id] = m as unknown as [string, string, string];
  let meta: PageMeta | null = null;
  try {
    meta = await metaFor(originOf(req), kind, id);
  } catch {
    meta = null;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', meta ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400' : 'public, max-age=0, s-maxage=30');
  res.end(req.method === 'HEAD' ? undefined : meta ? withMeta(html(), meta) : html());
}
