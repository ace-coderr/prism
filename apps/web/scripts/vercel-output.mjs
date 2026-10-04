/**
 * Writes Vercel's Build Output (v3) at the repo root, after `vite build`:
 *   .vercel/output/static/                     the site (apps/web/dist)
 *   .vercel/output/functions/api/snapshot.func the /api/snapshot Node function (one bundled file)
 *   .vercel/output/functions/api/not-found.func a JSON 404 for every other /api/* path
 *   .vercel/output/config.json                 routes: files and functions, unknown /api/* → 404, then the SPA
 * Bundling the function ourselves (esbuild) keeps the shared TypeScript in packages/core
 * working on the server exactly as it does in the browser.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(web, '../../.vercel/output');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'static'), { recursive: true });
cpSync(join(web, 'dist'), join(out, 'static'), { recursive: true });

/** Bundles one server/*.ts handler into a Node function at functions/<route>.func. */
async function fn(route, source, maxDuration) {
  const dir = join(out, `functions/${route}.func`);
  await build({
    entryPoints: [join(web, source)],
    outfile: join(dir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // some dependencies still call require(); give the ESM bundle one
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning',
  });
  writeFileSync(
    join(dir, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration }, null, 2),
  );
}

await fn('api/snapshot', 'server/snapshot.ts', 60);
await fn('api/not-found', 'server/notFound.ts', 5);
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: 'filesystem' },
        // a missed /api/* path gets a real 404 from a function, never the SPA's index.html
        { src: '^/api(?:/.*)?$', dest: '/api/not-found' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel build output → ${out}`);
