import { Link, useParams } from 'react-router-dom';
import type { Address } from 'viem';
import { SHARE_TEXT, explorerTx, reviewPath, tokenPath } from '@prism/core';
import { DeepNav } from '../components/DeepNav';
import { PageScroll } from '../components/PageHeader';
import { ReviewCard, ScoreBlock } from '../components/reviews';
import { ShareOnX } from '../components/ShareOnX';
import { SectionLabel } from '../components/design';
import { GuideNote } from '../components/Viber';
import { BuyOnVibe } from '../components/vibe';
import { useReview } from '../data/api';
import { dateText } from '../data/format';
import { useProfiles } from '../data/profiles';

/** /r/:id: one review, shareable: the review, its token's score and the author's history with it. */
export default function ReviewPage() {
  const { id = '' } = useParams();
  const valid = /^\d+$/.test(id);
  const q = useReview(valid ? id : undefined);
  const r = q.data?.review;
  const profiles = useProfiles([...(q.data?.history ?? []).map((v) => v.author as Address)]);
  const crumbs = [
    { label: 'Home', to: '/' },
    ...(r ? [{ label: `$${r.symbol}`, to: tokenPath(r.token) }] : []),
    { label: `Review #${id}`, to: `/r/${id}` },
  ];
  return (
    <PageScroll>
      <DeepNav crumbs={crumbs} />
      {!valid || q.isError ? (
        <GuideNote index={2}>{q.error?.status === 404 || !valid ? `There is no review #${id}.` : 'Couldn’t load this review right now. Try again in a minute.'}</GuideNote>
      ) : !q.data || !r ? (
        <p className="text-mist">Reading the chain…</p>
      ) : (
        <>
          <header className="flex flex-col gap-3">
            <SectionLabel>Review #{r.id}</SectionLabel>
            <h1 className="display-md">
              A review of{' '}
              <Link to={tokenPath(r.token)} className="text-lime hover:underline">
                ${r.symbol}
              </Link>
            </h1>
            <p className="text-[14px] text-mist">
              Posted {dateText(r.postedAt)} by someone holding ${r.symbol}.
              {r.txHash && (
                <>
                  {' '}
                  <a href={explorerTx(r.txHash)} target="_blank" rel="noreferrer" className="hover:text-lime">
                    See it on-chain ↗
                  </a>
                </>
              )}
            </p>
          </header>
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <ReviewCard review={r} profile={profiles.get(r.author.toLowerCase())} showToken />
            <div className="flex flex-col gap-6">
              <ScoreBlock score={q.data.score} symbol={r.symbol} />
              <div className="flex flex-wrap gap-3">
                <ShareOnX text={SHARE_TEXT.review(r.symbol, r.rating, r.id)} label="Share this review" />
                <Link to={tokenPath(r.token)} className="btn btn-outline">
                  All ${r.symbol} reviews
                </Link>
              </div>
              <BuyOnVibe token={r.token} className="btn btn-outline" />
            </div>
          </div>
          {q.data.history.length > 1 && (
            <section className="flex flex-col gap-4">
              <SectionLabel>This author’s reviews of ${r.symbol}, newest first</SectionLabel>
              <div className="grid gap-4 md:grid-cols-2">
                {q.data.history
                  .filter((v) => v.id !== r.id)
                  .map((v) => (
                    <ReviewCard key={v.id} review={v} profile={profiles.get(v.author.toLowerCase())} />
                  ))}
              </div>
            </section>
          )}
        </>
      )}
    </PageScroll>
  );
}
