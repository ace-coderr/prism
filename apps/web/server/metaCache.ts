/**
 * The permanent metadata cache the scheduled job publishes next to the launch index
 * (@prism/core metaCache.ts, META_CACHE_URL): every launch's verified metadata, so /api/meta rarely
 * needs IPFS at all. Loaded on first use, refreshed every half hour; a failed refresh keeps the last
 * good copy. LAUNCH_META_FILE (a local .json.gz) replaces the download for local testing.
 */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { META_CACHE_URL, cachedMeta, decodeMetaCache, type CachedMeta, type MetaCache } from '@prism/core';

const REFRESH_MS = 30 * 60_000;
/** After a failed download (or none published yet), don't try again for this long. */
const RETRY_MS = 5 * 60_000;
/** How long a request waits for a cold download before reading IPFS itself (the download carries on). */
const WAIT_MS = 8_000;

let current: { cache: MetaCache; at: number } | null = null;
let lastTry = 0;
let loading: Promise<MetaCache | null> | null = null;

async function download(): Promise<MetaCache | null> {
  lastTry = Date.now();
  try {
    const file = process.env.LAUNCH_META_FILE;
    let gz: Buffer;
    if (file) gz = await readFile(file);
    else {
      const res = await fetch(META_CACHE_URL, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`metadata cache download failed (${res.status})`);
      gz = Buffer.from(await res.arrayBuffer());
    }
    const cache = decodeMetaCache(JSON.parse(gunzipSync(gz).toString('utf8')));
    if (!cache) throw new Error('the published metadata cache is in a format this code doesn’t read');
    current = { cache, at: Date.now() };
  } catch {
    // keep serving the last good copy
  }
  return current?.cache ?? null;
}

async function loaded(): Promise<MetaCache | null> {
  const due = !current ? Date.now() - lastTry > RETRY_MS : Date.now() - current.at > REFRESH_MS && Date.now() - lastTry > RETRY_MS;
  if (due && !loading) loading = download().finally(() => (loading = null));
  if (current) return current.cache; // a refresh runs in the background
  if (!loading) return null;
  return Promise.race([loading, new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS))]);
}

/** The cached answer for `token`, or null when the cache doesn't have it (or isn't available). */
export async function publishedMeta(token: string): Promise<CachedMeta | null> {
  const cache = await loaded();
  const row = cache?.rows.get(token.toLowerCase());
  return row ? cachedMeta(row) : null;
}
