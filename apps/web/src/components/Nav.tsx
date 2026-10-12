import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import { PRISM_TOKEN, X_HANDLE, explorerAddressUrl, getDeployment, tokenPath } from '@prism/core';
import { WalletButton } from '../wallet/WalletButton';
import { TARGET_CHAIN } from '../wallet/config';
import { GemMark } from './Gem';

// Home is the logo; the pill lists the destinations ($PRISM once its token exists)
const LINKS: Array<{ to: string; label: string; soon?: boolean }> = [
  { to: '/leaderboards', label: 'Leaderboards' },
  { to: '/stocks', label: 'Stocks' },
  ...(PRISM_TOKEN ? [{ to: tokenPath(PRISM_TOKEN), label: '$PRISM' }] : []),
];

const Soon = () => (
  <span className="ml-1.5 rounded-full bg-amber-400/15 px-1.5 py-px align-[1px] font-mono text-[8px] font-bold tracking-[0.12em] text-amber-300">
    SOON
  </span>
);

/** PRISM's mark: a hexagonal cut gem with one dark "sold" facet. */
export function Logo({ size = 26 }: { size?: number }) {
  return <GemMark size={size} />;
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
          <TestnetStatus />

          <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-4 sm:flex lg:gap-8">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} className={link}>
                {l.label}
                {l.soon && <Soon />}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0">
            <WalletButton />
            {LINKS.length > 0 && (
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
            )}
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

export const STATUS_TOOLTIP = 'Live data from Robinhood Chain Testnet';

/** Navbar status: a green dot and "Testnet". */
function TestnetStatus() {
  return (
    <span title={STATUS_TOOLTIP} aria-label={STATUS_TOOLTIP} className="label inline-flex cursor-help items-center gap-1.5 text-[10px] text-mist">
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-up/60 motion-reduce:hidden" />
        <span className="relative h-2 w-2 rounded-full bg-up" />
      </span>
      {/* tablets: just the dot (the pill is full there); the word shows on phones and wide screens */}
      <span className="sm:hidden lg:inline">Testnet</span>
    </span>
  );
}

/** One slim row: logo and links on the left, the testnet notice on the right (two left-aligned lines on phones). */
export function Footer() {
  const a = 'inline-flex min-h-6 items-center text-mist transition-colors hover:text-white';
  const dot = <span aria-hidden className="text-white/20">·</span>;
  const reviews = getDeployment(TARGET_CHAIN.id)?.prismReviews;
  return (
    <footer className="border-t border-white/[0.06] bg-ink">
      <div className="container-x flex flex-col gap-3 py-6 text-[12px] md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:shrink-0 md:flex-nowrap md:gap-x-1.5 md:whitespace-nowrap xl:gap-x-3">
          <NavLink to="/" aria-label="PRISM — home" className="inline-flex min-h-6 items-center gap-1.5 text-white">
            <Logo size={18} />
            <span className="font-display text-[13px] font-bold tracking-[-0.02em]">PRISM</span>
          </NavLink>
          {dot}
          <a className={a} href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer">
            @{X_HANDLE} on X
          </a>
          {PRISM_TOKEN && (
            <>
              {dot}
              <NavLink className={a} to={tokenPath(PRISM_TOKEN)}>
                $PRISM
              </NavLink>
            </>
          )}
          {reviews && (
            <>
              {dot}
              <a className={a} href={`${explorerAddressUrl(reviews)}#code`} target="_blank" rel="noreferrer">
                Reviews contract
              </a>
            </>
          )}
          {dot}
          <a className={a} href="https://github.com/ace-coderr/prism" target="_blank" rel="noreferrer">
            GitHub
          </a>
          {dot}
          <a className={a} href="https://x.com/_ace_won" target="_blank" rel="noreferrer">
            Built by ace
          </a>
        </div>
        <p className="text-mist/70 md:text-right">Robinhood Chain Testnet · test assets only, no real value · PRISM never holds your money</p>
      </div>
    </footer>
  );
}
