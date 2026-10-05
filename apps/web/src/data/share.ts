import type { Address } from 'viem';

/** Where the app lives. */
export const LIVE_URL = 'https://prism-crystal.vercel.app';

/** Where an address's public profile lives: /u/name once it has one, else /u/0x…. */
export const profileHref = (address: Address, name?: string | null) => `/u/${name ?? address}`;

/** The site as people type it in a post (no https://; X links it anyway). */
const SITE = LIVE_URL.replace(/^https?:\/\//, '');

/** Someone's public profile as a link inside a post: prism-crystal.vercel.app/u/name (or /u/0x…). */
export const profileLink = (address: Address, name?: string | null) => `${SITE}${profileHref(address, name)}`;

/** Ready-made posts for "Share on X". */
export const SHARE = {
  forged: (link: string) => `I just forged a crystal on @holdprism 🔮 a stock basket you can hold. Built on @vibevibefun · ${link}`,
  profile: (link: string) => `My PRISM profile 🔮 crystals, badges and gold seams: ${link}  @holdprism`,
  badge: (badge: string, link: string) => `Just earned the ${badge} badge on @holdprism 🔮 ${link}`,
  gift: (id: bigint) => `I just gifted a PRISM crystal 🎁🔮 ${SITE}/gift/${id} @holdprism`,
  replay: (id: bigint) => `My PRISM crystal's journey 🔮 ${SITE}/replay/${id} @holdprism`,
};

/** X's post composer with the text filled in: no login on our side, no API. */
export const xIntent = (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
