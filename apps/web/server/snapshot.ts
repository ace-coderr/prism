/**
 * GET /api/snapshot: the Home snapshot, read from Robinhood Chain Testnet server-side
 * (public RPC, read-only, JSON-RPC batches of at most 20) and cached by Vercel's CDN
 * for 5 minutes, then served stale for up to 10 more while it refreshes.
 * Packaged as a Vercel function by scripts/vercel-output.mjs; served by Vite in dev.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPublicClient, http, type PublicClient } from 'viem';
import { buildSnapshot, getDeployment, robinhoodChainTestnet } from '@prism/core';

const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { batch: { batchSize: 20 }, retryCount: 3, retryDelay: 300 }),
}) as PublicClient;

export const CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, HEAD');
    res.end();
    return;
  }
  try {
    const snapshot = await buildSnapshot(client, getDeployment(robinhoodChainTestnet.id));
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', CACHE_CONTROL);
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(snapshot));
  } catch (e) {
    // never cache a failure; the app falls back to reading the chain itself
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: 'Could not read the chain right now.', detail: String((e as Error).message ?? e).split('\n')[0] }));
  }
}
