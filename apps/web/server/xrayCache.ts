/**
 * The creator watch the scheduled job publishes next to the launch index (@prism/core xrayCache.ts).
 * It says what every recent launch's creator has done with their own tokens, so the "creators
 * selling" feed and the flags on cards cost the site nothing: no launch history is read to build them.
 *
 * Loaded on first use and refreshed every half hour; a failed refresh keeps the last good copy.
 * LAUNCH_XRAY_FILE (a local .json.gz) replaces the download for local testing.
 */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { XRAY_CACHE_URL, decodeXrayCache, type WatchedCreator, type XrayCache } from '@prism/core';

const REFRESH_MS = 30 * 60_000;
/** After a failed download (or none published yet), don't try again for this long. */
const RETRY_MS = 5 * 60_000;

let current: { cache: XrayCache; at: number } | null = null;
let lastTry = 0;
let loading: Promise<void> | null = null;

async function download(): Promise<void> {
  lastTry = Date.now();
  try {
    const file = process.env.LAUNCH_XRAY_FILE;
    let gz: Buffer;
    if (file) gz = await readFile(file);
    else {
      const res = await fetch(XRAY_CACHE_URL, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`creator watch download failed (${res.status})`);
      gz = Buffer.from(await res.arrayBuffer());
    }
    const cache = decodeXrayCache(JSON.parse(gunzipSync(gz).toString('utf8')));
    if (!cache) throw new Error('the published creator watch is in a format this code doesn’t read');
    current = { cache, at: Date.now() };
  } catch {
    // keep serving the last good copy
  }
}

/** The watch as it stands; it never waits for a download, so a page is never held up by it. */
export function creatorWatch(): XrayCache | null {
  const due = !current ? Date.now() - lastTry > RETRY_MS : Date.now() - current.at > REFRESH_MS && Date.now() - lastTry > RETRY_MS;
  if (due && !loading) loading = download().finally(() => (loading = null));
  return current?.cache ?? null;
}

/** What the watch knows about one launch's creator, or null. */
export const watchedCreator = (token: string): WatchedCreator | null => creatorWatch()?.byToken.get(token.toLowerCase()) ?? null;
