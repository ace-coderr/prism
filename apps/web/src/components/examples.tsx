import type { ReactNode } from 'react';
import type { ReviewView } from '@prism/core';
import { EXAMPLE_CREATOR_SOLD, EXAMPLE_REVIEWS, type ExampleCreatorSold, type ExampleReview } from '../examples/data';

/*
 * Labeled example cards for empty sections (data in ../examples/data.ts). Built so one can't be
 * taken for a real entry, at a glance or any other way:
 *
 * - a dashed frame and muted type, unlike a real card;
 * - the EXAMPLE tag is the first thing in the frame, as text (so it is read first by a screen
 *   reader, survives copy and paste and printing, and shows in any screenshot of the card), and
 *   the note under it says what it is;
 * - no link, no picture loaded from the server, no wallet or profile lookup, no share button: an
 *   example reads nothing, links nowhere and can't be acted on;
 * - they only ever render where the section is empty (Feed, CreatorsSellingFeed and
 *   TokenExampleReview each decide that themselves, from the real data).
 */

/** The one line every example carries. */
export const EXAMPLE_NOTE = 'Example, not real. Shown until real ones exist.';

function ExampleFrame({ children }: { children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label="Example, not real"
      data-example="true"
      className="flex flex-col gap-2 rounded-2xl border border-dashed border-white/25 bg-white/[0.015] p-4 text-mist print:border-black print:text-black"
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded border border-dashed border-gold/60 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.16em] text-gold">EXAMPLE</span>
        <span className="text-[11px] leading-snug">{EXAMPLE_NOTE}</span>
      </p>
      {children}
    </div>
  );
}

/** A plain tile in place of a token picture: nothing is fetched for an example. */
const Tile = () => (
  <span aria-hidden className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[30%] border border-dashed border-white/25 font-mono text-[9px] text-mist">
    EX
  </span>
);

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

function stateText(r: ExampleReview): string {
  switch (r.state.kind) {
    case 'holding':
      return `Holding · ${r.state.days} days`;
    case 'trimmed':
      return `Trimmed ${r.state.percent}% · ${r.state.days} days`;
    case 'sold':
      return `SOLD after ${r.state.days} days`;
  }
}

export function ExampleReviewCard({ review }: { review: ExampleReview }) {
  return (
    <ExampleFrame>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Tile />
        <span className="font-mono text-[12px] font-bold">${review.symbol}</span>
        <span className="truncate text-[13px]">{review.name}</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em]">{stateText(review)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span role="img" aria-label={`${review.rating} out of 5 stars`} className="text-[13px] tracking-[0.1em]">
          {stars(review.rating)}
        </span>
        <span className="font-mono text-[11px]">holder {review.wallet}</span>
      </span>
      <span className="text-[13px] leading-relaxed">{review.text}</span>
    </ExampleFrame>
  );
}

/** Home's "Latest reviews", when there are none: the three states a review can be in. */
export function ExampleReviewCards() {
  return (
    <>
      {EXAMPLE_REVIEWS.map((r) => (
        <ExampleReviewCard key={r.id} review={r} />
      ))}
    </>
  );
}

/** "Creators selling their own launch", when it is empty: what a flagged launch looks like. */
export function ExampleCreatorCard({ creator = EXAMPLE_CREATOR_SOLD }: { creator?: ExampleCreatorSold }) {
  return (
    <ExampleFrame>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Tile />
        <span className="font-mono text-[12px] font-bold">${creator.symbol}</span>
        <span className="truncate text-[13px]">{creator.name}</span>
      </span>
      <span className="text-[13px] leading-relaxed">{creator.text}</span>
      <span className="font-mono text-[11px]">◆ {creator.xray.flag}</span>
    </ExampleFrame>
  );
}

/**
 * Under a token's real "no reviews yet", one example of what a review looks like. Renders nothing
 * the moment the token has a single review of any kind, so it is never next to a real one.
 */
export function TokenExampleReview({ reviews }: { reviews: readonly ReviewView[] | undefined }) {
  if (!reviews || reviews.length > 0) return null;
  return <ExampleReviewCard review={EXAMPLE_REVIEWS[0]!} />;
}
