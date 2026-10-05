import type { ReactNode } from 'react';
import type { Address } from 'viem';
import { opensIn } from '@prism/core';
import { OwnerChip, type Profile } from '../data/profiles';

/** A small wrapped-present mark (a ribbon over a box). */
export function GiftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1Zm0 0c1.5-3 5-3 5-1s-3 1-5 1Z" />
    </svg>
  );
}

/**
 * The gift tag: who it's from (or for), the note, and when it opens. Used in the gift
 * form's preview, on a received gift in My Crystals, and on the public /gift page.
 */
export function GiftCard({
  label,
  who,
  profile,
  whoText,
  note,
  noteLoading = false,
  unlock,
  now,
  opened = false,
  children,
}: {
  /** "A gift from" / "A gift for" */
  label: string;
  who?: Address | null;
  profile?: Profile;
  /** shown instead of a chip when there's no address yet (the form, before a recipient) */
  whoText?: string;
  note: string | null;
  noteLoading?: boolean;
  /** unix seconds it opens (0 = not sealed) */
  unlock: number;
  now: number;
  /** already unwrapped (the tag stays, as a keepsake) */
  opened?: boolean;
  children?: ReactNode;
}) {
  const left = unlock > 0 ? opensIn(unlock, now) : null;
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-[#bfe6ff]/35 bg-[linear-gradient(160deg,rgba(214,241,255,0.10),rgba(16,18,20,0.6)_55%)] p-5">
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#bfe6ff]">
        <GiftIcon size={14} />
        {label}
      </p>
      <div className="mt-2 font-display text-xl font-bold text-white">
        {who ? <OwnerChip address={who} profile={profile} size={22} className="text-white" /> : <span className="text-mist">{whoText ?? '…'}</span>}
      </div>
      <p className={`mt-4 break-words text-[15px] leading-relaxed ${note ? 'text-white' : 'text-mist'}`}>
        {noteLoading ? 'Reading the note…' : note ? `“${note}”` : 'No note.'}
      </p>
      <p className={`mt-4 font-mono text-[11px] uppercase tracking-[0.14em] ${left ? 'text-[#bfe6ff]' : opened ? 'text-mist' : 'text-lime'}`}>
        {left ? `❄ ${left}` : opened ? 'Unwrapped' : 'Ready to unwrap'}
      </p>
      {children && <div className="mt-5 flex flex-wrap gap-3">{children}</div>}
    </div>
  );
}
