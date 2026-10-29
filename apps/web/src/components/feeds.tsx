import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { tokenPath } from '@prism/core';
import { SectionLabel } from './design';
import { TokenAvatar } from './token';
import type { CreatorSold } from '../data/api';
import { ExampleCreatorCard } from './examples';

/*
 * Home's feed columns: the shell they share, and the chain-only "creators selling" one.
 *
 * That one lives here rather than inline on Home because it is the section that vanished once: it
 * was rendered only when it had rows, so a server that hadn't loaded the published creator watch
 * yet removed the whole thing from the page instead of saying anything. It is always rendered now,
 * and it tells "nothing to show" and "not read yet" apart (creatorsSelling.test.ts holds that in place).
 */

/**
 * A feed column: its label, an optional quiet note under it, then its rows or why there are none.
 * `examples` (labeled example cards) render only under the real empty state, and only once loading
 * is done: with even one real row they are not rendered at all, so they can't sit next to a real entry.
 */
export function Feed({
  title,
  loading,
  empty,
  note,
  examples,
  children,
}: {
  title: string;
  loading: boolean;
  empty: string;
  note?: string | null;
  examples?: ReactNode;
  children?: ReactNode[] | ReactNode;
}) {
  const list = Array.isArray(children) ? children : children ? [children] : [];
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionLabel>{title}</SectionLabel>
      {note && <p className="-mt-2 text-[12px] leading-relaxed text-mist/80">{note}</p>}
      {loading ? (
        <p className="text-sm text-mist">Reading the chain…</p>
      ) : list.length === 0 ? (
        <>
          <p className="rounded-2xl border border-dashed border-white/10 p-5 text-[14px] leading-relaxed text-mist">{empty}</p>
          {examples ? <div className="flex flex-col gap-3">{examples}</div> : null}
        </>
      ) : (
        <div className="flex flex-col gap-3">{list}</div>
      )}
    </section>
  );
}

export const CREATORS_SELLING_TITLE = 'Creators selling their own launch';

/** With no rows, which of the two it is — an empty answer and a missing one are not the same. */
export const creatorsSellingEmpty = (ready: boolean): string =>
  ready
    ? 'No creator of a recent launch has sold most of what they bought. When one does, it shows up here.'
    : 'Reading what recent launches’ creators have done with their own tokens. This section fills in shortly.';

/**
 * How old these lines are, said plainly. They come from a file the scheduled job publishes, which
 * can be hours old, while a launch's own page reads the chain as it is now — so the section says
 * when it was read and where to get the live answer, and says it more bluntly once it is stale.
 */
export function watchAgeNote(updatedAt: number | undefined, now: number = Date.now()): string | null {
  if (!updatedAt) return null; // nothing read yet: the empty state already says so
  const hours = (now - updatedAt * 1000) / 3_600_000;
  if (hours < 0) return null; // a clock disagreeing with ours; say nothing rather than nonsense
  const open = 'open a launch for a live read';
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `As read ${mins} minute${mins === 1 ? '' : 's'} ago · ${open}`;
  }
  const h = Math.round(hours);
  if (hours < 4) return `As read ${h} hour${h === 1 ? '' : 's'} ago · ${open}`;
  const when = hours < 36 ? `${h} hours` : `${Math.round(hours / 24)} days`;
  return `Last read ${when} ago, so a creator may have bought back or sold more since. Open a launch for a live read of the chain.`;
}

/**
 * The launches whose creator has sold most of their own bag, straight from the chain (no reviews
 * needed). `ready` is the server saying whether it had the creator watch when it answered, and
 * `updatedAt` when that watch was published — these lines are as true as that moment, not as now.
 */
export function CreatorsSellingFeed({
  creators,
  ready,
  updatedAt,
  loading = false,
  now,
}: {
  creators?: readonly CreatorSold[];
  ready?: boolean;
  updatedAt?: number;
  loading?: boolean;
  now?: number;
}) {
  return (
    <Feed
      title={CREATORS_SELLING_TITLE}
      loading={loading}
      empty={creatorsSellingEmpty(ready === true)}
      note={(creators?.length ?? 0) > 0 ? watchAgeNote(updatedAt, now) : null}
      // only once the watch has been read and really has nobody in it: "not read yet" isn't empty
      examples={ready === true ? <ExampleCreatorCard /> : null}
    >
      {(creators ?? []).slice(0, 6).map((c) => (
        <Link key={c.token} to={tokenPath(c.token)} className="card card-hover flex flex-col gap-1.5 p-4">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TokenAvatar token={c.token} size={22} />
            <span className="font-mono text-[12px] font-bold text-lime">${c.symbol}</span>
            <span className="truncate text-[13px] text-mist">{c.name}</span>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-gold">Launch X-ray</span>
          </span>
          <span className="text-[13px] leading-relaxed text-white/85">{c.text}</span>
        </Link>
      ))}
    </Feed>
  );
}
