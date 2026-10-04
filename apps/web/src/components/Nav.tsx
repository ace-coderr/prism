import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import { explorerAddressUrl, getDeployment } from '@prism/core';
import { TARGET_CHAIN } from '../wallet/config';
import { WalletButton } from '../wallet/WalletButton';

// Home is the logo; the pill only lists the four destinations
const LINKS: Array<{ to: string; label: string; soon?: boolean }> = [
  { to: '/forge', label: 'Forge' },
  { to: '/my-crystals', label: 'My Crystals' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/agent', label: 'Agent', soon: true },
];

const Soon = () => (
  <span className="ml-1.5 rounded-full bg-amber-400/15 px-1.5 py-px align-[1px] font-mono text-[8px] font-bold tracking-[0.12em] text-amber-300">
    SOON
  </span>
);

// PRISM mark: a pixel/voxel gem — crown on top, pointed pavilion below.
const GEM = ['..AAA..', '.ABBBA.', 'ABBGBBA', '.CCCCC.', '..CCC..', '...C...'];
const SHADES: Record<string, string> = { A: '#e6ff5c', B: '#d4f000', C: '#8fa300', G: '#f6c143' };

export function Logo({ size = 26 }: { size?: number }) {
  const cell = 3;
  return (
    <svg viewBox="-1 -1 23 20" width={size} height={size} aria-hidden>
      {GEM.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === '.' ? null : (
            <rect
              key={`${x}-${y}`}
              x={x * cell}
              y={y * cell}
              width={cell}
              height={cell}
              fill={SHADES[ch]}
              stroke="#000"
              strokeWidth={0.7}
            />
          ),
        ),
      )}
    </svg>
  );
}

/**
 * Floating pill navbar: fixed 16px from the top, centred, max 880px. Brand on the
 * left (links Home), mono links in the middle, one pill CTA on the right. Below
 * 640px the links move into a menu panel under the pill.
 */
export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  // after a little scrolling the pill tucks in: slightly smaller and more opaque
  const { scrollY } = useScroll();
  const [compact, setCompact] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setCompact(y > 40));

  // close the mobile menu on navigation, outside click or Escape
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const link = ({ isActive }: { isActive: boolean }) =>
    `label whitespace-nowrap transition-colors ${isActive ? 'text-lime' : 'text-mist hover:text-white'}`;

  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <motion.div
        ref={ref}
        className="pointer-events-auto relative w-full max-w-[880px] origin-top"
        animate={compact ? { scale: 0.95, y: -6 } : { scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      >
        <div
          className={`flex h-[52px] items-center gap-3 rounded-full border pl-4 pr-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)] backdrop-blur-md transition-colors duration-300 sm:h-14 sm:pr-2 ${
            compact ? 'border-white/12 bg-panel/95' : 'border-white/10 bg-panel/75'
          }`}
        >
          <NavLink to="/" aria-label="PRISM — home" className="flex shrink-0 items-center gap-2">
            <Logo size={24} />
            <span className="hidden font-display text-lg font-bold tracking-[-0.02em] sm:inline">PRISM</span>
          </NavLink>

          <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-5 sm:flex md:gap-8">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} className={link}>
                {l.label}
                {l.soon && <Soon />}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0">
            <WalletButton />
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full text-mist transition hover:bg-white/5 hover:text-white sm:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            id="mobile-menu"
            aria-label="Main"
            className="absolute inset-x-0 top-full mt-2 flex flex-col rounded-3xl border border-white/10 bg-panel/95 p-2 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)] backdrop-blur-md sm:hidden"
          >
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => `rounded-2xl px-4 py-3 ${link({ isActive })} ${isActive ? 'bg-lime/5' : 'hover:bg-white/5'}`}
              >
                {l.label}
                {l.soon && <Soon />}
              </NavLink>
            ))}
          </nav>
        )}
      </motion.div>
    </header>
  );
}

export const LIVE_URL = 'https://prism-crystal.vercel.app';

const SOCIALS: Array<{ label: string; detail: string; href: string; icon: ReactNode }> = [
  {
    label: 'GitHub',
    detail: 'ace-coderr/prism',
    href: 'https://github.com/ace-coderr/prism',
    icon: (
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    ),
  },
  {
    label: 'X',
    detail: '@_ace_won',
    href: 'https://x.com/_ace_won',
    icon: <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.42 4.7H5.6l11.07 14.5Z" />,
  },
  {
    label: 'Contract',
    detail: 'Verified on Blockscout',
    href: '',
    icon: <path d="M7 3h7l5 5v13H7V3Zm7 1.5V9h4.5M10 13h6M10 16.5h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  },
  {
    label: 'vibe/vibe',
    detail: 'testnet.vibevibe.fun',
    href: 'https://testnet.vibevibe.fun',
    // a plain globe (a link out), not vibe/vibe's own mark
    icon: (
      <path
        d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9m0-18C9.6 5.4 8.4 8.4 8.4 12s1.2 6.6 3.6 9M3.5 9h17M3.5 15h17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ),
  },
];

export function Footer() {
  const d = getDeployment(TARGET_CHAIN.id);
  const contract = d ? `${explorerAddressUrl(d.prismCrystal)}#code` : null;
  return (
    <footer className="border-t border-white/[0.06] bg-ink">
      <div className="container-x py-20 md:py-28">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-sm">
            <NavLink to="/" className="inline-flex items-center gap-3" aria-label="PRISM — home">
              <Logo size={36} />
              <span className="font-display text-3xl font-bold tracking-[-0.03em]">PRISM</span>
            </NavLink>
            <p className="mt-4 text-sm leading-relaxed text-mist">A stock basket you can hold. Built for vibe/vibe on Robinhood Chain Testnet.</p>
          </div>
          <ul className="grid flex-1 gap-4 sm:grid-cols-2 lg:max-w-2xl">
            {SOCIALS.filter((s) => s.href || contract).map((s) => (
              <li key={s.label}>
                <a
                  href={s.href || contract!}
                  target="_blank"
                  rel="noreferrer"
                  className="card card-hover group flex items-center gap-4 p-5"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" className="shrink-0 text-white/80" aria-hidden>
                    {s.icon}
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg font-bold">{s.label}</span>
                    <span className="block truncate font-mono text-[11px] text-mist">{s.detail}</span>
                  </span>
                  <span
                    aria-hidden
                    className="text-xl text-mist transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1 group-hover:text-lime"
                  >
                    ↗
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <p className="section-label mt-16 border-t border-white/[0.06] pt-8 text-[10px] leading-relaxed">
          Testnet only · no real funds · test assets have no value ·{' '}
          <a className="text-lime/80 hover:text-lime" href={LIVE_URL} target="_blank" rel="noreferrer">
            prism-crystal.vercel.app
          </a>
        </p>
      </div>
    </footer>
  );
}
