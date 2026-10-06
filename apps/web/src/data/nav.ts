import type { Address } from 'viem';

/*
 * Way-finding on deep pages (a replay, a gift, a profile), which people often open
 * straight from a link on X: where "← Back" goes, the breadcrumb, and where a crystal lives.
 */

/**
 * "← Back": one step back when this visit already has a PRISM page behind it, else the
 * Gallery. React Router keeps the position in this tab's history as `idx` in history.state:
 * 0 is the page the visitor landed on (from a shared link, a bookmark, a new tab).
 */
export function backTarget(historyState: unknown): -1 | '/gallery' {
  const idx = (historyState as { idx?: unknown } | null | undefined)?.idx;
  return typeof idx === 'number' && idx > 0 ? -1 : '/gallery';
}

/** "View crystal #id": in My Crystals when it's the viewer's own, else its card in the Gallery. */
export function crystalHref(id: bigint, owner?: Address | null, viewer?: Address | null): string {
  return owner && viewer && owner.toLowerCase() === viewer.toLowerCase() ? `/my-crystals?id=${id}` : `/gallery#crystal-${id}`;
}

/** The crystal a `/gallery#crystal-<id>` link points at, if any. */
export function crystalFromHash(hash: string): bigint | null {
  const m = /^#crystal-(\d+)$/.exec(hash);
  return m ? BigInt(m[1]!) : null;
}

export interface Crumb {
  label: string;
  to: string;
}

/** Gallery / Crystal #id / <page>, for a crystal's replay or gift page. */
export function crystalCrumbs(id: bigint | null, page: 'Replay' | 'Gift', crystalTo: string): Crumb[] {
  const here = { label: page, to: id === null ? '/gallery' : `/${page.toLowerCase()}/${id}` };
  return id === null ? [{ label: 'Gallery', to: '/gallery' }, here] : [{ label: 'Gallery', to: '/gallery' }, { label: `Crystal #${id}`, to: crystalTo }, here];
}

/** Gallery / @name (or the short address), for a public profile. */
export const profileCrumbs = (label: string, to: string): Crumb[] => [
  { label: 'Gallery', to: '/gallery' },
  { label, to },
];
