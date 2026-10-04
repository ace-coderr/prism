import { useEffect, useRef, type ReactNode } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { PixelGem } from './PixelGem';
import { Change } from './ui';
import { useTestnetTokens } from '../data/chain';
import { EASE } from './design';

/*
 * The Forge machine: four stations on a rail. When it scrolls into view the rail draws
 * itself, then a pulse of light runs station to station on a loop and each station
 * lights up as the pulse reaches it. Transform/opacity only; under reduced motion the
 * rail is simply drawn and every station is lit.
 */

const PICK_TOKENS = ['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI', 'WETH'] as const;
const LOOP_SECONDS = 6;
/** Where each station sits along the rail (0..1). */
const STOPS = [0, 1 / 3, 2 / 3, 1];

function useGlow(p: MotionValue<number>, at: number, lit: boolean) {
  // bright as the pulse arrives, fading out over the next stretch of rail
  return useTransform(p, (v) => {
    if (lit) return 1;
    const d = v - at;
    if (d < -0.04) return 0.0;
    if (d < 0) return 1 + d / 0.04;
    return Math.max(0, 1 - d / 0.28);
  });
}

function Station({
  n,
  title,
  caption,
  glow,
  children,
}: {
  n: string;
  title: string;
  caption: string;
  glow: MotionValue<number>;
  children: ReactNode;
}) {
  const ring = useTransform(glow, (g) => 0.15 + 0.85 * g);
  return (
    <div className="relative flex h-full flex-col">
      {/* node on the rail */}
      <div className="relative mx-auto hidden h-6 w-6 md:block">
        <span className="absolute inset-0 rounded-full border border-white/15 bg-ink" />
        <motion.span className="absolute inset-[5px] rounded-full bg-lime shadow-[0_0_18px_#d4f000]" style={{ opacity: ring }} />
      </div>
      <div className="relative mt-0 flex flex-1 flex-col rounded-3xl border border-white/[0.08] bg-ink/70 p-6 md:mt-6">
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-[-1px] rounded-3xl border border-lime/60 shadow-[0_0_40px_-12px_rgba(212,240,0,0.5)]"
          style={{ opacity: glow }}
        />
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-lime">{n}</span>
          <span className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-white">{title}</span>
        </div>
        <div className="grid min-h-[180px] flex-1 place-items-center py-6">{children}</div>
        <p className="text-sm leading-relaxed text-mist">{caption}</p>
      </div>
    </div>
  );
}

function TokenChips() {
  const live = useTestnetTokens();
  const byId = new Map(live.status === 'live' ? live.tokens.map((t) => [t.id, t]) : []);
  return (
    <ul className="grid w-full grid-cols-2 gap-2">
      {PICK_TOKENS.map((id) => {
        const m = byId.get(id)?.market;
        return (
          <li key={id} className="rounded-xl border border-white/10 bg-panel px-3 py-2">
            <span className="block font-mono text-[11px] font-bold tracking-tight text-white">{id === 'WETH' ? 'ETH' : id}</span>
            <span className="block text-[10px]">{m?.change24h != null ? <Change value={m.change24h} /> : <span className="text-mist">…</span>}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ForgeMachine() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduce = useReducedMotion();
  const draw = useMotionValue(reduce ? 1 : 0);
  const p = useMotionValue(-0.2);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      draw.set(1);
      return;
    }
    let loop: ReturnType<typeof animate> | null = null;
    const drawing = animate(draw, 1, { duration: 1.2, ease: EASE });
    drawing.then(() => {
      loop = animate(p, [0, 1.12], { duration: LOOP_SECONDS, ease: 'linear', repeat: Infinity, repeatDelay: 0.4 });
    });
    return () => {
      drawing.stop();
      loop?.stop();
    };
  }, [inView, reduce, draw, p]);

  const glows = [useGlow(p, STOPS[0]!, !!reduce), useGlow(p, STOPS[1]!, !!reduce), useGlow(p, STOPS[2]!, !!reduce), useGlow(p, STOPS[3]!, !!reduce)];
  // the forge station's cubes assemble as the pulse arrives and drift apart as the loop ends
  const assemble = useTransform(p, [-0.2, 0.2, 0.33, 0.95, 1.12], [0, 0, 1, 1, 0]);
  const forged = reduce ? undefined : assemble;
  const pulseX = useTransform(p, (v) => `${Math.min(1, Math.max(0, v)) * 100}%`);
  const pulseY = useTransform(p, (v) => `${Math.min(1, Math.max(0, v)) * 100}%`);
  const pulseOpacity = useTransform(p, [-0.2, 0, 0.98, 1.06], [0, 1, 1, 0]);

  return (
    <div ref={ref} className="relative overflow-hidden rounded-[32px] border border-white/[0.08] bg-gradient-to-b from-panel to-ink p-5 sm:p-8 md:p-10">
      {/* rail: horizontal on wide screens (through the nodes), vertical on phones */}
      <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[calc(2.5rem+11px)] hidden h-[2px] md:block">
        <span className="absolute inset-0 bg-white/[0.07]" />
        <motion.span className="absolute inset-0 origin-left bg-lime/40" style={{ scaleX: draw }} />
        <motion.span className="absolute inset-0" style={{ x: pulseX, opacity: pulseOpacity }}>
          <span className="absolute -top-[5px] left-0 h-3 w-16 -translate-x-full rounded-full bg-gradient-to-r from-transparent via-lime/70 to-lime shadow-[0_0_24px_#d4f000]" />
        </motion.span>
      </div>
      <div className="pointer-events-none absolute bottom-[12%] left-[calc(1.25rem+3px)] top-[12%] w-[2px] sm:left-[calc(2rem+3px)] md:hidden">
        <span className="absolute inset-0 bg-white/[0.07]" />
        <motion.span className="absolute inset-0 origin-top bg-lime/40" style={{ scaleY: draw }} />
        <motion.span className="absolute inset-0" style={{ y: pulseY, opacity: pulseOpacity }}>
          <span className="absolute -left-[5px] top-0 h-16 w-3 -translate-y-full rounded-full bg-gradient-to-b from-transparent via-lime/70 to-lime shadow-[0_0_24px_#d4f000]" />
        </motion.span>
      </div>

      <div className="relative grid gap-6 pl-6 md:grid-cols-4 md:pl-0">
        <Station n="01" title="Pick" caption="Real testnet tokens, with today’s move." glow={glows[0]!}>
          <TokenChips />
        </Station>
        <Station n="02" title="Forge" caption="One transaction fuses them into a crystal." glow={glows[1]!}>
          <PixelGem size={168} progress={forged} />
        </Station>
        <Station n="03" title="Hold" caption="Only you can withdraw." glow={glows[2]!}>
          <div className="relative">
            <PixelGem size={150} />
            <span className="absolute -bottom-1 -right-2 grid h-9 w-9 place-items-center rounded-full border border-lime/50 bg-ink text-lime" aria-hidden>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="4" y="9" width="12" height="8" rx="1.5" />
                <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
              </svg>
            </span>
          </div>
        </Station>
        <Station n="04" title="Gift or sell" caption="Sealed or not, the basket goes with it." glow={glows[3]!}>
          <div className="flex items-center gap-2">
            <PixelGem size={140} frost />
            <span className="font-mono text-xl text-[#bfe6ff]" aria-hidden>
              →
            </span>
          </div>
        </Station>
      </div>
    </div>
  );
}
