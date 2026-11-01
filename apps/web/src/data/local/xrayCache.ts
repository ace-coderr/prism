/**
 * The browser's version of server/xrayCache.ts. The creator watch is a 1.9 MB file the job
 * publishes for the server's feed and flags; the browser gets those finished (feed.json, flags.json)
 * and reads a launch's own history for its X-ray, so it never needs the watch itself.
 */
import type { XrayCache } from '@prism/core';

export async function creatorWatch(): Promise<XrayCache | null> {
  return null;
}
