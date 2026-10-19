import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Address } from 'viem';
import { PRISM_TOKEN, formatScore, reviewPath, scoreColor, tokenPath, type ReviewView } from '@prism/core';
import { LivingGem } from '../components/Gem';
import { SearchBar } from '../components/SearchBar';
import { Stars, StatusPill } from '../components/reviews';
import { Reveal, SectionLabel } from '../components/design';
import { TestEthNote } from '../components/TestEthNote';
import { GuideNote } from '../components/Viber';
import { useFeed } from '../data/api';
import { ago, daysText, plural, repText } from '../data/format';
import { OwnerChip, useProfiles } from '../data/profiles';
import { TokenAvatar } from '../components/token';

const STEPS = [
  { n: '01', title: 'Only holders can review', text: 'You can review a vibe/vibe launch or a test stock only while you hold it. No holders, no reviews.' },
  { n: '02', title: 'Your position is shown', text: 'Every review records how much the reviewer held, so you can see who has skin in the game.' },
  { n: '03', title: 'Sell, and it says SOLD', text: 'Drop below half of the most you’ve held since reviewing (moving tokens out of your wallet counts) and your review says SOLD for everyone, for good. Reviews can’t be deleted.' },
];

export default function Home() {
  const feed = useFeed();
  return (
    <>
      <section className="container-x grid items-center gap-8 pb-10 pt-28 md:pt-36 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
        <div className="min-w-0">
          <SectionLabel>Holder-only reviews · Robinhood Chain Testnet</SectionLabel>
          <h1 className="display mt-6">
            See every launch’s <span className="text-lime">true colors.</span>
          </h1>
          <p className="body-copy mt-6 text-[1.15rem]">Reviews from real holders. Sell after praising, and everyone sees.</p>
          <div className="mt-8 max-w-[640px]">
            <SearchBar />
            <p className="mt-3 text-[13px] text-mist">
              Try a name, a $SYMBOL or paste an address. Or browse the{' '}
              <Link to="/stocks" className="text-white hover:text-lime">
                test stocks
              </Link>{' '}
              and{' '}
              <Link to="/leaderboards" className="text-white hover:text-lime">
                leaderboards
              </Link>
              .
            </p>
          </div>
          {PRISM_TOKEN && (
            <p className="mt-6 text-[14px] text-white/90">
              PRISM’s own token is reviewed here like any other: if its creator sells, it shows.{' '}
              <Link to={tokenPath(PRISM_TOKEN)} className="text-lime hover:underline">
                See $PRISM
              </Link>
            </p>
          )}
        </div>
        <LivingGem facets={feed.data?.gem} loading={feed.isLoading} className="order-first mx-auto w-full max-w-[300px] sm:max-w-[380px] lg:order-none lg:max-w-[480px]" />
      </section>

      <div className="container-x flex flex-col gap-16 pb-24 md:gap-24">
        <TestEthNote />
        <Reveal>
          <section aria-labelledby="how" className="flex flex-col gap-6">
            <SectionLabel>
              <span id="how">How it works</span>
            </SectionLabel>
            <ol className="grid gap-4 md:grid-cols-3">
              {STEPS.map((st) => (
                <li key={st.n} className="card flex flex-col gap-3 p-6">
                  <span className="font-mono text-sm text-lime">{st.n}</span>
                  <p className="font-display text-xl font-bold tracking-[-0.02em]">{st.title}</p>
                  <p className="text-[15px] leading-relaxed text-mist">{st.text}</p>
                </li>
              ))}
            </ol>
            <GuideNote index={0}>
              New here? Find a launch you hold, read what other holders say, and add your own review. Don’t hold anything yet? Buy on vibe/vibe first.
            </GuideNote>
          </section>
        </Reveal>

        {feed.isError ? (
          <GuideNote index={2}>Live reviews aren’t available right now. Search still works; try again in a minute.</GuideNote>
        ) : (
          <div className="grid gap-12 lg:grid-cols-2">
            <Feed title="Latest reviews" loading={feed.isLoading} empty="No reviews yet. Hold a launch? Search it above and be the first to review it.">
              {feed.data?.latest.slice(0, 6).map((r) => <FeedReview key={r.id} review={r} />)}
            </Feed>
            <Feed title="Caught selling" loading={feed.isLoading} empty="Nobody has been caught selling after reviewing. When someone does, it shows up here.">
              {feed.data?.caught.slice(0, 6).map((r) => <FeedReview key={r.id} review={r} caught />)}
            </Feed>
            {/* reviewers who sold are above; this is creators, read from the chain with no reviews needed */}
            {(feed.data?.creatorsSelling.length ?? 0) > 0 && (
              <Feed title="Creators selling their own launch" loading={false} empty="">
                {feed.data!.creatorsSelling.slice(0, 6).map((c) => (
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
            )}
            <Feed title="Top launches by true colors" loading={feed.isLoading} empty="No launch has 3 holders reviewing it yet. Scores show from 3.">
              {feed.data?.topLaunches.slice(0, 6).map((l, i) => (
                <Link key={l.token} to={tokenPath(l.token)} className="card card-hover flex items-center gap-4 p-4">
                  <span className="w-6 font-mono text-sm text-mist">{i + 1}</span>
                  <TokenAvatar token={l.token} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-lg font-bold">${l.symbol}</span>
                    <span className="block truncate text-[12px] text-mist">
                      {plural(l.reviewers, 'holder')} still in{l.sold ? ` · ${l.sold} sold` : ''}
                    </span>
                  </span>
                  <span className="font-display text-3xl font-bold tabular-nums" style={{ color: scoreColor(l.score) }}>
                    {formatScore(l.score)}
                  </span>
                </Link>
              ))}
            </Feed>
            <TopReviewers addresses={feed.data?.topReviewers ?? []} loading={feed.isLoading} />
          </div>
        )}
      </div>
    </>
  );
}

function Feed({ title, loading, empty, children }: { title: string; loading: boolean; empty: string; children?: ReactNode[] | ReactNode }) {
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

function FeedReview({ review, caught = false }: { review: ReviewView; caught?: boolean }) {
  const profile = useProfiles([review.author as Address]).get(review.author.toLowerCase());
  return (
    <Link to={reviewPath(review.id)} className={`card card-hover flex flex-col gap-2 p-4 ${caught ? 'opacity-90' : ''}`}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <OwnerChip address={review.author} profile={profile} size={22} link={false} className="text-[14px] font-bold text-white" />
        <span className="inline-flex items-center gap-1.5 font-mono text-[12px] font-bold text-lime">
          <TokenAvatar token={review.token} size={20} />${review.symbol}
        </span>
        <span className="ml-auto">
          <StatusPill review={review} />
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars rating={review.rating} size={14} />
        <span className="text-[11px] text-mist">
          {caught ? `sold ${daysText(review.days)} after reviewing` : ago(review.postedAt)}
        </span>
        {review.retired && (
          <span
            title="Posted on PRISM’s first contract. Shown as history; it doesn’t count toward scores, honesty rep, badges or leaderboards."
            className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-mist"
          >
            Retired
          </span>
        )}
      </span>
      {review.text && <span className="line-clamp-2 text-[14px] leading-relaxed text-white/85">{review.text}</span>}
    </Link>
  );
}

function TopReviewers({ addresses, loading }: { addresses: Array<{ address: Address; rep: number | null; reviews: number; decided: number }>; loading: boolean }) {
  const profiles = useProfiles(addresses.map((a) => a.address));
  return (
    <Feed title="Top honest reviewers" loading={loading} empty="Honesty rep shows once a reviewer has 3 reviews. Hold what you review for 7 days and it goes up.">
      {addresses.slice(0, 6).map((r, i) => (
        <div key={r.address} className="card flex items-center gap-4 p-4">
          <span className="w-6 font-mono text-sm text-mist">{i + 1}</span>
          <OwnerChip address={r.address} profile={profiles.get(r.address.toLowerCase())} size={28} className="min-w-0 flex-1 font-bold text-white" />
          <span className="text-right">
            <span className="block font-display text-2xl font-bold text-lime">{repText(r.rep)}</span>
            <span className="block text-[11px] text-mist">{plural(r.reviews, 'review')}</span>
          </span>
        </div>
      ))}
    </Feed>
  );
}
