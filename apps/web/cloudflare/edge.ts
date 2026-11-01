/**
 * What the Cloudflare edge does with a request, as plain functions (the Pages Function in
 * functions/[[path]].ts is a thin wrapper around them, and edge.test.ts runs them).
 *
 * A request on Cloudflare's free plan gets 10 ms of CPU and 128 MB, so the edge computes nothing: it
 * looks one thing up in a static file the scheduled job wrote (the file for a token's address, a
 * review, a share card) and puts it in a template. Everything heavier happens in the job, or in the
 * visitor's browser. It answers four things:
 *
 *   /t/<token>, /r/<id>      a link-preview crawler gets the page with that token's or review's tags;
 *                            a person gets the app (the browser then reads the data itself)
 *   /badge/<token>.svg       the "true colors" badge creators embed elsewhere
 *   /api/og/…png             the share card the job drew, or the site's own
 *   anything else under /api a 404 (there is no server API any more)
 */
import table from '../server/routes.json';

export type Plan =
  | { kind: 'share'; token: string }
  | { kind: 'share-review'; id: string }
  | { kind: 'badge'; token: string }
  | { kind: 'og'; of: 't' | 'r'; id: string }
  /** the static app: a person on a page route, or a path with no file */
  | { kind: 'app' }
  | { kind: 'notfound' }
  | { kind: 'method' };

const CRAWLERS = new RegExp(table.crawlers);
export const isCrawler = (userAgent: string | null | undefined) => !!userAgent && CRAWLERS.test(userAgent);

const ADDR = '0x[0-9a-fA-F]{40}';
const R = {
  token: new RegExp(`^/t/(${ADDR})/?$`),
  review: /^\/r\/([0-9]{1,9})\/?$/,
  badge: new RegExp(`^/badge/(${ADDR})\\.svg$`),
  ogToken: new RegExp(`^/api/og/t/(${ADDR})\\.png$`),
  ogReview: /^\/api\/og\/r\/([0-9]{1,9})\.png$/,
};

export function planFor(url: URL, method: string, userAgent: string | null): Plan {
  if (method !== 'GET' && method !== 'HEAD') return { kind: 'method' };
  const p = url.pathname;
  let m: RegExpExecArray | null;
  if ((m = R.token.exec(p))) return isCrawler(userAgent) ? { kind: 'share', token: m[1]! } : { kind: 'app' };
  if ((m = R.review.exec(p))) return isCrawler(userAgent) ? { kind: 'share-review', id: m[1]! } : { kind: 'app' };
  if ((m = R.badge.exec(p))) return { kind: 'badge', token: m[1]! };
  if ((m = R.ogToken.exec(p))) return { kind: 'og', of: 't', id: m[1]! };
  if ((m = R.ogReview.exec(p))) return { kind: 'og', of: 'r', id: m[1]! };
  return p === '/api' || p.startsWith('/api/') ? { kind: 'notfound' } : { kind: 'app' };
}

/** A token's file in the job's output. Addresses are lower-case there. */
export const dataPath = (kind: 'token' | 'review' | 'l', id: string) => (kind === 'l' ? `/data/l/${id.slice(2, 4).toLowerCase()}.json` : `/data/${kind}/${id.toLowerCase()}.json`);
export const cardPath = (of: 't' | 'r', id: string) => `/data/og/${of}/${id.toLowerCase()}.png`;

/** What a token nobody has reviewed scores. */
export const NO_SCORE = { score: null, reviewers: 0, sold: 0, confidence: 'none', total: 0 } as const;

export const JSON_404 = JSON.stringify({ error: 'Not found' });
