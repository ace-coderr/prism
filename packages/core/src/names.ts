/**
 * PRISM usernames (the PrismNames contract): the same rules the contract enforces, plus
 * words the app refuses to send so nobody can pose as vibe/vibe, PRISM, Robinhood or an
 * admin. That blocklist is an app check only; the contract has no owner who could
 * enforce one (see contracts/SECURITY.md).
 */
export const NAME_MIN = 3;
export const NAME_MAX = 20;
const NAME_RE = /^[a-z0-9_]+$/;

/** Words a name may not contain, anywhere (impersonation guard, app-side only). */
export const RESERVED_NAME_PARTS = ['vibevibe', 'vibe_vibe', 'prism', 'admin', 'official', 'robinhood'] as const;

/** What's wrong with `name`, in plain words, or null when it can be claimed. */
export function nameProblem(name: string): string | null {
  if (name.length < NAME_MIN) return `At least ${NAME_MIN} characters.`;
  if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
  if (!NAME_RE.test(name)) return 'Only lowercase letters, numbers and _.';
  const bad = RESERVED_NAME_PARTS.find((w) => name.includes(w));
  if (bad) return `Names can’t contain “${bad}”.`;
  return null;
}

/** "@name" for display. */
export const atName = (name: string) => `@${name}`;
