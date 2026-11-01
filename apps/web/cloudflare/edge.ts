/**
 * What the Cloudflare edge does with a request, as plain functions (the Pages Function in
 * functions/[[path]].ts is a thin wrapper around them, and edge.test.ts runs them).
 *
 * Cloudflare's free tier gives a Worker 10 ms of CPU and 128 MB, which the site's data routes (a
 * 257,000-launch index, share-card rendering, picture resizing) are far beyond, so those keep
 * running where they do. The edge serves the app, decides what is worth asking the origin for,
 * caches what comes back, and never forwards a path the site doesn't have. It uses the same route
 * table as the Vercel build (server/routes.json), so the two can't disagree about what exists.
 */
import table from '../server/routes.json';

/** Where the data routes run. */
export const DEFAULT_ORIGIN = 'https://seeprism.vercel.app';

export type Plan =
  /** ask the origin for this path and query (cached for as long as it says) */
  | { kind: 'proxy'; path: string }
  /** a link-preview crawler on a /t or /r page: the origin's page with that page's share tags */
  | { kind: 'page'; path: string }
  /** anyone else on a page route (or an unknown path): the static app */
  | { kind: 'app' }
  /** an /api path the site doesn't have */
  | { kind: 'notfound' }
  | { kind: 'method' };

const CRAWLERS = new RegExp(table.crawlers);
export const isCrawler = (userAgent: string | null | undefined) => !!userAgent && CRAWLERS.test(userAgent);

const ROUTES = table.routes.map((r) => ({ re: new RegExp(r.src), dest: r.dest, bots: 'bots' in r && r.bots === true }));

/** `dest` with $1, $2 … filled in from the match, and the request's own query added after its own. */
function destFor(dest: string, match: RegExpExecArray, search: string): string {
  const path = dest.replace(/\$(\d)/g, (_, n: string) => match[Number(n)] ?? '');
  return search.length > 1 ? `${path}${path.includes('?') ? '&' : '?'}${search.slice(1)}` : path;
}

export function planFor(url: URL, method: string, userAgent: string | null): Plan {
  if (method !== 'GET' && method !== 'HEAD') return { kind: 'method' };
  for (const r of ROUTES) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    if (r.bots) return isCrawler(userAgent) ? { kind: 'page', path: destFor(r.dest, m, url.search) } : { kind: 'app' };
    return { kind: 'proxy', path: destFor(r.dest, m, url.search) };
  }
  // the data routes only: anything else under /api is not something the origin has either
  return url.pathname.startsWith('/api/') || url.pathname === '/api' ? { kind: 'notfound' } : { kind: 'app' };
}

/** The longest an answer is kept at the edge: what the origin said, up to a year; 0 = don't. */
export function ttlSeconds(cacheControl: string | null, status: number): number {
  if (status !== 200 || !cacheControl) return 0;
  if (/no-store|no-cache|private/i.test(cacheControl)) return 0;
  const s = /s-maxage=(\d+)/i.exec(cacheControl) ?? /(?:^|[\s,])max-age=(\d+)/i.exec(cacheControl);
  return s ? Math.min(Number(s[1]), 31_536_000) : 0;
}

/** Headers that mean something only between two hops, or that would set state on a visitor. */
const DROP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'set-cookie', 'x-vercel-id', 'x-vercel-cache', 'server']);
export function passHeaders(from: Headers): Headers {
  const out = new Headers();
  for (const [k, v] of from) if (!DROP.has(k.toLowerCase())) out.set(k, v);
  return out;
}

export const JSON_404 = JSON.stringify({ error: 'Not found' });
