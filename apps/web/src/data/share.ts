import type { Address } from 'viem';
import { SITE_HOST, SITE_URL, SHARE_TEXT, reviewerPath, xIntent } from '@prism/core';

/** Where the app lives. */
export const LIVE_URL = SITE_URL;

/** Where an address's public profile lives: /u/name once it has one, else /u/0x…. */
export const profileHref = (address: Address, name?: string | null) => reviewerPath(address, name);

/** Someone's public profile as a link inside a post: seeprism.vercel.app/u/name (or /u/0x…). */
export const profileLink = (address: Address, name?: string | null) => `${SITE_HOST}${profileHref(address, name)}`;

/** Ready-made posts for "Share on X" (the texts live in packages/core/src/site.ts). */
export const SHARE = {
  ...SHARE_TEXT,
  profile: (link: string) => `My honesty rep on @holdprism: ${link}`,
};

export { xIntent };
