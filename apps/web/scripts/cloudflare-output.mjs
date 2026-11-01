/**
 * Assembles what Cloudflare Pages deploys, after `vite build` and `scripts/build-site-data.ts`:
 *   apps/web/cloudflare/site/            the app (apps/web/dist), the job's data files (data/), and the routing files below
 *   site/_routes.json                    the only paths that run the edge function; every other path is a static file (free, unlimited)
 *   site/_headers                        how long each kind of file may be kept
 * The edge function itself (apps/web/cloudflare/functions) is bundled by wrangler when it deploys.
 *
 * DATA_DIR: the job's output (default apps/web/cloudflare/data).
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'cloudflare/site');
const data = resolve(process.env.DATA_DIR ?? join(web, 'cloudflare/data'));

if (!existsSync(join(data, 'info.json'))) throw new Error(`No site data in ${data}: run scripts/build-site-data.ts first.`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(web, 'dist'), out, { recursive: true });
cpSync(data, join(out, 'data'), { recursive: true });

// the paths that need the edge function: a crawler's share page, the badge, the share card, and a 404 for the old API
const routes = { version: 1, include: ['/t/*', '/r/*', '/badge/*', '/api/*'], exclude: [] };
writeFileSync(join(out, '_routes.json'), `${JSON.stringify(routes, null, 2)}\n`);

const headers = [
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/data/*',
  '  Cache-Control: public, max-age=120',
  '/data/og/*',
  '  Cache-Control: public, max-age=600',
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '',
];
writeFileSync(join(out, '_headers'), headers.join('\n'));

console.log(`Cloudflare Pages output → ${out} (with the job's data from ${data})`);
