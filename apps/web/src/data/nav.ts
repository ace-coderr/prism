/*
 * Way-finding on deep pages (a profile, later a token or a review), which people often open
 * straight from a link on X: where "← Back" goes, and the breadcrumb.
 */

/**
 * "← Back": one step back when this visit already has a PRISM page behind it, else Home.
 * React Router keeps the position in this tab's history as `idx` in history.state: 0 is the
 * page the visitor landed on (from a shared link, a bookmark, a new tab).
 */
export function backTarget(historyState: unknown): -1 | '/' {
  const idx = (historyState as { idx?: unknown } | null | undefined)?.idx;
  return typeof idx === 'number' && idx > 0 ? -1 : '/';
}

export interface Crumb {
  label: string;
  to: string;
}

/** Home / @name (or the short address), for a public profile. */
export const profileCrumbs = (label: string, to: string): Crumb[] => [
  { label: 'Home', to: '/' },
  { label, to },
];
