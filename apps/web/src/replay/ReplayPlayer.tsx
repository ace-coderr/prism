import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useReducedMotion } from 'motion/react';
import { replayPlan, type ReplayTimeline } from '@prism/core';
import { SHARE, ShareOnX } from '../components/ShareOnX';
import { ReplayScene } from './ReplayScene';
import { canExportMp4, exportMp4, renderReplayAudio } from './encoder';
import { drawFrame, type OverlayInfo } from './overlay';
import { recordFormat, startRecording, type Recording } from './recorder';
import { scheduleReplaySound } from './sound';

const BG = '#101214';
type Format = 'square' | 'wide';
/** Video sizes: square by default (fits X's timeline best), 16:9 optional. */
const SIZE: Record<Format, [number, number]> = { square: [1080, 1080], wide: [1920, 1080] };
const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
/** Watching renders smaller (smooth on phones and mid-range laptops); a download renders full size. */
const PREVIEW_SCALE = isCoarse ? 0.5 : 2 / 3;

/** Advances the video clock while playing. Runs first each frame. */
function Driver({ clock, run, total, onEnd }: { clock: MutableRefObject<number>; run: MutableRefObject<{ start: number } | null>; total: number; onEnd: () => void }) {
  useFrame(() => {
    const r = run.current;
    if (!r) return;
    clock.current = Math.min(total, Math.max(0, (performance.now() - r.start) / 1000));
    if (clock.current >= total) {
      run.current = null;
      onEnd();
    }
  });
  return null;
}

/** After the 3D frame is rendered (with bloom): draw it and the overlay onto the shown canvas. */
function Composite({ draw }: { draw: (scene: HTMLCanvasElement) => void }) {
  const gl = useThree((s) => s.gl);
  useFrame(() => draw(gl.domElement), 2);
  return null;
}

/** Hands out the canvas's "render one frame now" for the frame-exact export. */
function Expose({ advance }: { advance: MutableRefObject<((t: number) => void) | null> }) {
  const fn = useThree((s) => s.advance);
  advance.current = fn;
  return null;
}

const nextFrames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

export function ReplayPlayer({ timeline, info, autoPlay = true }: { timeline: ReplayTimeline; info: OverlayInfo; autoPlay?: boolean }) {
  const reduce = !!useReducedMotion();
  const plan = useMemo(() => replayPlan(timeline), [timeline]);
  const [format, setFormat] = useState<Format>('square');
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<'rendering' | 'recording' | null>(null);
  const [frameloop, setFrameloop] = useState<'always' | 'never'>('always');
  const [state, setState] = useState<'idle' | 'playing' | 'ended'>('idle');
  const [soundOn, setSoundOn] = useState(false);
  const [exact, setExact] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<{ url: string; name: string; bytes: number; ext: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [W, H] = SIZE[format].map((v) => (exporting ? v : Math.round(v * PREVIEW_SCALE))) as [number, number];
  const out = useRef<HTMLCanvasElement>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  // under reduced motion nothing plays by itself: it rests on the end card
  const clock = useRef(reduce || !autoPlay ? plan.total : 0);
  const run = useRef<{ start: number } | null>(null);
  const advance = useRef<((t: number) => void) | null>(null);
  const audio = useRef<{ ctx: AudioContext; mix: GainNode; stop: () => void } | null>(null);
  const rec = useRef<Recording | null>(null);
  const progress = useRef<HTMLDivElement>(null);
  const percent = useRef<HTMLSpanElement>(null);
  const live = useMemo(() => (typeof window === 'undefined' ? null : recordFormat()), []);

  // the overlay's fonts, and whether this browser can make the MP4 frame by frame
  useEffect(() => {
    void Promise.all([document.fonts?.load('700 40px "Space Grotesk"'), document.fonts?.load('400 20px "Space Mono"'), document.fonts?.load('700 20px "Space Mono"')]).catch(() => {});
    void canExportMp4(...SIZE.wide).then(setExact);
  }, []);

  const draw = useCallback(
    (scene: HTMLCanvasElement) => {
      const ctx = out.current?.getContext('2d');
      if (!ctx) return;
      drawFrame(ctx, scene, timeline, plan, clock.current, info);
      if (progress.current) progress.current.style.width = `${(clock.current / plan.total) * 100}%`;
    },
    [timeline, plan, info],
  );

  const stopAudio = () => {
    audio.current?.stop();
    audio.current?.mix.disconnect();
  };

  const save = useCallback(
    (blob: Blob, ext: string) => {
      const name = `prism-crystal-${timeline.id}-replay-${formatRef.current}.${ext}`;
      const url = URL.createObjectURL(blob);
      setSaved((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url, name, bytes: blob.size, ext };
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    },
    [timeline.id],
  );

  const play = useCallback(
    async (record: boolean) => {
      setProblem(null);
      stopAudio();
      let audioStream: MediaStream | null = null;
      // sound: to the speakers when it's on, and into the recording when recording
      if (soundOn || record) {
        try {
          const ctx = audio.current?.ctx ?? new AudioContext();
          await ctx.resume();
          const mix = ctx.createGain();
          if (soundOn) mix.connect(ctx.destination);
          if (record) {
            const dest = ctx.createMediaStreamDestination();
            mix.connect(dest);
            audioStream = dest.stream;
          }
          const stop = scheduleReplaySound(ctx, mix, timeline, plan, ctx.currentTime + 0.1);
          audio.current = { ctx, mix, stop };
        } catch {
          audio.current = null; // no audio here: the picture still plays (and records silent)
        }
      }
      if (record && out.current) {
        try {
          rec.current = startRecording(out.current, audioStream);
        } catch (e) {
          setProblem(e instanceof Error ? e.message : 'This browser can’t record video.');
          setExporting(false);
          setBusy(null);
          return;
        }
      }
      clock.current = 0;
      run.current = { start: performance.now() + 100 };
      setState('playing');
    },
    [soundOn, timeline, plan],
  );

  const onEnd = useCallback(() => {
    setState('ended');
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    // a short tail so the last frames and the bell make it in
    setTimeout(async () => {
      save(await r.stop(), r.format.ext);
      setExporting(false);
      setBusy(null);
    }, 250);
  }, [save]);

  // autoplay (silent) once, unless reduced motion asks for stillness
  const started = useRef(false);
  useEffect(() => {
    if (started.current || reduce || !autoPlay) return;
    started.current = true;
    void play(false);
  }, [reduce, autoPlay, play]);

  // sound on/off while it plays
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    try {
      if (soundOn) a.mix.connect(a.ctx.destination);
      else a.mix.disconnect(a.ctx.destination);
    } catch {
      /* not connected */
    }
  }, [soundOn]);

  useEffect(
    () => () => {
      stopAudio();
      void audio.current?.ctx.close();
    },
    [],
  );

  const download = async () => {
    setSaved(null);
    setProblem(null);
    stopAudio();
    run.current = null;
    setExporting(true);
    await nextFrames(4); // let the full-size canvases settle
    const [w, h] = SIZE[formatRef.current];
    if (!(await canExportMp4(w, h))) {
      // no WebCodecs H.264 + AAC here: record it as it plays instead
      setBusy('recording');
      await play(true);
      return;
    }
    // frame-exact: stop the live loop, then render and encode every frame in turn
    setBusy('rendering');
    setFrameloop('never');
    await nextFrames(2);
    try {
      const sound = await renderReplayAudio(timeline, plan).catch(() => null);
      const blob = await exportMp4({
        canvas: out.current!,
        total: plan.total,
        audio: sound,
        renderAt: (s) => {
          clock.current = s;
          advance.current?.(performance.now());
        },
        onProgress: (p) => {
          if (percent.current) percent.current.textContent = `${Math.round(p * 100)}%`;
        },
      });
      save(blob, 'mp4');
    } catch (e) {
      setProblem(`Couldn’t make the video: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clock.current = plan.total;
      setState('ended');
      setFrameloop('always');
      setExporting(false);
      setBusy(null);
    }
  };

  const fallbackWebm = exact === false && live?.ext === 'webm';
  return (
    <div className="flex flex-col gap-5">
      <div className={`relative mx-auto w-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-ink ${format === 'square' ? 'max-w-[640px]' : 'max-w-[1100px]'}`}>
        {/* the 3D renders here at the video's exact size, unseen; what you see is the canvas below */}
        <div aria-hidden className="pointer-events-none absolute left-0 top-0 opacity-0" style={{ width: W, height: H }}>
          <Canvas dpr={1} frameloop={frameloop} gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }} camera={{ position: [0, 0, 20], fov: 32 }}>
            <color attach="background" args={[BG]} />
            <ambientLight intensity={0.6} />
            <directionalLight position={[4, 7, 5]} intensity={0.8} />
            <directionalLight position={[-5, -2, -3]} intensity={0.25} color="#d4f000" />
            <Expose advance={advance} />
            <Driver clock={clock} run={run} total={plan.total} onEnd={onEnd} />
            <ReplayScene timeline={timeline} plan={plan} clock={clock} reduce={reduce} />
            <EffectComposer multisampling={isCoarse ? 0 : 4}>
              <Bloom mipmapBlur luminanceThreshold={0.95} luminanceSmoothing={0.15} intensity={0.55} radius={0.4} />
            </EffectComposer>
            <Composite draw={draw} />
          </Canvas>
        </div>
        <canvas
          ref={out}
          width={W}
          height={H}
          role="img"
          aria-label={`Replay of crystal #${timeline.id}: its life from the forge to now`}
          className="relative block h-auto w-full"
          style={{ aspectRatio: `${SIZE[format][0]} / ${SIZE[format][1]}` }}
        />
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div ref={progress} className="h-full bg-lime" style={{ width: '0%' }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => play(false)}>
          {state === 'playing' ? 'Restart' : state === 'ended' ? 'Play again' : 'Play'}
        </button>
        <button
          type="button"
          className={`btn ${soundOn ? 'btn-outline !border-lime !text-lime' : 'btn-outline'}`}
          aria-pressed={soundOn}
          onClick={() => setSoundOn((s) => !s)}
        >
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
        <span role="group" aria-label="Video shape" className="inline-flex overflow-hidden rounded-full border border-white/15">
          {(['square', 'wide'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={format === f}
              disabled={!!busy}
              onClick={() => setFormat(f)}
              className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] ${format === f ? 'bg-lime text-ink' : 'text-mist hover:text-white'}`}
            >
              {f === 'square' ? 'Square 1:1' : 'Wide 16:9'}
            </button>
          ))}
        </span>
      </div>

      <div className="card mx-auto flex w-full max-w-[640px] flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={!!busy || (exact === false && !live)} onClick={download}>
            {busy === 'rendering' ? 'Making the video…' : busy === 'recording' ? 'Recording…' : 'Download video'}
          </button>
          <ShareOnX text={SHARE.replay(timeline.id)} />
        </div>
        <p className="text-sm text-mist">
          {busy === 'rendering' ? (
            <>
              Making the {Math.round(plan.total)}-second video frame by frame (30 fps, with sound): <span ref={percent}>0%</span>
            </>
          ) : busy === 'recording' ? (
            `Recording the ${Math.round(plan.total)}-second replay with sound… keep this tab open.`
          ) : saved ? (
            `Saved ${saved.name} (${(saved.bytes / 1024 / 1024).toFixed(1)} MB). `
          ) : (
            `Download makes the ${Math.round(plan.total)}-second replay right here in your browser (${format === 'square' ? '1080×1080' : '1920×1080'}, ${exact === false && live ? live.ext.toUpperCase() : 'MP4'}). `
          )}
          {!busy && 'X links can’t carry a video: download it first, then attach it to your post.'}
        </p>
        {fallbackWebm && (
          <p className="text-sm text-amber-300/90">
            This browser saves WebM. X needs MP4: convert it first (for example with HandBrake), or download from Chrome, Edge or Safari.
          </p>
        )}
        {exact === false && !live && <p className="text-sm text-down">This browser can’t make videos. Try Chrome, Edge or Safari.</p>}
        {saved && (
          <a href={saved.url} download={saved.name} className="font-mono text-xs text-lime underline">
            Download again ({saved.ext.toUpperCase()})
          </a>
        )}
        {problem && <p className="text-sm text-down">{problem}</p>}
      </div>
    </div>
  );
}
