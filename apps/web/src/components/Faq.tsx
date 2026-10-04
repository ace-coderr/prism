import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE } from './design';

/** One question: the lime "+" turns into "×" and the answer slides open. */
function Item({ q, children, open, onToggle }: { q: string; children: ReactNode; open: boolean; onToggle: () => void }) {
  const id = useId();
  return (
    <li className="border-b border-white/[0.08]">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-6 py-7 text-left transition-colors hover:text-lime"
        >
          <span className="font-display text-xl font-bold tracking-[-0.02em] md:text-2xl">{q}</span>
          <motion.span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-lime/40 text-2xl leading-none text-lime"
            animate={{ rotate: open ? 45 : 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            +
          </motion.span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="a"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="overflow-hidden"
          >
            <p className="body-copy pb-8 pr-14">{children}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function Faq({ items }: { items: Array<{ q: string; a: ReactNode }> }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <ul className="border-t border-white/[0.08]">
      {items.map((it, i) => (
        <Item key={it.q} q={it.q} open={open === i} onToggle={() => setOpen(open === i ? null : i)}>
          {it.a}
        </Item>
      ))}
    </ul>
  );
}
