/**
 * Site-wide settings and links, shared by the app, the server functions and the share images.
 */
import type { Address } from 'viem';

/** The one address of the site. */
export const SITE_URL = 'https://seeprism.xyz';
/** The site as people type it in a post (no https://; X links it anyway). */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');
export const X_HANDLE = 'holdprism';

/**
 * $PRISM, PRISM's own token on vibe/vibe (launch #25546, from one of PRISM's own wallets). The navbar
 * and footer link to its page here and Home says it is reviewed like any other token. Null would
 * hide all of that; it is read from the chain like every other launch and has no special treatment
 * beyond the owner wallets' reviews being labelled "Creator" (see reviewState.ts).
 */
export const PRISM_TOKEN: Address | null = '0x56C3044E212168C8D6517Cc09b0050F5C26aDaCF';

/**
 * Tokens whose picture and description PRISM won't show (lower- or mixed-case addresses), for
 * anything abusive. Their reviews, scores and market data still show; the identicon replaces the
 * picture. Empty unless needed.
 */
export const TOKEN_HIDE: readonly string[] = [];

/**
 * PRISM's vibe/vibe invite. vibe/vibe's web app reads `ref` and `refWallet` on every page it serves
 * (its referral handler wraps all routes, /token/:address included), so "Buy on vibe/vibe" links
 * carry them.
 */
export const VIBE_REFERRAL = {
  app: 'https://testnet.vibevibe.fun',
  ref: '_ace_won',
  refWallet: 'VV1-ETAM4H6SGFH3U6ESHPQCRJEPTJ87WL92',
  /** PRISM's own wallets, never referred to themselves: the owner's, and the one $PRISM launches from */
  owners: ['0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e', '0x7Ed162246748A218E0404542683eeE0FC08fE4bD'] as readonly Address[],
} as const;

const OWNERS: ReadonlySet<string> = new Set(VIBE_REFERRAL.owners.map((a) => a.toLowerCase()));
const isOwner = (viewer?: string | null) => !!viewer && OWNERS.has(viewer.toLowerCase());
const refParams = () => `ref=${encodeURIComponent(VIBE_REFERRAL.ref)}&refWallet=${encodeURIComponent(VIBE_REFERRAL.refWallet)}`;

/** A token's page on vibe/vibe, with PRISM's invite unless the viewer is one of PRISM's own wallets. */
export function vibeTokenUrl(token: Address, viewer?: string | null): string {
  const base = `${VIBE_REFERRAL.app}/token/${token}`;
  return isOwner(viewer) ? base : `${base}?${refParams()}`;
}

// ------------------------------------------------------------------ links on PRISM

export const tokenPath = (token: Address | string) => `/t/${token}`;
export const reviewPath = (id: number | bigint) => `/r/${id}`;
export const reviewerPath = (address: string, name?: string | null) => `/u/${name ?? address}`;
export const badgePath = (token: Address | string) => `/badge/${token}.svg`;
/** A token's picture, small and square (the identicon when it has none): served by apps/web/server/img.ts. */
export const tokenImagePath = (token: Address | string, size: 48 | 96 | 192 | 384 = 96) => `/img/t/${token}.png?s=${size}`;

/** "$SYM" for a post, with no space or $ doubling. */
export const cashtag = (symbol: string) => `$${symbol.replace(/^\$/, '').replace(/\s+/g, '')}`;

/** Score with one decimal ("4.2"). */
export const formatScore = (score: number) => (Math.round(score * 10) / 10).toFixed(1);

export const SHARE_TEXT = {
  /** after posting, or from a review's own page */
  review: (symbol: string, rating: number, id: number | bigint) =>
    `I hold ${cashtag(symbol)} and gave it ★${rating} on @${X_HANDLE}. If I sell, it'll say SOLD 👀 ${SITE_HOST}${reviewPath(id)}`,
  /** a launch's score (only once it has one) */
  launch: (symbol: string, score: number, holders: number, token: Address | string) =>
    `${cashtag(symbol)} true colors: ${formatScore(score)} from ${holders} holder${holders === 1 ? '' : 's'} who ${holders === 1 ? 'is' : 'are'} still in. ${SITE_HOST}${tokenPath(token)} @${X_HANDLE}`,
  /** a launch without a score yet */
  launchNoScore: (symbol: string, token: Address | string) =>
    `What do ${cashtag(symbol)} holders really think? Only holders can review it, and sellers get marked SOLD. ${SITE_HOST}${tokenPath(token)} @${X_HANDLE}`,
  /** a creator asking their holders */
  askHolders: (symbol: string, token: Address | string) =>
    `Holding ${cashtag(symbol)}? Leave an honest review on @${X_HANDLE}: only holders can post, and it shows if you sell. ${SITE_HOST}${tokenPath(token)}`,
  profile: (address: string, name?: string | null) => `My honesty rep on @${X_HANDLE}: ${SITE_HOST}${reviewerPath(address, name)}`,
};

/** X's post composer with the text filled in: no login on our side, no API. */
export const xIntent = (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
