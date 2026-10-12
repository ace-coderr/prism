/**
 * Writes Vercel's Build Output (v3) at the repo root, after `vite build`:
 *   .vercel/output/static/                       the site (apps/web/dist)
 *   .vercel/output/functions/api/<name>.func     one Node function per entry in server/routes.json (one bundled
 *                                                file each, plus its assets: the resvg wasm, fonts, the page template)
 *   .vercel/output/functions/api/not-found.func  a JSON 404 for every other /api/* path
 *   .vercel/output/config.json                   routes: files, the rewrites in server/routes.json,
 *                                                unknown /api/* → 404, then the SPA
 * Bundling the functions ourselves (esbuild) keeps the shared TypeScript in packages/core
 * working on the server exactly as it does in the browser.
 */
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(web, '../../.vercel/output');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'static'), { recursive: true });
cpSync(join(web, 'dist'), join(out, 'static'), { recursive: true });

/** Bundles one server/*.ts handler into a Node function at functions/<route>.func. */
async function fn(route, source, maxDuration, assets = []) {
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
  // files the function reads at runtime, next to its index.mjs
  if (assets.includes('wasm')) copyFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'), join(dir, 'index_bg.wasm'));
  if (assets.includes('fonts')) cpSync(join(web, 'server/fonts'), join(dir, 'fonts'), { recursive: true });
  if (assets.includes('webp')) copyFileSync(createRequire(import.meta.url).resolve('@jsquash/webp/codec/dec/webp_dec.wasm'), join(dir, 'webp_dec.wasm'));
  if (assets.includes('html')) copyFileSync(join(web, 'dist/index.html'), join(dir, 'index.html'));
  writeFileSync(
    join(dir, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration }, null, 2),
  );
}

// server/routes.json: { functions: [{ name, source, maxDuration, assets }], routes: [{ src, dest }] }, shared with vite.config.ts
const table = JSON.parse(readFileSync(join(web, 'server/routes.json'), 'utf8'));
for (const f of table.functions) await fn(`api/${f.name}`, f.source, f.maxDuration, f.assets);
await fn('api/not-found', 'server/notFound.ts', 5);
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: 'filesystem' },
        // the site's data, badges, share images and share-ready pages
        ...table.routes.map((r) => ({ src: r.src, dest: r.dest, check: true })),
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
