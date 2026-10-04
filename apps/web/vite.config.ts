import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The vibe/vibe API rejects cross-origin browser requests (HTTP 403), so the app
// reads it through this same-origin proxy (dev + `vite preview`). A static
// production deploy needs an equivalent rewrite, or the app falls back to
// reading prices straight from the Uniswap V4 pools over the public RPC.
const vibeProxy: Record<string, ProxyOptions> = {
  '/vibe-api': {
    target: 'https://testnet.vibevibe.fun',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/vibe-api/, '/api/v1/chains/46630'),
    configure: (proxy) => {
      proxy.on('proxyReq', (req) => {
        req.removeHeader('origin');
        req.removeHeader('referer');
      });
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: vibeProxy },
  preview: { proxy: vibeProxy },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: { manualChunks: { three: ['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'] } },
    },
  },
});
