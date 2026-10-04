import { useEffect, useState } from 'react';
import { viberAt } from '@prism/core';
import { ViberImage } from './Viber';

const KEY = 'prism.intro.seen.v1';

const CARDS = [
  { viber: 0, text: 'PRISM turns a few stocks and some ETH into one crystal you can hold.' },
  { viber: 1, text: 'The crystal keeps your tokens safe. Only you can take them out — no admin can touch them.' },
  { viber: 2, text: 'Its shape tells the story: size, today’s move, how jumpy the price is, and gold where it recovered.' },
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

/** First-visit intro: three viber cards, dismissible, shown once. */
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
      <div className="m-auto w-full max-w-3xl rounded-3xl border border-white/10 bg-panel p-5 shadow-2xl sm:p-7">
        <p className="label text-lime">New here?</p>
        <h2 id="intro-title" className="headline mt-2 text-3xl">PRISM in three cards</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {CARDS.map((c, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink/60 p-3 sm:flex-col sm:p-4 sm:text-center">
              {/* smaller and beside the text on phones, so all three cards fit on one screen */}
              <ViberImage viber={viberAt(c.viber)} size={112} className="h-16! w-16! rounded-xl sm:h-28! sm:w-28! sm:rounded-2xl" />
              <p className="text-sm leading-relaxed text-white/90">{c.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <button className="btn btn-primary" onClick={close} autoFocus>
            Got it — show me
          </button>
        </div>
      </div>
    </div>
  );
}
