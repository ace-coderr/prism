import { useState, type ReactNode } from 'react';
import { getAddress, type Address } from 'viem';
import { safeUrl, tokenImagePath } from '@prism/core';
import { useMarket, useMeta, type MarketData } from '../data/api';
import { formatChange, formatEth, formatUsd, plural } from '../data/format';
import { Avatar } from '../data/profiles';

/**
 * A token's picture: the one in its own metadata (verified on IPFS, resized by PRISM's image
 * route), else its identicon. Rounded, never stretched; a soft shimmer while it loads.
 */
export function TokenAvatar({ token, size = 32, className = '' }: { token: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const px = size <= 24 ? 48 : size <= 48 ? 96 : size <= 96 ? 192 : 384;
  const radius = size >= 64 ? 'rounded-2xl' : 'rounded-[30%]';
  if (broken) return <Avatar address={getAddress(token.toLowerCase())} size={size} className={className} />;
  return (
    <img
      src={tokenImagePath(token, px)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setBroken(true)}
      className={`inline-block shrink-0 object-cover ring-1 ring-white/10 ${loaded ? 'bg-line' : 'img-shimmer'} ${radius} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** The tooltip on every dollar figure. */
export const USD_NOTE = '≈ $ (real ETH price): ETH × Chainlink ETH/USD on Robinhood Chain mainnet. Testnet tokens have no real value.';

/** "12.4 ETH" with its dollar value (at the real ETH price) as a small second label. */
export function EthValue({ eth, usdPerEth, className = '' }: { eth: number | null | undefined; usdPerEth: number | null | undefined; className?: string }) {
  const usd = formatUsd(eth, usdPerEth);
  return (
    <span className={className}>
      {formatEth(eth)}
      {usd && (
        <span className="ml-1.5 font-mono text-[10px] font-normal tracking-normal text-mist" title={USD_NOTE}>
          ≈{usd}
        </span>
      )}
    </span>
  );
}

/** Market cap in ETH when the pair can be priced in ETH, else in the pair itself. */
export function capText(m: Pick<MarketData, 'capEth' | 'cap' | 'pair'>): string {
  if (m.capEth !== null) return formatEth(m.capEth);
  if (m.cap === null) return '–';
  const n = Number(m.cap) / 10 ** m.pair.decimals;
  return `${n >= 1000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : n.toLocaleString('en-US', { maximumSignificantDigits: 3 })} ${m.pair.symbol}`;
}

function Stat({ label, children, sub, subTitle }: { label: string; children: ReactNode; sub?: ReactNode; subTitle?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-mist">{label}</dt>
      <dd className="truncate font-display text-[19px] font-bold tabular-nums tracking-[-0.02em] text-white">{children}</dd>
      {sub && (
        <dd className="truncate text-[11px] text-mist" title={subTitle}>
          {sub}
        </dd>
      )}
    </div>
  );
}

/** Market cap · Holders · 24h volume · 24h change · Progress, read from the chain (refreshes every few minutes). */
export function MarketStats({ token, kind }: { token: Address; kind: 'stock' | 'launch' }) {
  const q = useMarket(token);
  const m = q.data;
  const wait = q.isLoading ? '…' : '–';
  const change = m?.day?.change ?? null;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.07] sm:grid-cols-5 [&>div]:bg-panel [&>div:last-child]:col-span-2 sm:[&>div:last-child]:col-span-1">
        <Stat label="Market cap" sub={m ? formatUsd(m.capEth, m.usdPerEth) && `≈${formatUsd(m.capEth, m.usdPerEth)}` : null} subTitle={USD_NOTE}>
          {m ? capText(m) : wait}
        </Stat>
        <Stat label="Holders" sub={kind === 'stock' ? 'not counted for test stocks' : undefined}>
          {m?.holders != null ? m.holders.toLocaleString('en-US') : wait}
        </Stat>
        <Stat label="24h volume" sub={m?.day ? `${plural(m.day.buys, 'buy')} · ${plural(m.day.sells, 'sell')}` : undefined}>
          {m?.day ? (m.day.volumeEth !== null ? formatEth(m.day.volumeEth) : `${capText({ capEth: null, cap: m.day.volume, pair: m.pair }).replace(/ .*/, '')} ${m.pair.symbol}`) : wait}
        </Stat>
        <Stat label="24h change">
          <span className={change === null || Math.abs(change) < 0.0005 ? '' : change > 0 ? 'text-up' : 'text-down'}>{m ? formatChange(change) : wait}</span>
        </Stat>
        {kind === 'stock' ? (
          <Stat label="Liquidity" sub="in its ETH pool">
            {m ? formatEth(m.liquidityEth) : wait}
          </Stat>
        ) : (
          <Stat label="Progress" sub={m?.status === 'graduated' && m.liquidityEth !== null ? `${formatEth(m.liquidityEth)} liquidity` : m?.status === 'curve' ? 'to graduation' : undefined}>
            {!m ? (
              wait
            ) : m.status === 'graduated' ? (
              <span className="text-lime">Graduated</span>
            ) : m.progress !== null ? (
              <span className="flex items-center gap-2">
                {Math.round(m.progress * 100)}%
                <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-white/10" aria-hidden>
                  <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.max(2, Math.round(m.progress * 100))}%` }} />
                </span>
              </span>
            ) : (
              '–'
            )}
          </Stat>
        )}
      </dl>
      <p className="text-[11px] text-mist">
        {q.isError
          ? 'Market details couldn’t be read right now; they retry by themselves.'
          : 'Read from the chain: the curve or pool, its trades and transfers. Refreshes every few minutes. Dollar figures use the real ETH price (Chainlink, Robinhood Chain mainnet).'}
      </p>
    </div>
  );
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const ugc = 'nofollow noopener noreferrer ugc';

/** Plain text with http(s) links made clickable (and safe); nothing else is interpreted. */
function Linkified({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = safeUrl(m[0].replace(/[.,;:!?]+$/, ''));
    if (!url) continue;
    out.push(text.slice(last, m.index));
    out.push(
      <a key={m.index} href={url} target="_blank" rel={ugc} className="break-all text-white underline decoration-white/30 underline-offset-2 hover:text-lime">
        {m[0].replace(/[.,;:!?]+$/, '')}
      </a>,
    );
    last = m.index + m[0].replace(/[.,;:!?]+$/, '').length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

const LINK_LABELS = { website: 'Website', x: 'X', telegram: 'Telegram', discord: 'Discord' } as const;

/** The creator's description (collapsible) and links, from the launch's own metadata. */
export function TokenAbout({ token }: { token: Address }) {
  const q = useMeta(token);
  const [open, setOpen] = useState(false);
  const m = q.data;
  if (!m || m.status !== 'ok') return null;
  const links = (Object.keys(LINK_LABELS) as Array<keyof typeof LINK_LABELS>).filter((k) => m.links[k]);
  if (!m.description && links.length === 0) return null;
  const long = (m.description?.length ?? 0) > 220 || (m.description?.split('\n').length ?? 0) > 3;
  return (
    <div className="flex flex-col gap-3">
      {m.description && (
        <div>
          <p className={`whitespace-pre-line break-words text-[15px] leading-relaxed text-white/85 ${long && !open ? 'line-clamp-3' : ''}`}>
            <Linkified text={m.description} />
          </p>
          {long && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-mist hover:text-white" aria-expanded={open}>
              {open ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      {links.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {links.map((k) => (
            <a key={k} href={m.links[k]} target="_blank" rel={ugc} className="chip inline-flex items-center gap-1 font-mono text-[11px] text-white hover:border-lime/60">
              {k === 'website' ? new URL(m.links[k]!).hostname.replace(/^www\./, '') : LINK_LABELS[k]} ↗
            </a>
          ))}
        </div>
      )}
      <p className="text-[11px] text-mist">From the creator’s own metadata on IPFS, checked against the launch on-chain. Links are theirs, not PRISM’s.</p>
    </div>
  );
}

/** Market cap and holders in one short line for lists ("12.4 ETH · 81 holders"). */
export function MarketLine({ token, className = '' }: { token: string; className?: string }) {
  const q = useMarket(token);
  const m = q.data;
  if (!m) return q.isLoading ? <span className={`text-mist ${className}`}>…</span> : null;
  const parts = [m.cap !== null || m.capEth !== null ? `${capText(m)} cap` : null, m.holders !== null ? plural(m.holders, 'holder') : null].filter(Boolean);
  return parts.length ? <span className={className}>{parts.join(' · ')}</span> : null;
}
