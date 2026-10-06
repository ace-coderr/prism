import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev only: serve /api/snapshot from server/snapshot.ts, as Vercel does in production,
 * with a 5-minute in-memory copy standing in for the CDN cache; any other /api/* path
 * gets server/notFound.ts's 404 (not the SPA's index.html), as in production.
 */
function snapshotApi(): Plugin {
  let cached: { at: number; body: string; headers: Record<string, string> } | null = null;
  return {
    name: 'prism-snapshot-api',
    configureServer(server) {
      server.middlewares.use('/api/snapshot', async (req, res, next) => {
        // exact path only (connect matches prefixes): /api/snapshot/x is a 404, as on Vercel
        if (req.url && !/^\/?(\?|$)/.test(req.url)) return next();
        if (cached && Date.now() - cached.at < 300_000) {
          for (const [k, v] of Object.entries(cached.headers)) res.setHeader(k, v);
          res.end(cached.body);
          return;
        }
        const mod = await server.ssrLoadModule('/server/snapshot.ts');
        const headers: Record<string, string> = {};
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (k: string, v: number | string | readonly string[]) => {
          headers[k] = String(v);
          return setHeader(k, v);
        };
        const end = res.end.bind(res);
        res.end = ((body?: string) => {
          if (res.statusCode === 200 && typeof body === 'string') cached = { at: Date.now(), body, headers };
          return end(body);
        }) as typeof res.end;
        await mod.default(req, res);
      });
      server.middlewares.use('/api', async (req, res) => {
        const mod = await server.ssrLoadModule('/server/notFound.ts');
        mod.default(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), snapshotApi()],
  server: { port: 5173 },
  build: {
    // three (1.2 MB) and privy (1.8 MB) are big vendor chunks on purpose; warn about anything bigger
    chunkSizeWarningLimit: 1900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
          // login + embedded wallets: big and rarely updated, so cached on its own
          privy: ['@privy-io/react-auth', '@privy-io/wagmi'],
        },
      },
    },
  },
});
