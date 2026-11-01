/**
 * The reads that need the chain, run in the visitor's browser by the server's own code.
 *
 * Loaded on demand (it is the server's market, X-ray, metadata and review-state modules, a separate
 * download), and only when something is opened that needs it. In the browser build './chain',
 * './launchIndex', './metaCache' and './xrayCache' inside the server modules are swapped for the
 * browser versions in ./local (vite.config.ts), so this is the same code that answered requests
 * when there was a server, reading the same public RPC, and it costs the site no CPU.
 */
import type { Address } from 'viem';
import { readLaunchSetup, setupLines, type Launch, type LaunchShardRow, type ReviewableAsset } from '@prism/core';
import { client, json } from './local/chain';
import { floorFor } from '../../server/floors';
import { marketOf } from '../../server/marketData';
import { tokenMeta } from '../../server/tokenMeta';
import { xrayOf } from '../../server/xray';
import handler from '../../server/data';
import { primeAsset, primeIndex } from './local/launchIndex';

export { marketOf, tokenMeta, xrayOf };

type TokenSetup = NonNullable<import('./api').TokenData['setup']>;

/** A token's setup (tax, split, progress) and the smallest position that counts, read now. */
export async function setupAndFloor(asset: ReviewableAsset, launch: Launch | null) {
  const pair = asset.quote?.symbol ?? 'ETH';
  const setup = asset.kind === 'stock' ? ({ kind: 'stock' } as const) : launch ? await readLaunchSetup(client, launch).catch(() => null) : null;
  const floor = await floorFor(asset, launch).catch(() => null);
  return {
    // as the pages have always had it: JSON, where a bigint is a decimal string
    setup: setup ? (JSON.parse(json(setup)) as TokenSetup) : null,
    setupLines: setup ? setupLines(setup, `$${asset.symbol}`, pair) : null,
    floor: floor ? { units: floor.units.toString(), basis: floor.basis } : null,
  };
}

/**
 * One of the server's routes, answered here from the chain: the state of the reviews as of `block`,
 * for the moment after someone posts and the files haven't caught up. `known` are the launches the
 * read needs to know about (every reviewed token's, and the one being looked at).
 */
export async function liveRoute<T>(path: string, known: readonly LaunchShardRow[], stocks: readonly ReviewableAsset[] = []): Promise<T> {
  primeIndex(known);
  for (const s of stocks) primeAsset(s);
  let body = '';
  const res = {
    statusCode: 0,
    setHeader() {},
    end(b?: string) {
      body = b ?? '';
    },
  };
  await handler({ url: path, method: 'GET', headers: {}, socket: {} } as never, res as never);
  if (res.statusCode !== 200) throw new Error((JSON.parse(body || '{}') as { error?: string }).error ?? `HTTP ${res.statusCode}`);
  return JSON.parse(body) as T;
}

export type { Address };
