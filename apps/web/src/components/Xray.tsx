import { EARLY_BUYERS, explorerAddressUrl, explorerBlockUrl, type XrayEvidence, type XraySignal } from '@prism/core';
import { useXray } from '../data/api';
import { SectionLabel } from './design';

const evidenceUrl = (e: XrayEvidence) => (e.kind === 'address' ? explorerAddressUrl(e.value) : explorerBlockUrl(Number(e.value)));

function Line({ signal }: { signal: XraySignal }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-white/[0.06] py-2.5 first:border-t-0 first:pt-0">
      <span className="text-[14px] leading-relaxed text-white/90">{signal.text}</span>
      {signal.estimated && (
        <span title="Worked out from how fast blocks are made, not read from a block’s own timestamp." className="font-mono text-[10px] uppercase tracking-[0.1em] text-mist">
          approx
        </span>
      )}
      {signal.evidence && (
        <a href={evidenceUrl(signal.evidence)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-mist underline decoration-white/20 underline-offset-4 hover:text-lime">
          on-chain ↗
        </a>
      )}
    </li>
  );
}

/**
 * "Launch X-ray": what the chain says about a launch, whether or not anyone has reviewed it.
 * Facts with the numbers behind them, each linking to the address or block it was read from.
 */
export function XrayPanel({ token }: { token: string }) {
  const q = useXray(token);
  const x = q.data?.xray ?? null;
  const reading = (q.data && !q.data.ready) || q.isLoading;
  return (
    <section aria-labelledby="xray" className="flex flex-col gap-4">
      <SectionLabel>
        <span id="xray">Launch X-ray</span>
      </SectionLabel>
      <p className="text-[13px] leading-relaxed text-mist">
        Read from the chain itself, not from any website: what the creator did, who holds it and what the first buyers did. “The first buyers” means the first{' '}
        {EARLY_BUYERS} wallets to buy, and “within an hour” means they had sent their tokens out again within 60 minutes of buying. Shares are of the whole
        supply, so tokens sitting in the pool aren’t counted as someone’s holding. Facts, not advice — PRISM doesn’t tell you whether to buy, and it can’t know
        who is behind a wallet or whether one person holds several.
      </p>
      <div className="card p-5 md:p-6">
        {q.isError ? (
          <p className="text-[14px] text-mist">Couldn’t read the chain for this one right now. Try again in a minute.</p>
        ) : !x ? (
          <p className="text-[14px] text-mist">{reading ? 'Reading this launch’s history from the chain…' : 'Nothing to show yet.'}</p>
        ) : (
          <>
            <ul className="flex flex-col">
              {x.signals.map((s) => (
                <Line key={s.id} signal={s} />
              ))}
            </ul>
            {x.unread.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 border-t border-white/[0.06] pt-3">
                {x.unread.map((u) => (
                  <li key={u.id} className="text-[12px] text-mist">
                    {u.text}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** The one short X-ray line for a card or a search result, or nothing. */
export function XrayFlag({ token, className = '' }: { token: string; className?: string }) {
  const flag = useXray(token).data?.xray?.flag ?? null;
  if (!flag) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] text-gold ${className}`}>
      <span aria-hidden>◆</span>
      {flag}
    </span>
  );
}
