/**
 * The site's edge on Cloudflare Pages. Runs only for the paths in _routes.json (/t, /r, /badge, /api);
 * everything else is a static file, which is free and unlimited. It does one cheap lookup in a file
 * the scheduled job wrote and answers; see ../edge.ts for what it decides and ../README.md for why
 * nothing here computes anything.
 */
import { SITE_URL, findRowIn, reviewPageMeta, tokenPageMeta, withMeta, type PageMeta, type ScoreSummary } from '@prism/core';
import { badgeSvg } from '../../server/svg';
import { JSON_404, NO_SCORE, cardPath, dataPath, planFor } from '../edge';

interface Env {
  /** the static app and the job's files, from this deployment */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface Ctx {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}

// workers-types would say so; this file needs just this much of it
declare const caches: { default: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } };

/**
 * A file from this deployment, or null. Pages answers a path it doesn't have with the app's own
 * page (status 200), so what came back has to be of the expected type to count.
 */
async function asset(env: Env, url: URL, path: string, type: string): Promise<Response | null> {
  const res = await env.ASSETS.fetch(new Request(new URL(path, url)));
  return res.ok && (res.headers.get('content-type') ?? '').includes(type) ? res : null;
}

const html = (body: string, maxAge: number) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': `public, max-age=${maxAge}` } });

async function sharePage(env: Env, url: URL, plan: { kind: 'share'; token: string } | { kind: 'share-review'; id: string }): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
  const template = await page.text();
  let meta: PageMeta | null = null;
  if (plan.kind === 'share') {
    const tok = plan.token.toLowerCase();
    const full = await asset(env, url, dataPath('token', tok), 'json');
    const hasCard = full ? await asset(env, url, cardPath('t', tok), 'png') : null;
    const image = hasCard ? `${SITE_URL}${cardPath('t', tok)}` : `${SITE_URL}/og.jpg`;
    if (full) {
      meta = tokenPageMeta((await full.json()) as Parameters<typeof tokenPageMeta>[0], image);
    } else {
      const shard = await asset(env, url, dataPath('l', tok), 'json');
      // one launch out of a thousand in the file, found without parsing the rest
      const row = shard ? findRowIn(await shard.text(), tok) : null;
      if (row) meta = tokenPageMeta({ asset: { token: row[0], symbol: row[2], name: row[1] }, score: NO_SCORE }, image);
    }
  } else {
    const r = await asset(env, url, dataPath('review', plan.id), 'json');
    if (r) {
      const { review } = (await r.json()) as { review: Parameters<typeof reviewPageMeta>[0] };
      const hasCard = await asset(env, url, cardPath('r', plan.id), 'png');
      meta = reviewPageMeta(review, hasCard ? `${SITE_URL}${cardPath('r', plan.id)}` : `${SITE_URL}/og.jpg`);
    }
  }
  // a launch or review the files don't have yet gets the plain page, as it always has
  return html(meta ? withMeta(template, meta) : template, meta ? 300 : 30);
}

async function badge(env: Env, url: URL, token: string): Promise<Response> {
  const tok = token.toLowerCase();
  let symbol = '';
  let score: ScoreSummary = NO_SCORE as ScoreSummary;
  const full = await asset(env, url, dataPath('token', tok), 'json');
  if (full) {
    const t = (await full.json()) as { asset: { symbol: string }; score: ScoreSummary };
    symbol = t.asset.symbol;
    score = t.score;
  } else {
    const shard = await asset(env, url, dataPath('l', tok), 'json');
    const row = shard ? findRowIn(await shard.text(), tok) : null;
    if (!row) return new Response('Not a test stock or a vibe/vibe launch.', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });
    symbol = row[2];
  }
  return new Response(badgeSvg(symbol, score), { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

export const onRequest = async ({ request, env, waitUntil }: Ctx): Promise<Response> => {
  const url = new URL(request.url);
  const plan = planFor(url, request.method, request.headers.get('user-agent'));

  if (plan.kind === 'method') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  if (plan.kind === 'notfound') return new Response(JSON_404, { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  // the static app (index.html), for a page route a person opened and any path with no file
  if (plan.kind === 'app') return env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: request.method }));

  // a share card the job drew, or the site's own
  if (plan.kind === 'og') {
    const card = await asset(env, url, cardPath(plan.of, plan.id), 'png');
    const res = card ?? (await env.ASSETS.fetch(new Request(new URL('/og.jpg', url))));
    const out = new Response(res.body, res);
    out.headers.set('cache-control', card ? 'public, max-age=600' : 'public, max-age=60');
    return out;
  }

  // answered from this data centre's cache when it has it: the work below is small, not none
  const key = new Request(request.url, { method: 'GET' });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const res = plan.kind === 'badge' ? await badge(env, url, plan.token) : await sharePage(env, url, plan);
  if (res.status === 200) waitUntil(caches.default.put(key, res.clone()));
  return request.method === 'HEAD' ? new Response(null, res) : res;
};
