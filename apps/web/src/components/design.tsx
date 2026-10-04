import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useInView, useReducedMotion } from 'motion/react';

/*
 * PRISM design system: roomy sections, a numbered mono label over every headline,
 * huge Space Grotesk headlines with one lime phrase, calm reveal animations
 * (transform/opacity only, once, and instant under prefers-reduced-motion).
 */

export const EASE = [0.2, 0.8, 0.2, 1] as const;

/** "02 / THE FORGE MACHINE" */
export function SectionLabel({ n, children, className = '' }: { n?: string; children: ReactNode; className?: string }) {
  return (
    <p className={`section-label ${className}`}>
      {n && <span className="text-lime/80">{n} / </span>}
      {children}
    </p>
  );
}

/**
 * A huge headline whose words rise in with a short stagger when it scrolls into view.
 * `accent` is the one phrase shown in lime.
 */
export function Headline({
  lead,
  accent,
  tail,
  as: Tag = 'h2',
  size = 'display',
  className = '',
}: {
  lead?: string;
  accent?: string;
  tail?: string;
  as?: 'h1' | 'h2' | 'h3';
  size?: 'display' | 'display-md';
  className?: string;
}) {
  const reduce = useReducedMotion();
  // watch the headline, not the words: a word hidden below its clip never counts as visible
  const ref = useRef<HTMLHeadingElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const words = [
    ...(lead ?? '').split(' ').filter(Boolean).map((w) => ({ w, lime: false })),
    ...(accent ?? '').split(' ').filter(Boolean).map((w) => ({ w, lime: true })),
    ...(tail ?? '').split(' ').filter(Boolean).map((w) => ({ w, lime: false })),
  ];
  const label = [lead, accent, tail].filter(Boolean).join(' ');
  return (
    <Tag ref={ref} className={`${size} ${className}`} aria-label={label}>
      {words.map(({ w, lime }, i) => (
        // the clip keeps each word hidden below its line until it rises
        <span key={i} aria-hidden className="inline-block overflow-hidden pb-[0.08em] align-top">
          <motion.span
            className={`inline-block ${lime ? 'text-lime' : ''}`}
            initial={reduce ? false : { y: '105%' }}
            animate={inView || reduce ? { y: '0%' } : undefined}
            transition={{ duration: 0.7, ease: EASE, delay: i * 0.055 }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </Tag>
  );
}

/** Fades and slides its children in once, when they scroll into view. */
export function Reveal({ children, delay = 0, className = '', y = 28 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** A Home section: numbered label, big headline, then content. */
export function Section({
  id,
  n,
  label,
  children,
  className = '',
}: {
  id?: string;
  n: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`section-y scroll-mt-20 ${className}`}>
      <div className="container-x">
        <SectionLabel n={n}>{label}</SectionLabel>
        <div className="mt-6">{children}</div>
      </div>
    </section>
  );
}

/** Counts from 0 up to `value` the first time it scrolls into view. */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('en-US') }: { value: number | null; format?: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView || value === null) return;
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, { duration: 1.6, ease: EASE, onUpdate: setShown });
    return () => controls.stop();
  }, [inView, value, reduce]);
  return (
    <span ref={ref} className="tabular-nums">
      {value === null ? '—' : format(shown)}
    </span>
  );
}
