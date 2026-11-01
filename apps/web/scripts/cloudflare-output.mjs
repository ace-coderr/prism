/**
 * Assembles what Cloudflare Pages deploys, after `vite build`:
 *   apps/web/cloudflare/site/            the app (apps/web/dist) plus the Pages routing files below
 *   site/_routes.json                    the only paths that run the edge function; every other path is a static file (free, unlimited)
 *   site/_redirects                      token pictures: a static redirect to the origin, so a page of 20 pictures costs no function runs
 *   site/_headers                        hashed assets cached for a year, and two safe default headers
 * The edge function itself (apps/web/cloudflare/functions) is bundled by wrangler when it deploys.
 *
 * ORIGIN_URL: where the data routes run (default: the Vercel deployment's own address).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'cloudflare/site');
const origin = (process.env.ORIGIN_URL ?? 'https://seeprism.vercel.app').replace(/\/$/, '');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(web, 'dist'), out, { recursive: true });

writeFileSync(join(out, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*', '/badge/*', '/t/*', '/r/*'], exclude: [] }, null, 2) + '\n');

writeFileSync(
  join(out, '_redirects'),
  [
    '# a token picture is content-addressed and cached for a year where it is made: send the browser there',
    `/img/t/* ${origin}/img/t/:splat 302`,
    '',
  ].join('\n'),
);

writeFileSync(
  join(out, '_headers'),
  [
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '',
  ].join('\n'),
);

console.log(`Cloudflare Pages output → ${out} (data routes at ${origin})`);
