/**
 * Text people wrote (review text, bios, usernames, token names and symbols), made safe to show.
 */

/**
 * Bidi controls (U+202A–U+202E, U+2066–U+2069, and the U+200E/U+200F marks) can make text read
 * differently from what it is ("…evil.com" shown as "moc.live…"); zero-width characters
 * (U+200B–U+200D, U+FEFF) hide differences between look-alike names. Both are removed before
 * anything is shown. Everything else is kept as written.
 */
const HIDDEN = /[​-‏‪-‮⁦-⁩﻿]/g;

export const cleanShown = (s: string): string => s.replace(HIDDEN, '');

/**
 * `String.replace` with a literal replacement: a string replacement would treat `$&`, `$'`, `` $` ``,
 * `$1` and `$$` in untrusted text as patterns (a token named "$1INCH" corrupted the page).
 */
export const replaceLiteral = (s: string, pattern: string | RegExp, value: string): string => s.replace(pattern, () => value);
