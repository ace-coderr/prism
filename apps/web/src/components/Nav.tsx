import { NavLink } from 'react-router-dom';
import { WalletButton } from '../wallet/WalletButton';

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/forge', label: 'Forge' },
  { to: '/crystals', label: 'My Crystals' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/agent', label: 'Agent' },
];

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

export function Nav() {
  return (
    <header className="z-20 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-5 px-4">
        <NavLink to="/" className="flex shrink-0 items-center gap-2.5">
          <Logo />
          <span className="headline text-xl tracking-[-0.02em]">PRISM</span>
        </NavLink>
        <nav className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                `label whitespace-nowrap rounded px-2.5 py-1.5 transition ${
                  isActive ? 'bg-lime/10 text-lime' : 'text-mist hover:text-white'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="shrink-0">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="label z-20 border-t border-line bg-ink px-4 py-2.5 text-center text-[10px] text-mist">
      Built for vibe/vibe on Robinhood Chain Testnet · Testnet only, no real funds.
    </footer>
  );
}
