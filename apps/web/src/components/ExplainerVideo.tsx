import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

/** Rendered by `npm run video:render` (apps/video) into apps/web/public/media/. */
export const VIDEO = {
  webm: '/media/prism-explainer.webm',
  mp4: '/media/prism-explainer.mp4',
  poster: '/media/prism-explainer-poster.jpg',
};

/** Scene starts in seconds (apps/video/src/Explainer.tsx `S`, at 30 fps). */
export const SCENES: Array<{ at: number; name: string }> = [
  { at: 0, name: 'Hook' },
  { at: 4, name: 'Pick' },
  { at: 8.5, name: 'Forge' },
  { at: 14.5, name: 'Read it' },
  { at: 20.5, name: 'Gold seams' },
  { at: 27.5, name: 'Gift' },
  { at: 32.5, name: 'Trust' },
  { at: 36, name: 'Start' },
];
const FALLBACK_DURATION = 40;
const SKIP = 5;
const HIDE_AFTER_MS = 2000;

type Phase = 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const canHover = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;

/**
 * The 40-second explainer in a framed player with its own control bar.
 * - Nothing downloads until the player is near the screen; then the browser picks the
 *   first source it can decode: WebM/VP9, else MP4/H.264.
 * - Muted autoplay while in view; the poster stays on top until a real frame is decoded;
 *   a big play button shows if autoplay is refused. Reduced motion: no autoplay.
 * - Control bar: play/pause · progress (click or drag to seek; scene ticks you can hover
 *   and click with a mouse) · time · fullscreen. On a mouse it fades in on hover and while paused, and out 2s after the
 *   mouse stops; on touch screens it is always shown.
 * - Keyboard (when the player has focus): Space = play/pause, ←/→ = 5s back/forward,
 *   F = fullscreen.
 */
export function ExplainerVideo() {
  const frame = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const near = useInView(frame, { once: true, margin: '600px 0px' });
  const inView = useInView(frame, { amount: 0.4 });
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [hasFrame, setHasFrame] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(FALLBACK_DURATION);
  const [hover, setHover] = useState<{ x: number; time: number; scene?: string } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mouse] = useState(canHover);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // sources are attached when near; load() makes the browser (re)select one
  useEffect(() => {
    if (near) video.current?.load();
  }, [near]);

  const play = useCallback(() => {
    const v = video.current;
    if (!v) return;
    setPhase((p) => (p === 'playing' ? p : 'loading'));
    v.play().catch(() => setPhase((p) => (p === 'playing' ? p : 'blocked')));
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v || !near) return;
    if (inView && !reduce && !userPaused) play();
    else if (!inView && !v.paused) v.pause();
  }, [inView, near, reduce, userPaused, play]);

  // still no picture a few seconds after asking: offer the play button
  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = setTimeout(() => setPhase((p) => (p === 'loading' ? 'blocked' : p)), 6000);
    return () => clearTimeout(timer);
  }, [phase]);

  // smooth progress while playing (timeupdate alone only fires ~4 times a second)
  useEffect(() => {
    if (phase !== 'playing') return;
    let raf = 0;
    const tick = () => {
      if (video.current && !scrubbing) setT(video.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, scrubbing]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === player.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

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

  const seek = (time: number) => {
    const v = video.current;
    if (!v) return;
    const to = Math.min(Math.max(0, time), duration - 0.05);
    v.currentTime = to;
    setT(to);
    setHasFrame(true);
  };

  const toggleFullscreen = () => {
    const el = player.current;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el?.requestFullscreen) void el.requestFullscreen();
    else v?.webkitEnterFullscreen?.(); // iPhone Safari: native fullscreen player
  };

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return { x: f * r.width, time: f * duration };
  };

  const onTrackDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    seek(timeAt(e.clientX).time);
  };
  const onTrackMove = (e: PointerEvent<HTMLDivElement>) => {
    const at = timeAt(e.clientX);
    if (e.pointerType === 'mouse') setHover((h) => ({ ...at, scene: h?.scene }));
    if (scrubbing) seek(at.time);
  };
  const onTrackUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setScrubbing(false);
  };

  // show the bar, then hide it 2s after the mouse stops
  const wake = () => {
    setActive(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), HIDE_AFTER_MS);
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const onButton = (e.target as HTMLElement).tagName === 'BUTTON';
    if ((e.key === ' ' || e.key === 'Enter') && onButton) return; // the button handles it
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(t - SKIP);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seek(t + SKIP);
    } else if (e.key === 'f') {
      e.preventDefault();
      toggleFullscreen();
    } else return;
    wake();
  };

  const playing = phase === 'playing';
  const showBar = !mouse || !playing || active || scrubbing || focused;
  const pct = (time: number) => `${Math.min(100, (time / duration) * 100)}%`;
  const radius = fullscreen ? '' : 'rounded-[24px]';

  return (
    <div ref={frame} className="rounded-[32px] border border-white/[0.08] bg-panel p-2 sm:p-3">
      <div
        ref={player}
        tabIndex={0}
        role="region"
        aria-label="PRISM explainer video player. Space plays or pauses, arrow keys skip 5 seconds."
        onKeyDown={onKey}
        onMouseMove={wake}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setFocused(false)}
        className={`relative aspect-video bg-ink outline-none focus-visible:ring-2 focus-visible:ring-lime/70 ${radius} ${fullscreen ? 'bg-black' : ''}`}
      >
        <video
          ref={video}
          className={`absolute inset-0 h-full w-full ${fullscreen ? 'object-contain' : 'object-cover'} ${radius}`}
          poster={VIDEO.poster}
          muted
          loop
          playsInline
          preload="none"
          aria-label="PRISM explained in 40 seconds (no sound)"
          onClick={toggle}
          onPlaying={() => setPhase('playing')}
          onPause={() => setPhase((p) => (p === 'error' ? p : 'paused'))}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onLoadedData={() => setHasFrame(true)}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime > 0) setHasFrame(true);
            if (!scrubbing) setT(e.currentTarget.currentTime);
          }}
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
          <img src={VIDEO.poster} alt="" aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${radius}`} loading="lazy" />
        )}

        {phase === 'error' ? (
          <p className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-full bg-ink/85 px-4 py-2 text-center text-xs text-mist">
            This browser can’t play the video.
          </p>
        ) : (
          !playing &&
          !scrubbing && (
            <button
              type="button"
              onClick={toggle}
              className={`absolute inset-x-0 bottom-14 top-0 grid place-items-center bg-ink/10 transition-colors hover:bg-ink/0 ${radius}`}
              aria-label="Play the explainer"
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-lime text-ink shadow-[0_0_40px_rgba(212,240,0,0.45)] transition-transform hover:scale-105 sm:h-20 sm:w-20">
                {phase === 'loading' ? (
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink/30 border-t-ink motion-reduce:animate-none" aria-hidden />
                ) : (
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                    <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
                  </svg>
                )}
              </span>
            </button>
          )
        )}

        {/* control bar */}
        <div
          className={`absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pb-2 pt-8 transition-opacity duration-300 sm:gap-3 sm:px-4 sm:pb-3 ${
            fullscreen ? '' : 'rounded-b-[24px]'
          } ${showBar ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition-colors hover:bg-white/10 hover:text-lime"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />}
            </svg>
          </button>

          <div
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(t)}
            aria-valuetext={`${clock(t)} of ${clock(duration)}`}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            onPointerLeave={() => setHover(null)}
            className="group/bar relative h-8 min-w-0 flex-1 cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-lime/60"
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/bar:h-1.5">
              <div className="h-full bg-lime" style={{ width: pct(t) }} />
            </div>
            {/* touch screens: ticks are markers only (Chrome snaps taps to nearby buttons, which would hijack seeking) */}
            {!mouse &&
              SCENES.slice(1).map((s) => (
                <span
                  key={s.name}
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 h-2.5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70"
                  style={{ left: pct(s.at) }}
                />
              ))}
            {mouse &&
              SCENES.slice(1).map((s) => (
              <button
                key={s.name}
                type="button"
                tabIndex={-1}
                aria-label={`Jump to ${s.name} (${clock(s.at)})`}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerEnter={() => setHover((h) => (h ? { ...h, scene: s.name } : { x: 0, time: s.at, scene: s.name }))}
                onPointerLeave={() => setHover((h) => (h ? { ...h, scene: undefined } : null))}
                onClick={(e) => {
                  e.stopPropagation();
                  seek(s.at);
                }}
                className="absolute top-1/2 grid h-6 w-3 -translate-x-1/2 -translate-y-1/2 place-items-center"
                style={{ left: pct(s.at) }}
              >
                <span className="h-2.5 w-[2px] rounded-full bg-white/70" />
              </button>
              ))}
            <span
              aria-hidden
              className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime shadow-[0_0_10px_rgba(212,240,0,0.6)] transition-transform ${
                scrubbing ? 'scale-125' : ''
              }`}
              style={{ left: pct(t) }}
            />
            {hover && (
              <span
                className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink/95 px-2 py-1 font-mono text-[11px] text-white ring-1 ring-white/10"
                style={{ left: hover.scene ? pct(SCENES.find((s) => s.name === hover.scene)!.at) : hover.x }}
              >
                {hover.scene ?? clock(hover.time)}
              </span>
            )}
          </div>

          <span className="shrink-0 font-mono text-[11px] tabular-nums text-white/90 sm:text-xs" aria-hidden>
            {clock(t)} / {clock(duration)}
          </span>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition-colors hover:bg-white/10 hover:text-lime"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {fullscreen ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
