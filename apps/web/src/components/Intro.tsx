import { useEffect, useState } from 'react';
import { GuideNote } from './Viber';

const KEY = 'prism.intro.seen.v1';

const POINTS = [
  'PRISM turns a few test stocks and some ETH into one crystal you can hold.',
  'The crystal keeps your tokens safe. Only you can take them out — no admin can touch them.',
  'Its shape tells the story: size, today’s move, how jumpy the price is, and gold where it recovered.',
];

/** Safe localStorage access: a private window or blocked storage just means "show it". */
function seen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function remember() {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked — the intro may show again next time, which is fine */
  }
}

/** First-visit intro: one GuideNote and three numbered points, dismissible, shown once. */
export function Intro() {
  const [open, setOpen] = useState(false);
  const close = () => {
    remember();
    setOpen(false);
  };
  useEffect(() => setOpen(!seen()), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!open) return null;

  return (
    // flex + m-auto (not grid centring) so a modal taller than a phone screen still scrolls to its top
    <div className="fixed inset-0 z-[60] flex overflow-y-auto bg-ink/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="intro-title">
      <div className="m-auto w-full max-w-[640px] rounded-3xl border border-white/10 bg-panel p-6 shadow-2xl sm:p-8">
        <p className="section-label">New here?</p>
        <h2 id="intro-title" className="headline mt-3 text-3xl">PRISM in three points</h2>
        <GuideNote index={0} className="mt-6">
          Welcome! Here’s the whole idea in ten seconds.
        </GuideNote>
        <ol className="mt-6 space-y-4">
          {POINTS.map((t, i) => (
            <li key={i} className="flex gap-4">
              <span className="font-mono text-sm text-lime">0{i + 1}</span>
              <p className="text-[15px] leading-relaxed text-white/90">{t}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex justify-end">
          <button className="btn btn-primary" onClick={close} autoFocus>
            Got it — show me
          </button>
        </div>
      </div>
    </div>
  );
}
