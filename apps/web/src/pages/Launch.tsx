import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAddress, isAddress, type Address } from 'viem';
import { SHARE_TEXT, SITE_URL, badgePath, explorerAddressUrl, stockDisclaimers, tokenPath, type ReviewableAsset } from '@prism/core';
import { DeepNav } from '../components/DeepNav';
import { PageScroll } from '../components/PageHeader';
import { ScoreBlock, ReviewList } from '../components/reviews';
import { XrayPanel } from '../components/Xray';
import { ShareOnX } from '../components/ShareOnX';
import { SectionLabel } from '../components/design';
import { GuideNote } from '../components/Viber';
import { MarketStats, TokenAbout, TokenAvatar } from '../components/token';
import { BuyOnVibe, BuyOnVibeLink } from '../components/vibe';
import { useMarket, useToken, type TokenData } from '../data/api';
import { dateText, formatTokens } from '../data/format';
import { useHolding } from '../data/holding';
import { OwnerChip, useProfile } from '../data/profiles';
import { WalletButton } from '../wallet/WalletButton';

/** /t/:address: a launch or a test stock, its setup, true colors and reviews. */
export default function LaunchPage() {
  const { address = '' } = useParams();
  const valid = isAddress(address, { strict: false });
  const token = useToken(valid ? address : undefined);
  if (!valid) return <NotFound text="That isn’t a token address." />;
  if (token.isError) return <NotFound text={token.error.status === 404 ? 'PRISM doesn’t know this token: it isn’t a vibe/vibe launch or a test stock (a brand-new launch shows up within a minute).' : 'Couldn’t load this token right now. Try again in a minute.'} />;
  if (!token.data) {
    return (
      <PageScroll>
        <p className="text-mist">Reading the chain…</p>
      </PageScroll>
    );
  }
  return <Launch data={token.data} />;
}

function NotFound({ text }: { text: string }) {
  return (
    <PageScroll>
      <DeepNav crumbs={[{ label: 'Home', to: '/' }, { label: 'Token', to: '/' }]} />
      <GuideNote index={2}>{text}</GuideNote>
    </PageScroll>
  );
}

function Launch({ data }: { data: TokenData }) {
  const a = data.asset;
  const token = getAddress(a.token);
  const setupTime = data.setup && 'createdAt' in data.setup ? data.setup.createdAt : null;
  const holders = useMarket(token).data?.holders ?? null;
  return (
    <PageScroll>
      <div className="flex flex-col gap-6">
        <DeepNav crumbs={[{ label: 'Home', to: '/' }, { label: `$${a.symbol}`, to: tokenPath(token) }]} />
        <Header asset={a} data={data} createdAt={setupTime} />
        <MarketStats token={token} kind={a.kind} symbol={a.symbol} pairedCount={data.paired?.count} />
        {a.kind === 'launch' && <TokenAbout token={token} />}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1fr_1.1fr]">
        <ScoreBlock score={data.score} symbol={a.symbol} holders={holders} />
        <ReviewAction asset={a} />
      </div>

      <XrayPanel token={token} />

      <section aria-labelledby="reviews" className="flex flex-col gap-5">
        <SectionLabel>
          <span id="reviews">Reviews of ${a.symbol}</span>
        </SectionLabel>
        <ReviewList
          reviews={data.reviews}
          empty={
            <GuideNote index={3}>
              No reviews here yet. If you hold ${a.symbol}, you can be the first. Reviews stay forever, and if you sell, yours will say SOLD.
            </GuideNote>
          }
        />
      </section>

      <Setup data={data} />
      <CreatorKit asset={a} data={data} />
    </PageScroll>
  );
}

function Header({ asset: a, data, createdAt }: { asset: ReviewableAsset; data: TokenData; createdAt: number | null }) {
  const creator = useProfile(a.creator ?? undefined);
  const market = useMarket(a.token).data;
  const isStock = a.kind === 'stock';
  // the live read wins over the index (a graduation shows here before the index catches up)
  const graduated = market ? market.status === 'graduated' : a.status === 'graduated';
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-4 sm:gap-6">
        <TokenAvatar token={a.token} size={76} className="md:!h-28 md:!w-28" />
        <div className="min-w-0">
          <SectionLabel>{isStock ? 'vibe/vibe test stock' : 'vibe/vibe launch'}</SectionLabel>
          <h1 className="display-md mt-3 break-words" title={a.fullName ?? undefined}>
            {a.name}
          </h1>
          <p className="mt-1 break-words font-mono text-lg font-bold text-lime">${a.symbol}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isStock ? (
              stockDisclaimers(a.fullName ?? '').map((d) => (
                <span key={d} className="chip font-mono text-[11px] uppercase tracking-[0.1em] text-gold" title={`On-chain name: ${a.fullName}`}>
                  {d}
                </span>
              ))
            ) : (
              <span className="chip font-mono text-[11px] uppercase tracking-[0.1em] text-white">Paired with {a.quote?.symbol ?? 'ETH'}</span>
            )}
            {!isStock && graduated && <span className="chip font-mono text-[11px] uppercase tracking-[0.1em] text-lime">Graduated</span>}
            {!isStock && !graduated && <span className="chip font-mono text-[11px] uppercase tracking-[0.1em] text-gold">On curve</span>}
          </div>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-mist">
            {a.creator && (
              <span className="inline-flex items-center gap-2">
                Created by <OwnerChip address={a.creator} profile={creator.profile} size={20} className="text-white" />
              </span>
            )}
            {createdAt && <span>on {dateText(createdAt)}</span>}
            <a href={explorerAddressUrl(a.token)} target="_blank" rel="noreferrer" className="break-all font-mono text-[11px] hover:text-lime">
              {a.token} ↗
            </a>
          </p>
          {a.quote?.kind === 'stock' && a.quote.address && (
            <p className="mt-3 text-[13px] text-mist">
              Paired with a test stock:{' '}
              <Link to={tokenPath(a.quote.address)} className="text-white hover:text-lime">
                see ${a.quote.symbol} and its reviews
              </Link>
            </p>
          )}
          {isStock && data.paired && (
            <p className="mt-3 text-[13px] text-mist">
              {data.paired.count.toLocaleString('en-US')} vibe/vibe launches are paired with ${a.symbol}.{' '}
              <Link to={`/stocks#${a.symbol}`} className="text-white hover:text-lime">
                See them
              </Link>
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <BuyOnVibe token={getAddress(a.token)} />
      </div>
    </header>
  );
}

/** Write / update a review, or why you can't (yet). */
function ReviewAction({ asset }: { asset: ReviewableAsset }) {
  const token = getAddress(asset.token);
  const h = useHolding(token);
  const write = `${tokenPath(token)}/review`;
  let body;
  if (!h.isConnected) {
    body = (
      <GuideNote index={1} action={<WalletButton variant="hero" />}>
        Hold ${asset.symbol}? Log in to review it. PRISM checks your balance on-chain: only holders can post.
      </GuideNote>
    );
  } else if (h.loading) {
    body = <p className="text-sm text-mist">Checking your ${asset.symbol} balance…</p>;
  } else if (h.holds) {
    const active = h.myReview?.status === 'active';
    body = (
      <GuideNote
        index={1}
        action={
          <Link to={write} className="btn btn-primary">
            {active ? 'Update your review' : 'Write a review'}
          </Link>
        }
      >
        You hold <b className="text-white">{formatTokens(h.balance, h.decimals)} ${asset.symbol}</b>.{' '}
        {active ? 'You already reviewed it; a new review replaces yours (the old one stays visible).' : 'Your review records this position, and shows SOLD if you drop below half of the most you’ve held since.'}
      </GuideNote>
    );
  } else {
    body = (
      <GuideNote index={1}>
        Only holders can review this. Your wallet holds no ${asset.symbol}.
        <span className="mt-2 block">
          <BuyOnVibeLink token={token} symbol={asset.symbol} />
        </span>
      </GuideNote>
    );
  }
  return <div className="card flex flex-col justify-center p-6 md:p-8">{body}</div>;
}

function Setup({ data }: { data: TokenData }) {
  if (!data.setupLines) return null;
  return (
    <section aria-labelledby="setup" className="flex flex-col gap-4">
      <SectionLabel>
        <span id="setup">How this token is set up</span>
      </SectionLabel>
      <p className="text-[13px] text-mist">Read from its own contracts on-chain, not from any website.</p>
      <dl className="card divide-y divide-white/[0.06]">
        {data.setupLines.map((l) => (
          <div key={l.label} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
            <dt className="shrink-0 font-mono text-[12px] uppercase tracking-[0.1em] text-mist sm:w-56">{l.label}</dt>
            <dd className={`text-[15px] ${l.available ? 'text-white' : 'text-mist'}`}>{l.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CreatorKit({ asset, data }: { asset: ReviewableAsset; data: TokenData }) {
  const token = asset.token as Address;
  const [copied, setCopied] = useState<string | null>(null);
  const badge = `${SITE_URL}${badgePath(token)}`;
  const page = `${SITE_URL}${tokenPath(token)}`;
  const snippets = {
    markdown: `[![$${asset.symbol} true colors on PRISM](${badge})](${page})`,
    html: `<a href="${page}"><img src="${badge}" alt="$${asset.symbol} true colors on PRISM"></a>`,
  };
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt('Copy this:', text);
    }
  };
  const share = data.score.score === null ? SHARE_TEXT.launchNoScore(asset.symbol, token) : SHARE_TEXT.launch(asset.symbol, data.score.score, data.score.reviewers, token);
  return (
    <section aria-labelledby="share" className="flex flex-col gap-4">
      <SectionLabel>
        <span id="share">Share & creator kit</span>
      </SectionLabel>
      <div className="card flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <ShareOnX text={share} label={`Share $${asset.symbol}`} />
          <ShareOnX text={SHARE_TEXT.askHolders(asset.symbol, token)} label="Ask my holders to review" className="btn btn-outline" />
          <button type="button" className="btn btn-outline" onClick={() => void copy('link', page)}>
            {copied === 'link' ? 'Copied ✓' : 'Copy link'}
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-[14px] text-white/90">A live score badge for your site or README (it updates by itself):</p>
          <img src={badgePath(token)} alt={`$${asset.symbol} true colors on PRISM`} className="h-[22px] w-auto self-start" />
          <div className="flex flex-wrap gap-2">
            {(['markdown', 'html'] as const).map((k) => (
              <button key={k} type="button" className="chip font-mono text-[11px]" onClick={() => void copy(k, snippets[k])}>
                {copied === k ? 'Copied ✓' : `Copy ${k === 'markdown' ? 'Markdown' : 'HTML'}`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
