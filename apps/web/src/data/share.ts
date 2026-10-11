import type { Address } from 'viem';

/** Where the app lives. */
export const LIVE_URL = 'https://seeprism.vercel.app';

/** Where an address's public profile lives: /u/name once it has one, else /u/0x…. */
export const profileHref = (address: Address, name?: string | null) => `/u/${name ?? address}`;

/** The site as people type it in a post (no https://; X links it anyway). */
const SITE = LIVE_URL.replace(/^https?:\/\//, '');

/** Someone's public profile as a link inside a post: seeprism.vercel.app/u/name (or /u/0x…). */
export const profileLink = (address: Address, name?: string | null) => `${SITE}${profileHref(address, name)}`;

/** Ready-made posts for "Share on X". */
export const SHARE = {
  profile: (link: string) => `My PRISM profile: ${link}  @holdprism`,
};

/** X's post composer with the text filled in: no login on our side, no API. */
export const xIntent = (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
