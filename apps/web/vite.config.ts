import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Server functions and the routes to them (server/routes.json, shared with scripts/vercel-output.mjs). */
interface RouteTable {
  /** name → /api/<name>, served by `source` (its default export is a Node (req, res) handler) */
  functions: Array<{ name: string; source: string; maxDuration: number; assets?: string[] }>;
  /** `src` regex on the path → `dest` (with $1, $2 … from the match); devSkip: production only; bots: only for link-preview crawlers */
  routes: Array<{ src: string; dest: string; devSkip?: boolean; bots?: boolean }>;
}
const TABLE = JSON.parse(readFileSync(new URL('./server/routes.json', import.meta.url), 'utf8')) as RouteTable;

/**
 * Dev only: route requests to the server/*.ts handlers as Vercel does in production (same table);
 * any other /api/* path gets server/notFound.ts's 404 (not the SPA's index.html), as in production.
 */
function api(): Plugin {
  return {
    name: 'prism-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        let target: URL | null = null;
        for (const r of TABLE.routes) {
          if (r.devSkip) continue;
          const m = new RegExp(r.src).exec(url.pathname);
          if (!m) continue;
          target = new URL(r.dest.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? ''), 'http://localhost');
          break;
        }
        if (!target && /^\/api\/[^/]+$/.test(url.pathname)) target = new URL(url.pathname, 'http://localhost');
        const fn = target && TABLE.functions.find((f) => target!.pathname === `/api/${f.name}`);
        if (!fn) {
          if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
            const mod = await server.ssrLoadModule('/server/notFound.ts');
            return mod.default(req, res);
          }
          return next();
        }
        // the original query, plus what the route adds
        for (const [k, v] of url.searchParams) if (!target!.searchParams.has(k)) target!.searchParams.set(k, v);
        req.url = `${target!.pathname}${target!.search}`;
        const mod = await server.ssrLoadModule(`/${fn.source}`);
        await mod.default(req, res);
      });
    },
  };
}

/**
 * The server's data modules run in the browser too (src/data/live.ts). Four of them read Node-only
 * things (the filesystem, zlib, process.env, a 24 MB download); in the browser build their imports
 * of './chain', './launchIndex', './metaCache' and './xrayCache' are replaced by src/data/local/*,
 * which read the same data from the published files and the public RPC. The server build, the dev
 * server and the tests are not touched: this applies to the client environment only.
 */
function browserServer(): Plugin {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return {
    name: 'prism-browser-server',
    enforce: 'pre',
    /** Dev only: serve /data/* from the files scripts/build-site-data.ts wrote, as Cloudflare Pages does. */
    configureServer(server) {
      const dir = resolve(process.env.PRISM_DATA_DIR || join(here, 'cloudflare/data'));
      server.middlewares.use('/data', (req, res, next) => {
        const file = join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]!));
        if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', file.endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
    resolveId(source, importer) {
      if (!importer || this.environment?.name !== 'client') return null;
      const m = /^\.\/(chain|launchIndex|metaCache|xrayCache)$/.exec(source);
      if (!m || !importer.split('\\').join('/').includes('/apps/web/server/')) return null;
      return `${here}src/data/local/${m[1]}.ts`;
    },
  };
}

export default defineConfig({
  plugins: [browserServer(), react(), tailwindcss(), api()],
  server: { port: 5173 },
  build: {
    // privy (1.8 MB) is a big vendor chunk on purpose; warn about anything bigger
    chunkSizeWarningLimit: 1900,
    rollupOptions: {
      output: {
        manualChunks: {
          // login + embedded wallets: big and rarely updated, so cached on its own
          privy: ['@privy-io/react-auth', '@privy-io/wagmi'],
        },
      },
    },
  },
});
