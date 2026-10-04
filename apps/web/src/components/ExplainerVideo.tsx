import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

/** Rendered by `npm run video:render` (apps/video) into apps/web/public/media/. */
export const VIDEO = {
  mp4: '/media/prism-explainer.mp4',
  webm: '/media/prism-explainer.webm',
  poster: '/media/prism-explainer-poster.jpg',
};

/**
 * The 40-second explainer in a framed player: nothing loads until it is near the
 * screen; it plays muted on a loop while in view and pauses when scrolled away.
 * With prefers-reduced-motion it shows the poster and waits for the play button.
 */
export function ExplainerVideo() {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const near = useInView(frame, { once: true, margin: '600px 0px' });
  const inView = useInView(frame, { amount: 0.45 });
  const reduce = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false); // the viewer pressed pause
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v || !near) return;
    if (inView && !reduce && !paused) v.play().catch(() => undefined);
    if (!inView) v.pause();
  }, [inView, near, reduce, paused]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      setPaused(false);
      v.play().catch(() => undefined);
    } else {
      setPaused(true);
      v.pause();
    }
  };

  return (
    <div ref={frame} className="relative overflow-hidden rounded-[32px] border border-white/[0.08] bg-panel p-2 sm:p-3">
      <div className="relative aspect-video overflow-hidden rounded-[24px] bg-ink">
        {failed ? (
          <p className="absolute inset-0 grid place-items-center px-8 text-center text-sm text-mist">The explainer video couldn’t load.</p>
        ) : (
          <>
            <video
              ref={video}
              className="absolute inset-0 h-full w-full object-cover"
              poster={VIDEO.poster}
              muted
              loop
              playsInline
              preload="none"
              aria-label="PRISM explained in 40 seconds (no sound)"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            >
              {near && (
                <>
                  <source src={VIDEO.webm} type="video/webm" />
                  <source src={VIDEO.mp4} type="video/mp4" onError={() => setFailed(true)} />
                </>
              )}
            </video>
            {!playing && (
              <button
                type="button"
                onClick={toggle}
                className="absolute inset-0 grid place-items-center bg-ink/20 transition-colors hover:bg-ink/5"
                aria-label="Play the explainer"
              >
                <span className="grid h-20 w-20 place-items-center rounded-full bg-lime text-ink shadow-[0_0_40px_rgba(212,240,0,0.45)] transition-transform hover:scale-105">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                    <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
                  </svg>
                </span>
              </button>
            )}
            {playing && (
              <button
                type="button"
                onClick={toggle}
                className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-white/15 bg-ink/80 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white backdrop-blur hover:border-lime/60"
                aria-label="Pause the explainer"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
                  <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                </svg>
                Pause
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
