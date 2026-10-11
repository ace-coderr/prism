import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Server functions and the routes to them (server/routes.json, shared with scripts/vercel-output.mjs). */
interface RouteTable {
  /** name → /api/<name>, served by `source` (its default export is a Node (req, res) handler) */
  functions: Array<{ name: string; source: string; maxDuration: number; assets?: string[] }>;
  /** `src` regex on the path → `dest` (with $1, $2 … from the match); devSkip: production only */
  routes: Array<{ src: string; dest: string; devSkip?: boolean }>;
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

export default defineConfig({
  plugins: [react(), tailwindcss(), api()],
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
