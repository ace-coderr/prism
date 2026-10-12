import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Address } from 'viem';
import { MIN_LEADERBOARD_REVIEWS, MIN_SCORE_REVIEWERS, formatScore, scoreColor, tokenPath } from '@prism/core';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { GuideNote } from '../components/Viber';
import { useLeaderboards } from '../data/api';
import { plural, repText } from '../data/format';
import { OwnerChip, useProfiles } from '../data/profiles';
import { MarketLine, TokenAvatar } from '../components/token';

const TABS = [
  { id: 'launches', label: 'Launches', note: `By true colors, from at least ${MIN_SCORE_REVIEWERS} holders still in.` },
  { id: 'reviewers', label: 'Reviewers', note: `By honesty rep, from at least ${MIN_LEADERBOARD_REVIEWS} reviews.` },
  { id: 'keepers', label: 'Truth keepers', note: 'People who made sales permanent with “Make it permanent”.' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default function Leaderboards() {
  const q = useLeaderboards();
  const [tab, setTab] = useState<Tab>('launches');
  const people = [...(q.data?.reviewers ?? []), ...(q.data?.truthKeepers ?? [])].map((r) => r.address as Address);
  const profiles = useProfiles(people);
  const active = TABS.find((t) => t.id === tab)!;
  return (
    <PageScroll>
      <PageHeader label="Leaderboards" lead="Who’s really" accent="holding." subtitle="The best-rated launches by people still holding them, the most honest reviewers, and those who keep everyone honest." />
      <div className="flex flex-col gap-5">
        <div role="tablist" aria-label="Leaderboards" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition ${
                tab === t.id ? 'border-lime bg-lime/10 text-lime' : 'border-white/15 text-mist hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-mist">{active.note}</p>
        {q.isError ? (
          <GuideNote index={2}>Leaderboards aren’t available right now. Try again in a minute.</GuideNote>
        ) : !q.data ? (
          <p className="text-mist">Reading the chain…</p>
        ) : tab === 'launches' ? (
          q.data.launches.length === 0 ? (
            <GuideNote index={3}>No launch has {MIN_SCORE_REVIEWERS} holders reviewing it yet. Hold one? Review it and ask other holders to do the same.</GuideNote>
          ) : (
            <ol className="flex flex-col gap-3">
              {q.data.launches.map((l, i) => (
                <li key={l.token}>
                  <Link to={tokenPath(l.token)} className="card card-hover flex items-center gap-4 p-4">
                    <span className="w-8 font-mono text-sm text-mist">{i + 1}</span>
                    <TokenAvatar token={l.token} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-lg font-bold">${l.symbol}</span>
                      <span className="block truncate text-[12px] text-mist">
                        {l.name} · {plural(l.reviewers, 'holder')} still in{l.sold ? ` · ${l.sold} sold` : ''}
                      </span>
                      <MarketLine token={l.token} className="block truncate text-[12px] text-mist" />
                    </span>
                    <span className="font-display text-3xl font-bold tabular-nums" style={{ color: scoreColor(l.score) }}>
                      {formatScore(l.score)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )
        ) : (
          (() => {
            const list = tab === 'reviewers' ? q.data.reviewers : q.data.truthKeepers;
            if (list.length === 0) {
              return (
                <GuideNote index={3}>
                  {tab === 'reviewers'
                    ? `Nobody has ${MIN_LEADERBOARD_REVIEWS} reviews yet. Review what you hold, keep holding, and your rep climbs.`
                    : 'Nobody has made a sale permanent yet. When a reviewer sells, “Make it permanent” shows on their review.'}
                </GuideNote>
              );
            }
            return (
              <ol className="flex flex-col gap-3">
                {list.map((r, i) => (
                  <li key={r.address} className="card flex items-center gap-4 p-4">
                    <span className="w-8 font-mono text-sm text-mist">{i + 1}</span>
                    <OwnerChip address={r.address} profile={profiles.get(r.address.toLowerCase())} size={28} className="min-w-0 flex-1 font-bold text-white" />
                    <span className="text-right">
                      <span className="block font-display text-2xl font-bold text-lime">{tab === 'reviewers' ? repText(r.rep) : r.marks}</span>
                      <span className="block text-[11px] text-mist">{tab === 'reviewers' ? plural(r.reviews, 'review') : plural(r.marks, 'sale') + ' made permanent'}</span>
                    </span>
                  </li>
                ))}
              </ol>
            );
          })()
        )}
      </div>
    </PageScroll>
  );
}
