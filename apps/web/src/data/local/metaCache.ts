/**
 * The browser's version of server/metaCache.ts: a launch's verified metadata from the file the job
 * published for its address (m/<xx>.json, about 15 KB), instead of the whole 3.8 MB cache.
 */
import { cachedMeta, launchShardKey, type CachedMeta } from '@prism/core';

type Row = Parameters<typeof cachedMeta>[0];
const files = new Map<string, Promise<Map<string, Row> | null>>();

function fileFor(key: string): Promise<Map<string, Row> | null> {
  let p = files.get(key);
  if (!p) {
    p = fetch(`/data/m/${key}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Row[]>) : null))
      .then((rows) => (rows ? new Map(rows.map((row) => [String(row[0]).toLowerCase(), row])) : null))
      .catch(() => null);
    files.set(key, p);
  }
  return p;
}

/** The cached answer for `token`, or null when the file doesn't have it (then the browser reads IPFS itself). */
export async function publishedMeta(token: string): Promise<CachedMeta | null> {
  const row = (await fileFor(launchShardKey(token)))?.get(token.toLowerCase());
  return row ? cachedMeta(row) : null;
}
