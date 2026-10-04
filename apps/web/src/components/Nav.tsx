import { useEffect, useRef, useState } from 'react';
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

/** One slim row: logo and small links on the left, the testnet notice on the right. */
export function Footer() {
  const d = getDeployment(TARGET_CHAIN.id);
  const contract = d ? `${explorerAddressUrl(d.prismCrystal)}#code` : null;
  const a = 'text-mist transition-colors hover:text-white';
  const dot = <span aria-hidden className="text-white/20">·</span>;
  return (
    <footer className="border-t border-white/[0.06] bg-ink">
      <div className="container-x flex flex-col gap-2 py-5 text-[12px] md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <NavLink to="/" aria-label="PRISM — home" className="inline-flex items-center gap-1.5 text-white">
            <Logo size={16} />
            <span className="font-display text-[13px] font-bold tracking-[-0.02em]">PRISM</span>
          </NavLink>
          {dot}
          <a className={a} href="https://x.com/_ace_won" target="_blank" rel="noreferrer">
            Built by ace
          </a>
          {dot}
          <a className={a} href="https://github.com/ace-coderr/prism" target="_blank" rel="noreferrer">
            GitHub
          </a>
          {contract && (
            <>
              {dot}
              <a className={a} href={contract} target="_blank" rel="noreferrer">
                Contract
              </a>
            </>
          )}
        </div>
        <p className="text-mist/70">Robinhood Chain Testnet · test assets only, no real value</p>
      </div>
    </footer>
  );
}
