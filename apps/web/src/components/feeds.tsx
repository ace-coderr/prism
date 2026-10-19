import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { tokenPath } from '@prism/core';
import { SectionLabel } from './design';
import { TokenAvatar } from './token';
import type { CreatorSold } from '../data/api';

/*
 * Home's feed columns: the shell they share, and the chain-only "creators selling" one.
 *
 * That one lives here rather than inline on Home because it is the section that vanished once: it
 * was rendered only when it had rows, so a server that hadn't loaded the published creator watch
 * yet removed the whole thing from the page instead of saying anything. It is always rendered now,
 * and it tells "nothing to show" and "not read yet" apart (feeds.test.ts holds that in place).
 */

/** A feed column: its label, then its rows, or one line saying why there are none. */
export function Feed({ title, loading, empty, children }: { title: string; loading: boolean; empty: string; children?: ReactNode[] | ReactNode }) {
  const list = Array.isArray(children) ? children : children ? [children] : [];
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionLabel>{title}</SectionLabel>
      {loading ? (
        <p className="text-sm text-mist">Reading the chain…</p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 p-5 text-[14px] leading-relaxed text-mist">{empty}</p>
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
 * The launches whose creator has sold most of their own bag, straight from the chain (no reviews
 * needed). `ready` is the server saying whether it had the creator watch when it answered.
 */
export function CreatorsSellingFeed({ creators, ready, loading = false }: { creators?: readonly CreatorSold[]; ready?: boolean; loading?: boolean }) {
  return (
    <Feed title={CREATORS_SELLING_TITLE} loading={loading} empty={creatorsSellingEmpty(ready === true)}>
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
