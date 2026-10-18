import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { decodeEventLog, getAddress, isAddress, type Address } from 'viem';
import { simulateContract } from 'wagmi/actions';
import { SHARE_TEXT, prismReviewsAbi, reviewPath, tokenPath } from '@prism/core';
import { DeepNav } from '../components/DeepNav';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stars, StarInput, reviewsContract } from '../components/reviews';
import { ShareOnX } from '../components/ShareOnX';
import { GuideNote } from '../components/Viber';
import { BuyOnVibe } from '../components/vibe';
import { useRefreshReviews, useReview, useToken, type TokenData } from '../data/api';
import { dateText, formatShare, formatTokens } from '../data/format';
import { useHolding } from '../data/holding';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { StepList, useTxSteps } from '../wallet/steps';
import { SwitchNetworkButton, WalletButton } from '../wallet/WalletButton';

const MAX_BYTES = 280;
const COOLDOWN = 3600;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const timeText = (unix: number) => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** /t/:address/review: write (or update) a review of a token you hold. */
export default function WriteReview() {
  const { address = '' } = useParams();
  const valid = isAddress(address, { strict: false });
  const token = useToken(valid ? address : undefined);
  const asset = token.data?.asset;
  const crumbs = [
    { label: 'Home', to: '/' },
    { label: asset ? `$${asset.symbol}` : 'Token', to: valid ? tokenPath(address) : '/' },
    { label: 'Review', to: valid ? `${tokenPath(address)}/review` : '/' },
  ];
  return (
    <PageScroll>
      <div className="flex flex-col gap-8 md:gap-10">
        <DeepNav crumbs={crumbs} />
        <PageHeader
          label="Write a review"
          lead={asset ? `Review $${asset.symbol}` : 'Review'}
          subtitle="Only holders can review. What you hold is recorded with your review, and if you sell below half of the most you’ve held since, it says SOLD for everyone."
        />
      </div>
      {!valid ? (
        <GuideNote index={2}>That isn’t a token address.</GuideNote>
      ) : token.isError ? (
        <GuideNote index={2}>PRISM doesn’t know this token. Only vibe/vibe launches and the test stocks can be reviewed.</GuideNote>
      ) : !asset ? (
        <p className="text-mist">Reading the chain…</p>
      ) : (
        <Form token={getAddress(asset.token)} symbol={asset.symbol} kind={asset.kind} floor={token.data?.floor ?? null} creator={token.data?.launch?.creator ?? null} />
      )}
    </PageScroll>
  );
}

function Form({ token, symbol, kind, floor, creator }: { token: Address; symbol: string; kind: 'stock' | 'launch'; floor: TokenData['floor']; creator: Address | null }) {
  const h = useHolding(token);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [posted, setPosted] = useState<{ id: bigint; rating: number } | null>(null);
  // "Re-post on the new contract": ?from=<id> of the author's retired review fills in its rating and text
  const [params] = useSearchParams();
  const from = useReview(params.get('from') ?? undefined);
  const retired = from.data?.review.retired && from.data.review.token.toLowerCase() === token.toLowerCase() && from.data.review.author.toLowerCase() === h.address?.toLowerCase() ? from.data.review : null;
  useEffect(() => {
    if (!retired) return;
    setRating((r) => r || retired.rating);
    setText((t) => t || retired.text);
  }, [retired?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const tx = useTxSteps();
  const refresh = useRefreshReviews();
  const contract = reviewsContract();
  const now = Math.floor(Date.now() / 1000);

  if (posted) {
    return (
      <GuideNote
        index={4}
        action={
          <>
            <ShareOnX text={SHARE_TEXT.review(symbol, posted.rating, posted.id)} className="btn btn-primary" />
            <Link to={reviewPath(posted.id)} className="btn btn-outline">
              See your review
            </Link>
            <Link to={tokenPath(token)} className="btn btn-outline">
              Back to ${symbol}
            </Link>
          </>
        }
      >
        <b className="font-display text-white">Your review is live and permanent.</b> It shows your position, and if you sell, it will say SOLD.
      </GuideNote>
    );
  }
  if (!h.isConnected) {
    return (
      <GuideNote index={1} action={<WalletButton variant="hero" />}>
        Log in with email, Google, X or a wallet. PRISM then checks on-chain that you hold ${symbol}.
      </GuideNote>
    );
  }
  if (!h.onTarget) return <SwitchNetworkButton />;
  if (h.loading) return <p className="text-mist">Checking your ${symbol} balance…</p>;
  if (!h.holds) {
    return (
      <GuideNote index={1} action={kind === 'launch' ? <BuyOnVibe token={token} /> : undefined}>
        Only holders can review this, and your wallet holds no ${symbol}. {kind === 'launch' ? 'Buy some on vibe/vibe, then come back.' : ''}
      </GuideNote>
    );
  }

  const old = h.myReview && h.myReview.status !== 'replaced' ? h.myReview : null;
  const availableAt = old ? old.postedAt + COOLDOWN : 0;
  const waiting = old && now < availableAt;
  const size = bytes(text);
  const share = h.supply && h.balance !== null && h.supply > 0n ? Number((h.balance * 1_000_000n) / h.supply) / 1_000_000 : null;
  const canPost = !!contract && rating >= 1 && size <= MAX_BYTES && !waiting && !tx.running;

  const isCreator = !!creator && !!h.address && creator.toLowerCase() === h.address.toLowerCase();
  const tooSmall = !!floor && h.balance !== null && h.balance < BigInt(floor.units);
  const post = async () => {
    let id: bigint | null = null;
    let block = 0n;
    const ok = await tx.run([
      {
        label: old ? 'Posting your new review' : 'Posting your review',
        tx: { description: `Post a ${rating}-star review of $${symbol} on PRISM. It records that you hold ${formatTokens(h.balance, h.decimals)} $${symbol}.`, action: 'Post review', contract: 'PrismReviews' },
        send: async (write) => {
          const { request } = await simulateContract(wagmiConfig, { address: contract!, abi: prismReviewsAbi, functionName: 'post', args: [token, rating, text], chainId: TARGET_CHAIN.id, account: h.address });
          return write(request);
        },
        after: (receipt) => {
          block = receipt.blockNumber;
          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== contract!.toLowerCase()) continue;
            try {
              const ev = decodeEventLog({ abi: prismReviewsAbi, topics: log.topics, data: log.data });
              if (ev.eventName === 'ReviewPosted') id = ev.args.id;
            } catch {
              /* another event */
            }
          }
        },
        errorContext: { symbol: `$${symbol}` },
      },
    ]);
    if (ok && id !== null) {
      setPosted({ id, rating });
      void h.refetch();
      await refresh({ block, token, author: h.address, id });
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-6">
        {old && (
          <div className="card flex flex-col gap-2 p-5">
            <p className="section-label">Your current review</p>
            <p className="flex items-center gap-3">
              <Stars rating={old.rating} />
              <Link to={reviewPath(old.id)} className="text-[13px] text-mist hover:text-lime">
                Review #{old.id.toString()} ↗
              </Link>
            </p>
            <p className="text-[13px] text-mist">
              {old.status === 'sold'
                ? 'It was marked SOLD and stays that way. A new review starts fresh, linked to it.'
                : `Posting again adds a new review that replaces it (the old one stays visible, marked as replaced). SOLD stays measured from the most you’ve held since your first review: ${formatTokens(old.baseline, h.decimals)} $${symbol}, or more if you hold more now.`}
            </p>
            {waiting && <p className="text-[13px] text-gold">One review per hour per token: you can post again at {timeText(availableAt)}.</p>}
          </div>
        )}
        {retired && (
          <div className="card flex flex-col gap-1 border-lime/30 p-5 text-[13px] text-mist">
            <p className="section-label text-lime">Re-posting review #{retired.id}</p>
            <p>Your review from PRISM’s first contract, filled in below. Posting it on the new contract records what you hold now.</p>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className="section-label text-[11px]">Your rating</span>
          <StarInput value={rating} onChange={setRating} />
        </div>
        <label className="flex flex-col gap-2">
          <span className="flex items-baseline justify-between">
            <span className="section-label text-[11px]">Your review</span>
            <span className={`font-mono text-[12px] ${size > MAX_BYTES ? 'text-down' : 'text-mist'}`} aria-live="polite">
              {size} / {MAX_BYTES}
            </span>
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={`What do you think of $${symbol}? Why are you holding it?`}
            className="w-full resize-none rounded-2xl border border-white/10 bg-ink px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-lime/60"
          />
          <span className="text-[12px] text-mist">Up to 280 characters (emoji and accents count double or more). Optional: a rating alone is fine.</span>
          {size > MAX_BYTES && <span className="text-[12px] text-down">That’s {size - MAX_BYTES} too long.</span>}
        </label>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card flex flex-col gap-3 p-5">
          <p className="section-label">Recorded on-chain, for good</p>
          <Stars rating={rating} size={20} />
          <p className={`whitespace-pre-wrap break-words text-[15px] ${text ? 'text-white/90' : 'italic text-mist'}`}>{text || 'No text: rating only.'}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-[13px]">
            <dt className="text-mist">Your position</dt>
            <dd className="text-white">
              {formatTokens(h.balance, h.decimals)} ${symbol}
              {formatShare(share) ? ` (${formatShare(share)} of supply)` : ''}
            </dd>
            <dt className="text-mist">Date</dt>
            <dd className="text-white">{dateText(now)}</dd>
            <dt className="text-mist">Wallet</dt>
            <dd className="break-all font-mono text-[11px] text-white">{h.address}</dd>
          </dl>
          <p className="text-[12px] leading-relaxed text-mist">
            If you ever hold less than half of the most you’ve held since your first review of ${symbol}, your review says SOLD. Moving tokens out of your wallet (to another
            wallet, a pool, staking or an exchange) counts as selling, and selling below half then buying back still shows SOLD. Reviews can’t be deleted or edited,
            only replaced by a newer one.
          </p>
        </div>
        {isCreator && (
          <p className="rounded-2xl border border-gold/40 bg-gold/5 p-4 text-[13px] leading-relaxed text-white/90">
            You created ${symbol}. Your review will show with a <b>Creator</b> label, but it won’t count toward its score or your honesty rep.
          </p>
        )}
        {tooSmall && !isCreator && (
          <p className="rounded-2xl border border-gold/40 bg-gold/5 p-4 text-[13px] leading-relaxed text-white/90">
            {floor!.basis === 'usd'
              ? `Your position is worth less than $1 at the current price ($1 is about ${formatTokens(BigInt(floor!.units), h.decimals)} $${symbol}).`
              : `Your position is less than a millionth of the supply (${formatTokens(BigInt(floor!.units), h.decimals)} $${symbol}); PRISM can’t price ${symbol} right now.`}{' '}
            Your review will show, labelled “Too small to count”, but it won’t count toward the score, your honesty rep or badges.
          </p>
        )}
        <button type="button" className="btn btn-primary btn-lg" disabled={!canPost} onClick={() => void post()}>
          {tx.running ? 'Posting…' : rating === 0 ? 'Pick a rating first' : old ? 'Post new review' : 'Post review'}
        </button>
        <p className="text-[12px] text-mist">One transaction, a little test ETH for gas. PRISM never takes your tokens: it only reads your balance.</p>
        <StepList steps={tx.steps} />
      </div>
    </div>
  );
}
