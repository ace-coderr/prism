import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

/** Rendered by `npm run video:render` (apps/video) into apps/web/public/media/. */
export const VIDEO = {
  webm: '/media/prism-explainer.webm',
  mp4: '/media/prism-explainer.mp4',
  poster: '/media/prism-explainer-poster.jpg',
};

type Phase = 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';

/**
 * The 40-second explainer in a framed player.
 * - Nothing downloads until the player is near the screen; then the browser picks the
 *   first source it can decode: WebM/VP9, else MP4/H.264 (Chromium builds without
 *   H.264 can only play the WebM).
 * - The poster stays on top until the first real frame has been decoded, so the frame
 *   is never a black box.
 * - "Pause" only shows once frames are actually playing (the `playing` event, not
 *   `play`). If autoplay is refused or nothing plays within a few seconds, a big play
 *   button shows instead. Reduced motion: poster + play button, no autoplay.
 * - No transformed / reveal-animated wrapper around the <video>: some Chrome GPU paths
 *   render video black inside transformed, clipped layers.
 */
export function ExplainerVideo() {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const near = useInView(frame, { once: true, margin: '600px 0px' });
  const inView = useInView(frame, { amount: 0.4 });
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [hasFrame, setHasFrame] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  // sources are attached when near; load() makes the browser (re)select one
  useEffect(() => {
    if (near) video.current?.load();
  }, [near]);

  const play = () => {
    const v = video.current;
    if (!v) return;
    setPhase((p) => (p === 'playing' ? p : 'loading'));
    v.play().catch(() => setPhase((p) => (p === 'playing' ? p : 'blocked')));
  };

  useEffect(() => {
    const v = video.current;
    if (!v || !near) return;
    if (inView && !reduce && !userPaused) play();
    else if (!inView && !v.paused) v.pause();
  }, [inView, near, reduce, userPaused]);

  // still no picture a few seconds after asking: offer the play button
  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setTimeout(() => setPhase((p) => (p === 'loading' ? 'blocked' : p)), 6000);
    return () => clearTimeout(t);
  }, [phase]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (phase === 'playing') {
      setUserPaused(true);
      v.pause();
    } else {
      setUserPaused(false);
      play();
    }
  };

  return (
    <div ref={frame} className="rounded-[32px] border border-white/[0.08] bg-panel p-2 sm:p-3">
      <div className="relative aspect-video rounded-[24px] bg-ink">
        <video
          ref={video}
          className="absolute inset-0 h-full w-full rounded-[24px] object-cover"
          poster={VIDEO.poster}
          muted
          loop
          playsInline
          preload="none"
          aria-label="PRISM explained in 40 seconds (no sound)"
          onPlaying={() => setPhase('playing')}
          onPause={() => setPhase((p) => (p === 'error' ? p : 'paused'))}
          onLoadedData={() => setHasFrame(true)}
          onTimeUpdate={(e) => e.currentTarget.currentTime > 0 && setHasFrame(true)}
          onError={() => setPhase('error')}
        >
          {near && (
            <>
              <source src={VIDEO.webm} type='video/webm; codecs="vp9"' />
              <source src={VIDEO.mp4} type='video/mp4; codecs="avc1.640028"' onError={() => setPhase('error')} />
            </>
          )}
        </video>

        {/* the poster on top until a real frame is on screen */}
        {!hasFrame && (
          <img src={VIDEO.poster} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full rounded-[24px] object-cover" loading="lazy" />
        )}

        {phase === 'playing' ? (
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
        ) : phase === 'error' ? (
          <p className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-ink/85 px-4 py-2 text-center text-xs text-mist">
            This browser can’t play the video.
          </p>
        ) : (
          <button
            type="button"
            onClick={toggle}
            className="absolute inset-0 grid place-items-center rounded-[24px] bg-ink/10 transition-colors hover:bg-ink/0"
            aria-label="Play the explainer"
          >
            <span className="grid h-20 w-20 place-items-center rounded-full bg-lime text-ink shadow-[0_0_40px_rgba(212,240,0,0.45)] transition-transform hover:scale-105">
              {phase === 'loading' ? (
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink/30 border-t-ink motion-reduce:animate-none" aria-hidden />
              ) : (
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                  <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
                </svg>
              )}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
