import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** The API routes (server/routes.json, shared with scripts/vercel-output.mjs). */
interface ApiRoute {
  /** e.g. /api/launches */
  path: string;
  /** e.g. server/launches.ts: its default export is a Node (req, res) handler */
  source: string;
  /** seconds the dev server keeps a 200 response, standing in for the CDN cache */
  cacheSeconds: number;
  maxDuration: number;
}
const API_ROUTES = JSON.parse(readFileSync(new URL('./server/routes.json', import.meta.url), 'utf8')) as ApiRoute[];

/**
 * Dev only: serve each API route from its server/*.ts handler, as Vercel does in production,
 * with an in-memory copy per URL standing in for the CDN cache; any other /api/* path gets
 * server/notFound.ts's 404 (not the SPA's index.html), as in production.
 */
function api(): Plugin {
  const cache = new Map<string, { at: number; body: string; headers: Record<string, string> }>();
  return {
    name: 'prism-api',
    configureServer(server) {
      for (const route of API_ROUTES) {
        server.middlewares.use(route.path, async (req, res, next) => {
          // exact path only (connect matches prefixes): /api/x/y is a 404, as on Vercel
          if (req.url && !/^\/?(\?|$)/.test(req.url)) return next();
          const key = `${route.path}${req.url ?? ''}`;
          const hit = cache.get(key);
          if (hit && Date.now() - hit.at < route.cacheSeconds * 1000) {
            for (const [k, v] of Object.entries(hit.headers)) res.setHeader(k, v);
            res.end(hit.body);
            return;
          }
          const mod = await server.ssrLoadModule(`/${route.source}`);
          const headers: Record<string, string> = {};
          const setHeader = res.setHeader.bind(res);
          res.setHeader = (k: string, v: number | string | readonly string[]) => {
            headers[k] = String(v);
            return setHeader(k, v);
          };
          const end = res.end.bind(res);
          res.end = ((body?: string) => {
            if (res.statusCode === 200 && typeof body === 'string') cache.set(key, { at: Date.now(), body, headers });
            return end(body);
          }) as typeof res.end;
          await mod.default(req, res);
        });
      }
      server.middlewares.use('/api', async (req, res) => {
        const mod = await server.ssrLoadModule('/server/notFound.ts');
        mod.default(req, res);
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
