import { PRISM_TOKEN, tokenPath } from '@prism/core';
import { Link } from 'react-router-dom';
import { useXray } from '../data/api';
import { SectionLabel } from './design';
import { Line } from './Xray';

/**
 * "See it on a real launch": the Launch X-ray of $PRISM, PRISM's own token, on Home. Real chain
 * data only, read by the same code as every other launch's X-ray. There is no fallback: while it
 * is being read, or if it can't be, the section isn't there at all, rather than showing anything made up.
 */
export function RealLaunchXray() {
  const token = PRISM_TOKEN;
  const q = useXray(token ?? undefined);
  const x = q.data?.ready ? q.data.xray : null;
  if (!token || !x) return null;
  return (
    <section aria-labelledby="real-launch" className="flex flex-col gap-4">
      <SectionLabel>
        <span id="real-launch">See it on a real launch</span>
      </SectionLabel>
      <p className="text-[14px] leading-relaxed text-mist">
        $PRISM is a real launch on vibe/vibe, and PRISM’s own token. This is its Launch X-ray, read from the chain by the same code that reads every other launch. Nothing on
        this card is an example.
      </p>
      <div className="card p-5 md:p-6">
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
      </div>
      <Link to={tokenPath(token)} className="font-mono text-[12px] text-lime underline decoration-lime/40 underline-offset-4 hover:decoration-lime">
        Open $PRISM’s page and X-ray →
      </Link>
    </section>
  );
}
