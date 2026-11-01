/**
 * The tags that make a link to a token or a review preview well on X, Telegram and the rest: the
 * page's own title, description and share image put into the app's index.html. Pure string work,
 * shared by the server's page route and the Cloudflare edge, so both say the same thing.
 */
import { escapeXml } from './brand';
import { SITE_URL, formatScore } from './site';
import { replaceLiteral } from './text';

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  image: string;
}

/** Replace a meta tag's content (by property or name). */
function setMeta(page: string, key: string, value: string): string {
  const re = new RegExp(`(<meta (?:property|name)="${key.replace(/[:.]/g, '\$&')}" content=")[^"]*(")`);
  // a replacer function: `$&`, `$'`, `$1`… in untrusted text must stay literal
  return page.replace(re, (_, open: string, close: string) => `${open}${escapeXml(value)}${close}`);
}

export function withMeta(page: string, m: PageMeta): string {
  let out = replaceLiteral(page, /<title>[^<]*<\/title>/, `<title>${escapeXml(m.title)}</title>`);
  const url = `${SITE_URL}${m.path}`;
  for (const [k, v] of [
    ['description', m.description],
    ['og:title', m.title],
    ['og:description', m.description],
    ['og:url', url],
    ['og:image', m.image],
    ['og:image:type', m.image.endsWith('.png') ? 'image/png' : 'image/jpeg'],
    ['og:image:alt', m.title],
    ['twitter:title', m.title],
    ['twitter:description', m.description],
    ['twitter:image', m.image],
    ['twitter:image:alt', m.title],
  ] as const) {
    out = setMeta(out, k, v);
  }
  return out;
}

/** A token's page: its score when it has one, else what it is. */
export function tokenPageMeta(t: { asset: { token: string; symbol: string; name: string }; score: { score: number | null; reviewers: number } }, image: string): PageMeta {
  const sym = `$${t.asset.symbol}`;
  return {
    title: t.score.score === null ? `${sym} on PRISM: reviews from real holders` : `${sym} true colors: ${formatScore(t.score.score)} from ${t.score.reviewers} holders · PRISM`,
    description: `What ${sym} (${t.asset.name}) holders really think. Only holders can review, and if they sell, it shows.`,
    path: `/t/${t.asset.token}`,
    image,
  };
}

/** A review's page: its rating and words. */
export function reviewPageMeta(v: { id: number; rating: number; symbol: string; text: string; state: { kind: string } }, image: string): PageMeta {
  const verb = v.state.kind === 'sold' ? 'sold' : 'holds';
  return {
    title: `A ${v.rating}-star review of $${v.symbol} by someone who ${verb} it · PRISM`,
    description: v.text ? `“${v.text}”` : `Rated ${v.rating} of 5 by a $${v.symbol} holder.`,
    path: `/r/${v.id}`,
    image,
  };
}
