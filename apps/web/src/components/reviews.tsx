import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Address } from 'viem';
import { simulateContract } from 'wagmi/actions';
import {
  MIN_SCORE_REVIEWERS,
  filterReviews,
  formatScore,
  getDeployment,
  prismReviewsAbi,
  reviewPath,
  scoreColor,
  starPath,
  tokenPath,
  type ReviewFilter,
  type ReviewView,
  type ScoreSummary,
} from '@prism/core';
import { useRefreshReviews } from '../data/api';
import { dateText, daysText, formatShare, formatTokens, noScoreText, repText } from '../data/format';
import { OwnerChip, useProfiles, type Profile } from '../data/profiles';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { StepList, useTxSteps } from '../wallet/steps';
import { SwitchNetworkButton, WalletButton, useWallet } from '../wallet/WalletButton';
import { TokenAvatar } from './token';

export const reviewsContract = () => getDeployment(TARGET_CHAIN.id)?.prismReviews;

// ------------------------------------------------------------------ stars

export function Stars({ rating, size = 16, className = '' }: { rating: number; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} role="img" aria-label={`${rating} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 20 20" width={size} height={size} aria-hidden>
          <path d={starPath(0, 0, 20)} fill={i < rating ? 'var(--color-gold)' : 'var(--color-line)'} />
        </svg>
      ))}
    </span>
  );
}

const STAR_WORDS = ['', 'Bad', 'Weak', 'OK', 'Good', 'Great'];

/** 1–5 stars as radio buttons (keyboard friendly). */
export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Rating" className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={`${v} star${v === 1 ? '' : 's'}: ${STAR_WORDS[v]}`}
            onClick={() => onChange(v)}
            className="grid h-11 w-11 place-items-center rounded-xl transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-lime"
          >
            <svg viewBox="0 0 20 20" width={30} height={30} aria-hidden>
              <path d={starPath(0, 0, 20)} fill={v <= value ? 'var(--color-gold)' : 'var(--color-line)'} />
            </svg>
          </button>
        ))}
      </div>
      <span className="font-mono text-sm text-mist">{value ? `${value} · ${STAR_WORDS[value]}` : 'Pick a rating'}</span>
    </div>
  );
}

// ------------------------------------------------------------------ status

export function StatusPill({ review }: { review: Pick<ReviewView, 'state' | 'days'> }) {
  const s = review.state;
  const [text, cls] =
    s.kind === 'sold'
      ? [s.marked ? 'SOLD' : s.boughtBack ? 'SOLD · bought back' : 'SOLD · not yet permanent', 'bg-down text-ink']
      : s.kind === 'trimmed'
        ? [`Trimmed ${s.percent}%`, 'bg-gold text-ink']
        : s.kind === 'replaced'
          ? ['Replaced', 'bg-line text-mist']
          : ['Holding', 'bg-lime text-ink'];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${cls}`}>{text}</span>;
}

// ------------------------------------------------------------------ score

/** The big true colors number, or "Not enough reviews yet" below 3 holding reviewers. */
export function ScoreBlock({ score, symbol, holders, compact = false }: { score: ScoreSummary; symbol: string; holders?: number | null; compact?: boolean }) {
  if (score.score === null) {
    return (
      <div className={compact ? '' : 'card p-6 md:p-8'}>
        <p className="section-label">True colors</p>
        <p className={`mt-3 font-display font-bold tracking-[-0.03em] text-mist ${compact ? 'text-2xl' : 'text-4xl md:text-5xl'}`}>Not enough reviews yet</p>
        <p className="mt-3 text-[15px] leading-relaxed text-mist">
          {noScoreText(score.reviewers, symbol, holders)}
        </p>
      </div>
    );
  }
  return (
    <div className={compact ? '' : 'card p-6 md:p-8'}>
      <p className="section-label">True colors</p>
      <p className="mt-2 flex items-baseline gap-3">
        <span className={`font-display font-bold tabular-nums tracking-[-0.05em] ${compact ? 'text-5xl' : 'text-7xl md:text-8xl'}`} style={{ color: scoreColor(score.score) }}>
          {formatScore(score.score)}
        </span>
        <span className="font-mono text-sm text-mist">/ 5</span>
      </p>
      <p className="mt-2 text-[15px] text-white">
        From {score.reviewers} holder{score.reviewers === 1 ? '' : 's'} still in{score.sold > 0 ? ` · ${score.sold} who sold don’t count` : ''}.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-mist">
        Ratings from people still holding, weighted by how much they hold (no wallet over 10% once 10 or more count), how long they’ve held and their honesty rep.
        Creators’ own reviews and positions under $1 show but don’t count.
      </p>
      {!compact && <ScoreRules />}
    </div>
  );
}

/** "How the score works", in plain words. */
export function ScoreRules() {
  return (
    <details className="mt-4 border-t border-white/[0.06] pt-3 text-[13px] leading-relaxed text-mist">
      <summary className="cursor-pointer font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-white/80 hover:text-lime">How the score works</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Only holders can review, and only reviewers still holding count.</li>
        <li>
          SOLD means holding less than half of the most you’ve held since your first review of the token. Moving tokens out of your wallet (to another wallet,
          a pool, staking or an exchange) counts as selling, and selling below half then buying back still shows SOLD.
        </li>
        <li>Bigger positions count more; once 10 or more reviewers count, no wallet counts for more than 10%.</li>
        <li>Holding longer counts more (full weight after a week); buying more and updating restarts that clock.</li>
        <li>A good honesty rep counts more: reviewers who keep holding a week after reviewing.</li>
        <li>The creator’s own review and positions worth under $1 show, but don’t count. Reviews of tokens PRISM doesn’t list don’t appear.</li>
        <li>With few reviews the score leans toward a neutral 3, and it shows from 3 reviewers.</li>
      </ul>
    </details>
  );
}

// ------------------------------------------------------------------ one review

/** "Make it permanent": marks a review SOLD on-chain (anyone can, once its author holds less than half). */
export function MarkSoldButton({ review, onDone }: { review: ReviewView; onDone?: () => void }) {
  const { address, isConnected, onTarget } = useWallet();
  const tx = useTxSteps();
  const refresh = useRefreshReviews();
  const contract = reviewsContract();
  if (!contract) return null;
  const mark = async () => {
    let block = 0n;
    const ok = await tx.run([
      {
        label: 'Making the SOLD mark permanent',
        tx: { description: `Mark review #${review.id} of $${review.symbol} as SOLD on-chain: its author now holds less than half of what they reviewed.`, action: 'Make it permanent', contract: 'PrismReviews' },
        send: async (write) => {
          const { request } = await simulateContract(wagmiConfig, { address: contract, abi: prismReviewsAbi, functionName: 'markSold', args: [BigInt(review.id)], chainId: TARGET_CHAIN.id, account: address });
          return write(request);
        },
        after: (receipt) => {
          block = receipt.blockNumber;
        },
      },
    ]);
    if (ok) {
      await refresh({ block, token: review.token, author: review.author, id: review.id });
      onDone?.();
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!isConnected ? (
          <WalletButton />
        ) : !onTarget ? (
          <SwitchNetworkButton />
        ) : (
          <button type="button" className="btn btn-secondary !px-4 !py-2" disabled={tx.running} onClick={() => void mark()}>
            {tx.running ? 'Working…' : 'Make it permanent'}
          </button>
        )}
        <span className="text-[12px] text-mist">Anyone can do this. It counts toward the Truth keeper badge.</span>
      </div>
      <StepList steps={tx.steps} />
    </div>
  );
}

function positionLine(r: ReviewView): string {
  const sold = r.state.kind === 'sold';
  const amount = formatTokens(sold || r.balance === null ? r.baseline : BigInt(r.balance) < BigInt(r.baseline) ? r.balance : r.baseline, r.decimals);
  const share = formatShare(r.supplyShare);
  const held = `${amount} $${r.symbol}${share ? ` (${share} of supply)` : ''}`;
  if (sold && r.state.kind === 'sold' && r.state.boughtBack) return `Held ${held} · sold below half on ${dateText(r.state.boughtBack.at)}, bought back later`;
  if (sold) return `Held ${held} · sold ${daysText(r.days)} after reviewing`;
  if (r.state.kind === 'replaced') return `Held ${held} when reviewing`;
  if (r.state.kind === 'trimmed') return `Holds ${held}, down ${r.state.percent}% · ${daysText(r.days)} holding`;
  return `Holds ${held} · ${daysText(r.days)} holding`;
}

/** Small labels for reviews that show but don't count. */
function CountLabel({ review }: { review: ReviewView }) {
  const label =
    review.excluded === 'creator'
      ? ['Creator', 'The launch’s own creator: shown, but it doesn’t count toward the score or their honesty rep.']
      : review.excluded === 'small'
        ? ['Too small to count', 'Worth less than $1 at the current price: shown, but it doesn’t count toward the score, rep, badges or leaderboards.']
        : review.creator
          ? ['Creator', 'The launch’s own creator.']
          : null;
  if (!label) return null;
  return (
    <span title={label[1]} className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-mist">
      {label[0]}
    </span>
  );
}

export function ReviewCard({ review, profile, showToken = false, footer }: { review: ReviewView; profile?: Profile; showToken?: boolean; footer?: ReactNode }) {
  const { address } = useWallet();
  const sold = review.state.kind === 'sold';
  const boughtBack = review.state.kind === 'sold' && !!review.state.boughtBack;
  // the on-chain mark needs a balance below half now, on the current contract
  const unmarked = review.state.kind === 'sold' && !review.state.marked && !boughtBack && !review.retired;
  const mine = !!address && address.toLowerCase() === review.author.toLowerCase();
  return (
    <article className={`card flex flex-col gap-3 p-5 ${sold || review.state.kind === 'replaced' ? 'opacity-70' : ''}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <OwnerChip address={review.author} profile={profile} size={28} className="font-display text-[15px] font-bold text-white" />
        {!review.retired && <span className="text-[12px] text-mist">honesty rep {repText(review.rep)}</span>}
        <CountLabel review={review} />
        <span className="ml-auto">
          <StatusPill review={review} />
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Stars rating={review.rating} />
        {showToken && (
          <Link to={tokenPath(review.token)} className="inline-flex items-center gap-1.5 font-mono text-[12px] font-bold text-lime hover:underline">
            <TokenAvatar token={review.token} size={20} />${review.symbol}
          </Link>
        )}
      </div>
      {review.text ? (
        <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${sold ? 'text-mist' : 'text-white/90'}`}>{review.text}</p>
      ) : (
        <p className="text-[14px] italic text-mist">Rating only, no text.</p>
      )}
      <p className="text-[12px] text-mist">{positionLine(review)}</p>
      {boughtBack && (
        <p className="text-[12px] leading-relaxed text-mist">
          Their balance went below half of the most they’d held, then came back. It can’t be locked on-chain because they hold again, but it counts as sold.
        </p>
      )}
      {review.retired && (
        <p className="text-[12px] text-mist">
          <b className="text-white/80">Retired:</b> posted on PRISM’s first contract. Shown as history; it doesn’t count.
          {mine && review.status === 'active' && (
            <>
              {' '}
              <Link to={`${tokenPath(review.token)}/review?from=${review.id}`} className="text-lime hover:underline">
                Re-post on the new contract
              </Link>{' '}
              (while you still hold).
            </>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <Link to={reviewPath(review.id)} className="text-mist hover:text-lime">
          Review #{review.id} ↗
        </Link>
        {review.replacedBy && (
          <Link to={reviewPath(review.replacedBy)} className="text-mist hover:text-lime">
            Replaced by #{review.replacedBy}
          </Link>
        )}
        {review.previous > 0 && (
          <Link to={reviewPath(review.previous)} className="text-mist hover:text-lime">
            Replaces #{review.previous}
          </Link>
        )}
      </div>
      {unmarked && (
        <div className="border-t border-white/[0.06] pt-3">
          <p className="mb-2 text-[13px] text-white/90">The author now holds less than half of what they reviewed with. Record it on-chain so it stays SOLD for good.</p>
          <MarkSoldButton review={review} />
        </div>
      )}
      {footer}
    </article>
  );
}

// ------------------------------------------------------------------ lists

const FILTER_LABEL: Record<ReviewFilter, string> = { holding: 'Holding', trimmed: 'Trimmed', sold: 'SOLD', all: 'All' };

/** Reviews with Holding · Trimmed · SOLD · All filters (replaced reviews stay on their own pages). */
export function ReviewList({ reviews, showToken = false, empty }: { reviews: ReviewView[]; showToken?: boolean; empty: ReactNode }) {
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const counts = useMemo(
    () => Object.fromEntries((['holding', 'trimmed', 'sold', 'all'] as const).map((f) => [f, filterReviews(reviews, f).length])) as Record<ReviewFilter, number>,
    [reviews],
  );
  const shown = filterReviews(reviews, filter);
  const profiles = useProfiles(shown.map((r) => r.author as Address));
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Filter reviews" className="flex flex-wrap gap-2">
        {(['holding', 'trimmed', 'sold', 'all'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition ${
              filter === f ? 'border-lime bg-lime/10 text-lime' : 'border-white/15 text-mist hover:text-white'
            }`}
          >
            {FILTER_LABEL[f]} <span className="opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        empty
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((r) => (
            <ReviewCard key={r.id} review={r} profile={profiles.get(r.author.toLowerCase())} showToken={showToken} />
          ))}
        </div>
      )}
    </div>
  );
}
