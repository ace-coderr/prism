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
import { SITE_URL, escapeXml, formatScore, replaceLiteral, type ReviewView, type ReviewableAsset, type ScoreSummary } from '@prism/core';
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

interface Meta {
  title: string;
  description: string;
  path: string;
  image: string;
}

/** Replace a meta tag's content (by property or name). */
function setMeta(page: string, key: string, value: string): string {
  const re = new RegExp(`(<meta (?:property|name)="${key.replace(/[:.]/g, '\\$&')}" content=")[^"]*(")`);
  // a replacer function: `$&`, `$'`, `$1`… in untrusted text must stay literal
  return page.replace(re, (_, open: string, close: string) => `${open}${escapeXml(value)}${close}`);
}

export function withMeta(page: string, m: Meta): string {
  let out = replaceLiteral(page, /<title>[^<]*<\/title>/, `<title>${escapeXml(m.title)}</title>`);
  const url = `${SITE_URL}${m.path}`;
  for (const [k, v] of [
    ['description', m.description],
    ['og:title', m.title],
    ['og:description', m.description],
    ['og:url', url],
    ['og:image', m.image],
    ['og:image:type', 'image/png'],
    ['og:image:alt', m.title],
    ['twitter:title', m.title],
    ['twitter:description', m.description],
    ['twitter:image', m.image],
    ['twitter:image:alt', m.title],
  ] as const) {
    out = setMeta(out, k, v);
  }
  return out;
}

async function metaFor(origin: string, kind: string, id: string): Promise<Meta | null> {
  if (kind === 't' && isAddress(id, { strict: false })) {
    const t = await getJson<{ asset: ReviewableAsset; score: ScoreSummary }>(`${origin}/api/token?address=${id}`);
    if (!t) return null;
    const sym = `$${t.asset.symbol}`;
    return {
      title: t.score.score === null ? `${sym} on PRISM: reviews from real holders` : `${sym} true colors: ${formatScore(t.score.score)} from ${t.score.reviewers} holders · PRISM`,
      description: `What ${sym} (${t.asset.name}) holders really think. Only holders can review, and if they sell, it shows.`,
      path: `/t/${t.asset.token}`,
      image: `${SITE_URL}/api/og/t/${t.asset.token}.png`,
    };
  }
  if (kind === 'r' && /^\d+$/.test(id)) {
    const r = await getJson<{ review: ReviewView }>(`${origin}/api/review?id=${id}`);
    if (!r) return null;
    const v = r.review;
    const verb = v.state.kind === 'sold' ? 'sold' : 'holds';
    return {
      title: `A ${v.rating}-star review of $${v.symbol} by someone who ${verb} it · PRISM`,
      description: v.text ? `“${v.text}”` : `Rated ${v.rating} of 5 by a $${v.symbol} holder.`,
      path: `/r/${v.id}`,
      image: `${SITE_URL}/api/og/r/${v.id}.png`,
    };
  }
  return null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let kind = url.searchParams.get('kind') ?? '';
  let id = url.searchParams.get('id') ?? '';
  const m = /^\/(t|r)\/([^/]+)\/?$/.exec(url.pathname);
  if (m) [, kind, id] = m as unknown as [string, string, string];
  let meta: Meta | null = null;
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
