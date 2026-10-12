import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatScore, scoreColor, tokenPath } from '@prism/core';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { SectionLabel } from '../components/design';
import { GuideNote } from '../components/Viber';
import { useStocks } from '../data/api';
import { plural } from '../data/format';
import { MarketLine, TokenAvatar } from '../components/token';

/** The five test stocks: their reviews, and the vibe/vibe launches paired with each. */
export default function Stocks() {
  const q = useStocks();
  const { hash } = useLocation();
  useEffect(() => {
    if (q.data && hash) document.getElementById(`stock-${hash.slice(1)}`)?.scrollIntoView({ block: 'start' });
  }, [q.data, hash]);
  return (
    <PageScroll>
      <PageHeader
        label="Test stocks"
        lead="Stocks and the launches"
        accent="paired with them."
        subtitle="vibe/vibe’s test stocks (no real value) can be reviewed like any launch. Many launches trade against them instead of ETH."
      />
      {q.isError ? (
        <GuideNote index={2}>The stocks aren’t available right now. Try again in a minute.</GuideNote>
      ) : !q.data ? (
        <p className="text-mist">Reading the chain…</p>
      ) : (
        <div className="flex flex-col gap-12">
          {q.data.stocks.map(({ asset, score, paired, pairedCount }) => (
            <section key={asset.token} id={`stock-${asset.symbol}`} className="flex scroll-mt-28 flex-col gap-4">
              <Link to={tokenPath(asset.token)} className="card card-hover flex flex-wrap items-center gap-4 p-5">
                <TokenAvatar token={asset.token} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-2xl font-bold">${asset.symbol}</span>
                  <span className="block truncate text-[13px] text-mist">{asset.name}</span>
                  <MarketLine token={asset.token} className="block truncate text-[12px] text-mist" />
                </span>
                <span className="text-right">
                  {score.score === null ? (
                    <span className="block text-[13px] text-mist">
                      {score.total === 0 ? 'No reviews yet' : `${plural(score.reviewers, 'holder')} reviewing · score from 3`}
                    </span>
                  ) : (
                    <>
                      <span className="block font-display text-3xl font-bold" style={{ color: scoreColor(score.score) }}>
                        {formatScore(score.score)}
                      </span>
                      <span className="block text-[11px] text-mist">{plural(score.reviewers, 'holder')} still in</span>
                    </>
                  )}
                </span>
                <span className="btn btn-outline !px-4 !py-2">Reviews</span>
              </Link>
              <SectionLabel>
                Launches paired with ${asset.symbol} · {pairedCount.toLocaleString('en-US')}
              </SectionLabel>
              {paired.length === 0 ? (
                <p className="text-[14px] text-mist">No vibe/vibe launch is paired with ${asset.symbol} yet.</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {paired.map((l) => (
                    <li key={l.token}>
                      <Link to={tokenPath(l.token)} className="card card-hover flex items-center gap-3 p-4">
                        <TokenAvatar token={l.token} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-display font-bold">${l.symbol}</span>
                          <span className="block truncate text-[12px] text-mist">{l.name}</span>
                        </span>
                        <span className={`font-mono text-[10px] uppercase tracking-[0.1em] ${l.status === 'graduated' ? 'text-lime' : 'text-gold'}`}>
                          {l.status === 'graduated' ? 'graduated' : 'on curve'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {pairedCount > paired.length && <p className="text-[12px] text-mist">Showing graduated launches first, then the newest. Search to find any of them.</p>}
            </section>
          ))}
        </div>
      )}
    </PageScroll>
  );
}
