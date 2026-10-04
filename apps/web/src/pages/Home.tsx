import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { explorerAddressUrl, getDeployment } from '@prism/core';
import { FittedCrystal, type CrystalFocus } from '../components/Crystal';
import { Logo } from '../components/Nav';
import { Stage } from '../components/Stage';
import { LiveBadge } from '../components/ui';
import { ViberGuide } from '../components/Viber';
import { WalletButton } from '../wallet/WalletButton';
import { TARGET_CHAIN } from '../wallet/config';
import { useTestnetTokens } from '../data/chain';
import { liveBasket } from '../data/crystalHoldings';

/** The live basket (real 24h moves, jumpiness and drops), or null while it loads. */
function useLiveBasket() {
  const live = useTestnetTokens();
  return useMemo(() => ({ basket: liveBasket(live), failed: live.status === 'error' }), [live]);
}

/** Breathing room between the crystal and the headline, as a fraction of the canvas height. */
const HEADLINE_GAP = 0.04;

function Hero({ textTop }: { textTop: number }) {
  const { basket } = useLiveBasket();
  if (!basket) return null;
  // camera fitted to the crystal's bounding sphere, inside the space above the headline
  return (
    <FittedCrystal
      holdings={basket.holdings}
      history={basket.history}
      size={1.75}
      spin={0.22}
      top={0.06}
      bottom={Math.max(0.35, textTop - HEADLINE_GAP)}
    />
  );
}

export default function Home() {
  // where the headline block starts, as a fraction of the hero height (re-measured on resize)
  const heroRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [textTop, setTextTop] = useState(0.55);
  useLayoutEffect(() => {
    const page = heroRef.current;
    const text = textRef.current;
    if (!page || !text) return;
    const update = () => {
      const p = page.getBoundingClientRect();
      if (p.height > 0) setTextTop((text.getBoundingClientRect().top - p.top) / p.height);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(page);
    ro.observe(text);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto">
      {/* ---------------------------------------------------------------- hero */}
      <section ref={heroRef} className="relative h-full min-h-[560px]">
        <Stage className="!absolute inset-0" camera={{ position: [0, 0, 7], fov: 40 }}>
          <Hero textTop={textTop} />
        </Stage>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/80 to-transparent px-4 pt-24 pb-8 sm:pb-10">
          <div ref={textRef} className="pointer-events-auto mx-auto flex max-w-3xl flex-col items-center text-center">
            <p className="label mb-4 text-lime">Stocks + ETH → one crystal</p>
            <h1 className="headline text-5xl sm:text-7xl">A stock basket you can hold</h1>
            <p className="mt-4 max-w-xl text-sm text-white/80 sm:text-base">
              Pick a few stocks and some ETH. PRISM puts them inside one crystal that you own — hold it, gift it, or sell it.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link to="/forge" className="btn btn-primary">
                Forge a crystal
              </Link>
              <WalletButton variant="hero" />
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <HeroStatus />
              <a href="#how" className="label text-[10px] text-mist/80 hover:text-white">
                How it works ↓
              </a>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-20 px-4 pb-16 pt-14">
        <HowItWorks />
        <ReadYourCrystal />
        <WhatsReal />
      </div>
    </div>
  );
}

function HeroStatus() {
  const { basket, failed } = useLiveBasket();
  if (basket) return <LiveBadge>Built from live testnet prices</LiveBadge>;
  return <span className="label text-[10px] text-mist">{failed ? 'Couldn’t reach the chain right now' : 'Reading live prices from the chain…'}</span>;
}

// ---------------------------------------------------------------- how it works

function Step({ n, title, children, visual }: { n: number; title: string; children: ReactNode; visual: ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-panel p-5">
      <div className="grid h-24 place-items-center rounded-2xl bg-ink/60">{visual}</div>
      <p className="label mt-4 text-lime">Step {n}</p>
      <h3 className="headline mt-1 text-2xl">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-mist">{children}</p>
    </div>
  );
}

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full border border-white/15 px-2.5 py-1 font-mono text-[11px] text-white">{children}</span>
);

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="label text-lime">How it works</p>
          <h2 className="headline mt-2 text-4xl">Three steps</h2>
        </div>
        <ViberGuide index={3} className="md:max-w-sm">
          Think of it like a gift box for stocks. You fill it, close it, and the box itself becomes yours.
        </ViberGuide>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Step
          n={1}
          title="Pick stocks + ETH"
          visual={
            <div className="flex flex-wrap justify-center gap-1.5">
              <Chip>NVDA</Chip>
              <Chip>SPCX</Chip>
              <Chip>AAPL</Chip>
              <Chip>ETH</Chip>
            </div>
          }
        >
          Choose up to 8 test stocks and decide how much of each to put in. You can add ETH too.
        </Step>
        <Step n={2} title="Forge your crystal" visual={<Logo size={56} />}>
          PRISM locks those tokens inside one crystal (an NFT) in your wallet. It holds your stocks, and only you can take
          them out.
        </Step>
        <Step
          n={3}
          title="Hold, gift or sell it"
          visual={
            <div className="flex items-center gap-3 font-mono text-[11px] text-mist">
              <span className="rounded-full bg-lime/10 px-2.5 py-1 text-lime">hold</span>
              <span className="rounded-full bg-gold/10 px-2.5 py-1 text-gold">gift</span>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-white">sell</span>
            </div>
          }
        >
          Keep it, send it to a friend, or sell it. Whoever has the crystal has everything inside it — the basket goes with
          it.
        </Step>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- read your crystal

const LEGEND: Array<{ focus: CrystalFocus; label: string; text: string }> = [
  { focus: 'size', label: 'Size', text: 'how much of each asset is inside. This live basket holds six in equal parts.' },
  { focus: 'color', label: 'Green / red', text: 'today’s price move. Deeper colour = a bigger move.' },
  { focus: 'spikes', label: 'Spikes', text: 'how jumpy the price is. Calm stocks stay smooth.' },
  { focus: 'gold', label: 'Gold seams', text: 'a drop of 5% or more that the price later climbed back from.' },
  { focus: 'frost', label: 'Frost', text: 'a sealed gift. Nobody can take anything out until the date it opens.' },
];

function ReadYourCrystal() {
  const [focus, setFocus] = useState<CrystalFocus | null>(null);
  const { basket } = useLiveBasket();
  const active = LEGEND.find((l) => l.focus === focus);
  const guide = (
    <ViberGuide index={4} size={64} className="mt-2">
      Gold seams are my favourite. They show the drops a basket survived.
    </ViberGuide>
  );
  return (
    <section className="space-y-6">
      <div>
        <p className="label text-lime">Read your crystal</p>
        <h2 className="headline mt-2 text-4xl">Every part means something</h2>
        <p className="mt-2 text-sm text-mist">Point at (or tap) a word to light up that part of the crystal.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="relative h-[300px] overflow-hidden rounded-3xl border border-white/10 sm:h-[440px]">
          <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
            {basket && (
            <FittedCrystal
              holdings={basket.holdings}
              history={basket.history}
              size={1.6}
              spin={0.25}
              top={0.08}
              bottom={0.92}
              focus={focus}
            />
            )}
          </Stage>
          <span className="absolute left-4 top-4">
            <LiveBadge>{basket ? `Live basket · last ${basket.hours}h` : 'Reading the chain…'}</LiveBadge>
          </span>
        </div>
        {/* phones: short chips right under the crystal, so the lit part stays in view */}
        <div className="lg:hidden">
          <div className="flex flex-wrap gap-1.5">
            {LEGEND.map((l) => (
              <button
                key={l.focus}
                type="button"
                aria-pressed={focus === l.focus}
                onClick={() => setFocus(focus === l.focus ? null : l.focus)}
                className={`rounded-full border px-3 py-1.5 font-display text-sm font-bold transition ${
                  focus === l.focus ? 'border-lime/60 bg-lime/10 text-lime' : 'border-white/15 text-white'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-3 min-h-[3rem] text-sm text-mist">
            {active ? (
              <>
                <span className={`font-bold ${active.focus === 'gold' ? 'text-gold' : 'text-white'}`}>{active.label}</span> = {active.text}
              </>
            ) : (
              'Tap a word to light up that part of the crystal.'
            )}
          </p>
          {guide}
        </div>
        <div className="hidden flex-col gap-2 lg:flex" onMouseLeave={() => setFocus(null)}>
          {LEGEND.map((l) => {
            const on = focus === l.focus;
            return (
              <button
                key={l.focus}
                type="button"
                aria-pressed={on}
                onMouseEnter={() => setFocus(l.focus)}
                onFocus={() => setFocus(l.focus)}
                // hover already selects on desktop, and taps fire mouseenter first, so a click only ever selects
                onClick={() => setFocus(l.focus)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  on ? 'border-lime/60 bg-lime/5' : 'border-white/10 bg-panel hover:border-white/25'
                }`}
              >
                <span className={`font-display text-lg font-bold ${l.focus === 'gold' ? 'text-gold' : on ? 'text-lime' : 'text-white'}`}>
                  {l.label}
                </span>
                <span className="text-sm text-mist"> = {l.text}</span>
              </button>
            );
          })}
          {guide}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- what's real

function WhatsReal() {
  const d = getDeployment(TARGET_CHAIN.id);
  const items: Array<{ title: string; text: ReactNode }> = [
    { title: 'Testnet only', text: 'PRISM runs on Robinhood Chain Testnet. Nothing here is real money.' },
    { title: 'Test stocks have no value', text: 'NVDA, SPCX and the others are vibe/vibe test tokens, made for trying things out.' },
    {
      title: 'No admin, and the code is public',
      text: (
        <>
          The crystal contract has no owner, no pause button and no upgrades.{' '}
          {d ? (
            <a className="text-lime hover:underline" href={`${explorerAddressUrl(d.prismCrystal)}#code`} target="_blank" rel="noreferrer">
              Read the verified code ↗
            </a>
          ) : null}
        </>
      ),
    },
    { title: 'Your wallet signs everything', text: 'PRISM never asks for your seed phrase or keys. Every step shows up in your own wallet first.' },
  ];
  return (
    <section className="grid gap-6 rounded-3xl border border-white/10 bg-panel p-6 lg:grid-cols-[1fr_auto] lg:items-end">
      <div>
        <p className="label text-lime">What’s real</p>
        <h2 className="headline mt-2 text-4xl">Straight answers</h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.title} className="rounded-2xl bg-ink/60 p-4">
              <p className="font-display text-lg font-bold">{i.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-mist">{i.text}</p>
            </li>
          ))}
        </ul>
      </div>
      <ViberGuide index={5} className="lg:max-w-xs">
        It’s a test playground. Break things, learn how it works, lose nothing.
      </ViberGuide>
    </section>
  );
}
