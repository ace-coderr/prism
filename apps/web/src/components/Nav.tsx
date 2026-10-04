import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
      <div ref={ref} className="pointer-events-auto relative w-full max-w-[880px]">
        <div className="flex h-[52px] items-center gap-3 rounded-full border border-white/10 bg-panel/80 pl-4 pr-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)] backdrop-blur-md sm:h-14 sm:pr-2">
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
      </div>
    </header>
  );
}

export const LIVE_URL = 'https://prism-crystal.vercel.app';

export function Footer() {
  const d = getDeployment(TARGET_CHAIN.id);
  return (
    <footer className="label z-20 border-t border-line bg-ink px-4 py-2.5 text-center text-[10px] text-mist">
      Built for vibe/vibe on Robinhood Chain Testnet · Testnet only, no real funds ·{' '}
      <a className="text-lime/80 hover:text-lime" href={LIVE_URL} target="_blank" rel="noreferrer">
        prism-crystal.vercel.app
      </a>
      {d && (
        <>
          {' '}
          · Contract{' '}
          <a className="text-lime/80 hover:text-lime" href={`${explorerAddressUrl(d.prismCrystal)}#code`} target="_blank" rel="noreferrer">
            {d.prismCrystal.slice(0, 6)}…{d.prismCrystal.slice(-4)} ↗
          </a>
        </>
      )}
    </footer>
  );
}
