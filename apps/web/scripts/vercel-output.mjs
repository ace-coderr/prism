/**
 * Writes Vercel's Build Output (v3) at the repo root, after `vite build`:
 *   .vercel/output/static/                     the site (apps/web/dist)
 *   .vercel/output/functions/api/snapshot.func the /api/snapshot Node function (one bundled file)
 *   .vercel/output/config.json                 routes: files and functions first, then the SPA
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

const fn = join(out, 'functions/api/snapshot.func');
await build({
  entryPoints: [join(web, 'server/snapshot.ts')],
  outfile: join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // some dependencies still call require(); give the ESM bundle one
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
writeFileSync(
  join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [{ handle: 'filesystem' }, { src: '/api/(.*)', status: 404 }, { src: '/(.*)', dest: '/index.html' }],
    },
    null,
    2,
  ),
);
console.log(`Vercel build output → ${out}`);
