/**
 * PRISM profiles (the PrismProfiles contract): the same rules the contract enforces, plus
 * words the app refuses to send, so nobody poses as vibe/vibe, PRISM, Robinhood or an admin,
 * and a basic profanity filter. The word lists are an app check only; the contract has no
 * owner who could enforce one (see contracts/SECURITY.md). X handles are never verified.
 */
export const NAME_MIN = 3;
export const NAME_MAX = 20;
export const BIO_MAX_BYTES = 120;
export const X_MAX = 15;
const NAME_RE = /^[a-z0-9_]+$/;
const X_RE = /^[A-Za-z0-9_]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Impersonation guard: names and bios may not contain these (app-side only). */
export const RESERVED_WORDS = ['vibevibe', 'vibe_vibe', 'prism', 'admin', 'official', 'robinhood'] as const;
/** Basic profanity, refused anywhere in a name or bio. */
const PROFANITY_ANYWHERE = ['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'bitch', 'whore', 'slut', 'retard', 'asshole', 'motherf'];
/** Short words refused only as a whole word (so "class", "cocktail" and "grape" stay fine). */
const PROFANITY_WORDS = ['ass', 'cock', 'dick', 'rape', 'porn', 'tits', 'twat', 'wank', 'piss', 'fag', 'dyke', 'nazi', 'kkk'];

/** The first refused word in `text`, or null. Case and separators are ignored. */
export function blockedWord(text: string): string | null {
  const spaced = text.toLowerCase().replace(/[^a-z0-9]+/g, '_'); // "Vibe/Vibe!" → "vibe_vibe_"
  const compact = spaced.replace(/_/g, ''); // "pr_ism" → "prism"
  const reserved = RESERVED_WORDS.find((w) => spaced.includes(w) || compact.includes(w.replace(/_/g, '')));
  if (reserved) return reserved;
  const anywhere = PROFANITY_ANYWHERE.find((w) => spaced.includes(w));
  if (anywhere) return anywhere;
  const words = new Set(text.toLowerCase().split(/[^a-z]+/));
  return PROFANITY_WORDS.find((w) => words.has(w)) ?? null;
}

const refused = (w: string) => (RESERVED_WORDS.includes(w as (typeof RESERVED_WORDS)[number]) ? `“${w}”` : 'that word');

/** What's wrong with `name`, in plain words, or null when it can be claimed. */
export function nameProblem(name: string): string | null {
  if (name.length < NAME_MIN) return `At least ${NAME_MIN} characters.`;
  if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
  if (!NAME_RE.test(name)) return 'Only lowercase letters, numbers and _.';
  const bad = blockedWord(name);
  return bad ? `Names can’t contain ${refused(bad)}.` : null;
}

/** UTF-8 length, which is what the contract counts. */
export const bioBytes = (bio: string) => new TextEncoder().encode(bio).length;

/** What's wrong with `bio`, or null. An empty bio means "no bio". */
export function bioProblem(bio: string): string | null {
  if (bio === '') return null;
  if (bioBytes(bio) > BIO_MAX_BYTES) return `At most ${BIO_MAX_BYTES} bytes (emoji and accents count double or more).`;
  if (CONTROL_RE.test(bio)) return 'One line of text: no line breaks or control characters.';
  const bad = blockedWord(bio);
  return bad ? `Bios can’t contain ${refused(bad)}.` : null;
}

/** An X handle as typed: trims spaces and a leading "@" or x.com link. */
export const normalizeX = (input: string) => input.trim().replace(/^(https?:\/\/)?(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '');

/** What's wrong with an X handle (already normalized), or null. Empty means "no handle". */
export function xProblem(handle: string): string | null {
  if (handle === '') return null;
  if (handle.length > X_MAX) return `At most ${X_MAX} characters.`;
  if (!X_RE.test(handle)) return 'Only letters, numbers and _ (the handle, not a link).';
  return null;
}

/** "@name" for display. */
export const atName = (name: string) => `@${name}`;

/** Link for an (unverified) X handle. */
export const xUrl = (handle: string) => `https://x.com/${encodeURIComponent(handle)}`;
