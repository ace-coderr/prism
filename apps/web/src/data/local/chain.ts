/**
 * The browser's version of server/chain.ts (the build swaps it in for the client only): the same
 * read-only RPC clients, from the chain's public RPC. The server modules the browser runs
 * (market, X-ray, metadata, a live read of the reviews) import './chain' and get these.
 */
import { createPublicClient, http, type PublicClient } from 'viem';
import { robinhoodChainMainnet, robinhoodChainTestnet } from '@prism/core';

export const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(undefined, { batch: { batchSize: 20 }, retryCount: 3, retryDelay: 300 }),
}) as PublicClient;

export const mainnetClient = createPublicClient({
  chain: robinhoodChainMainnet,
  transport: http(undefined, { retryCount: 2, retryDelay: 300, timeout: 10_000 }),
}) as PublicClient;

/** JSON with bigints as decimal strings. */
export const json = (body: unknown) => JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
