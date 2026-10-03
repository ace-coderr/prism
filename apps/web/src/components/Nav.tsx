import { NavLink } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/forge', label: 'Forge' },
  { to: '/crystals', label: 'My Crystals' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/agent', label: 'Agent' },
];

export function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9db7ff" />
          <stop offset="0.5" stopColor="#c7a6ff" />
          <stop offset="1" stopColor="#7affc8" />
        </linearGradient>
      </defs>
      <path d="M12 1 21 8.5 12 23 3 8.5Z" fill="url(#lg)" opacity="0.9" />
      <path d="M3 8.5h18M12 1 8 8.5 12 23l4-14.5Z" stroke="#06060a" strokeWidth="0.8" fill="none" opacity="0.5" />
    </svg>
  );
}

export function Nav() {
  return (
    <header className="z-20 border-b border-line/80 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <NavLink to="/" className="flex shrink-0 items-center gap-2">
          <Logo />
          <span className="font-display text-lg font-bold tracking-[0.2em]">PRISM</span>
        </NavLink>
        <nav className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
                  isActive ? 'bg-white/10 text-white' : 'text-mist hover:text-white'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-mist sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Robinhood Chain Testnet
        </span>
      </div>
    </header>
  );
}
