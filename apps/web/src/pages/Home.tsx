import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { explorerAddressUrl, getDeployment } from '@prism/core';
import { FittedCrystal, FittedLoadingCrystal, type CrystalFocus } from '../components/Crystal';
import { ExplainerVideo } from '../components/ExplainerVideo';
import { Faq } from '../components/Faq';
import { ForgeMachine } from '../components/ForgeMachine';
import { CountUp, EASE, Headline, Reveal, Section } from '../components/design';
import { Stage } from '../components/Stage';
import { GuideNote } from '../components/Viber';
import { useTestnetTokens } from '../data/chain';
import { LIVE_BASKET, liveBasket } from '../data/crystalHoldings';
import { useChainStats } from '../data/crystals';
import { useSnapshot } from '../data/snapshot';
import { TARGET_CHAIN } from '../wallet/config';

/**
 * The live basket (real 24h moves, jumpiness and drops): from the cached snapshot at
 * once, then from the browser's own chain read when it lands. Null only while neither has.
 */
function useLiveBasket() {
  const live = useTestnetTokens();
  const snapshot = useSnapshot();
  return useMemo(() => {
    const own = liveBasket(live);
    return { basket: own ?? snapshot.data?.basket ?? null, failed: live.status === 'error' && !snapshot.data?.basket };
  }, [live, snapshot.data]);
}

export default function Home() {
  return (
    <>
      <Hero />
      <Idea />
      <Machine />
      <ReadYourCrystal />
      <Video />
      <Trust />
      <Stats />
      <Questions />
    </>
  );
}

// ---------------------------------------------------------------- 00 hero

function Hero() {
  const { basket, failed } = useLiveBasket();
  const reduce = useReducedMotion();
  return (
    <section className="relative">
      <div className="container-x grid min-h-[100svh] items-center gap-4 pb-16 pt-24 md:pt-32 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-20">
        <div className="order-2 lg:order-1">
          <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
            <span className="section-label text-[11px]">
              {basket ? 'Built from live testnet prices' : failed ? 'Couldn’t reach the chain right now' : 'Reading live prices from the chain…'}
            </span>
          </motion.div>
          <Headline as="h1" lead="A stock basket" accent="you can hold" className="mt-6" />
          <Reveal delay={0.35}>
            <p className="body-copy mt-7">Pick a few test stocks and some ETH. PRISM forges them into one crystal that lives in your wallet.</p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link to="/forge" className="btn btn-primary btn-lg">
                Forge a crystal
              </Link>
              <a href="#video" className="btn btn-outline btn-lg">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
                  <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
                </svg>
                Watch in 40s
              </a>
            </div>
          </Reveal>
        </div>
        <div className="relative order-1 h-[34svh] min-h-[240px] lg:order-2 lg:h-[72vh] lg:max-h-[720px]">
          <Stage className="!absolute inset-0" camera={{ position: [0, 0, 7], fov: 40 }}>
            {basket ? (
              <FittedCrystal holdings={basket.holdings} history={basket.history} size={1.75} assemble sway top={0.04} bottom={0.9} />
            ) : (
              <FittedLoadingCrystal size={1.75} top={0.04} bottom={0.9} />
            )}
          </Stage>
          <p className="section-label pointer-events-none absolute inset-x-0 bottom-0 text-center text-[10px]">
            {LIVE_BASKET.map((s) => (s === 'WETH' ? 'ETH' : s)).join(' · ')} · equal parts
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 01 idea

function Idea() {
  return (
    <Section n="01" label="The idea">
      <div className="grid grid-cols-12 gap-6 lg:items-end">
        <Headline lead="Your basket." accent="One crystal." className="col-span-12 lg:col-span-7" />
        <Reveal delay={0.2} className="col-span-12 lg:col-span-5">
          <p className="body-copy">
            Most baskets are rows in an app. PRISM puts the real tokens inside one crystal that you own, and its shape shows
            how they are doing.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- 02 forge machine

const STEPS = [
  { n: '01', title: 'The pick', text: 'Choose up to 8 test stocks and some ETH, in the amounts you want.' },
  { n: '02', title: 'The forge', text: 'One transaction puts them inside a new crystal in your wallet.' },
  { n: '03', title: 'The hold', text: 'The crystal keeps the tokens. Only its owner can take them out.' },
  { n: '04', title: 'The gift', text: 'Seal it, send it or sell it. Whoever holds it owns what is inside.' },
];

function Machine() {
  return (
    <Section n="02" label="The forge machine">
      <Headline lead="Four steps," accent="one machine." />
      <Reveal className="mt-10 md:mt-14">
        <ForgeMachine />
      </Reveal>
      <ol className="mt-10 grid gap-6 sm:grid-cols-2 md:mt-14 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.08}>
            <li className="border-t border-white/[0.1] pt-6">
              <p className="font-mono text-sm text-lime">{s.n}</p>
              <h3 className="mt-3 font-display text-2xl font-bold tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-mist">{s.text}</p>
            </li>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

// ---------------------------------------------------------------- 03 read your crystal

const LEGEND: Array<{ focus: CrystalFocus; label: string; text: string }> = [
  { focus: 'size', label: 'Size', text: 'How much of each asset is inside. This live basket holds six in equal parts.' },
  { focus: 'color', label: 'Green / red', text: 'Today’s price move. A deeper colour is a bigger move.' },
  { focus: 'spikes', label: 'Spikes', text: 'How jumpy the price is. Calm assets stay smooth.' },
  { focus: 'gold', label: 'Gold seams', text: 'A real drop of 5% or more that the price later climbed back from.' },
  { focus: 'frost', label: 'Frost', text: 'A sealed gift. Nothing comes out until the date it opens.' },
];

/** "This is the live basket over the last 48h." (plain text, not a floating badge) */
const basketNote = (basket: { hours: number } | null) => (basket ? `This is the live basket over the last ${basket.hours}h.` : 'Reading the chain…');

function ReadYourCrystal() {
  const [focus, setFocus] = useState<CrystalFocus | null>(null);
  const { basket } = useLiveBasket();
  const active = LEGEND.find((l) => l.focus === focus);
  return (
    <Section n="03" label="Read your crystal">
      <Headline lead="Every cube" accent="means something." />
      <GuideNote index={4} className="mt-8">
        Gold seams are my favourite. Each one is a real drop this basket climbed back from.
      </GuideNote>
      <div className="mt-10 grid grid-cols-12 gap-6 md:mt-14">
        <Reveal className="col-span-12 lg:col-span-7">
          <div className="relative h-[360px] overflow-hidden rounded-[24px] border border-white/[0.08] bg-panel sm:h-[480px] lg:h-[560px]">
            <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
              {basket ? (
                <FittedCrystal holdings={basket.holdings} history={basket.history} size={1.6} sway top={0.1} bottom={0.9} focus={focus} />
              ) : (
                <FittedLoadingCrystal size={1.6} top={0.1} bottom={0.9} />
              )}
            </Stage>
          </div>
        </Reveal>

        {/* phones: chips right under the crystal so the lit part stays in view */}
        <div className="col-span-12 lg:hidden">
          <div className="flex flex-wrap gap-2">
            {LEGEND.map((l) => (
              <button
                key={l.focus}
                type="button"
                aria-pressed={focus === l.focus}
                onClick={() => setFocus(focus === l.focus ? null : l.focus)}
                className={`rounded-full border px-4 py-2 font-display text-sm font-bold transition ${
                  focus === l.focus ? 'border-lime/60 bg-lime/10 text-lime' : 'border-white/15 text-white'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="body-copy mt-5 min-h-[3.4rem]">
            {active ? (
              <>
                <span className={`font-bold ${active.focus === 'gold' ? 'text-gold' : 'text-white'}`}>{active.label}</span> = {active.text}
              </>
            ) : (
              `Tap a word to light up that part of the crystal. ${basketNote(basket)}`
            )}
          </p>
        </div>

        <div className="col-span-5 hidden flex-col justify-center gap-3 lg:flex" onMouseLeave={() => setFocus(null)}>
          <p className="mb-3 text-sm text-mist">Point at a line to light up that part of the crystal. {basketNote(basket)}</p>
          {LEGEND.map((l, i) => {
            const on = focus === l.focus;
            return (
              <Reveal key={l.focus} delay={i * 0.06} y={16}>
                <button
                  type="button"
                  aria-pressed={on}
                  onMouseEnter={() => setFocus(l.focus)}
                  onFocus={() => setFocus(l.focus)}
                  // hover already selects, and taps fire mouseenter first, so a click only selects
                  onClick={() => setFocus(l.focus)}
                  className={`w-full rounded-2xl border px-6 py-5 text-left transition-colors ${
                    on ? 'border-lime/50 bg-lime/[0.06]' : 'border-white/[0.07] bg-panel hover:border-white/20'
                  }`}
                >
                  <span className={`block font-display text-xl font-bold ${l.focus === 'gold' ? 'text-gold' : on ? 'text-lime' : 'text-white'}`}>{l.label}</span>
                  <span className="mt-1 block text-[15px] leading-relaxed text-mist">{l.text}</span>
                </button>
              </Reveal>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- 04 video

function Video() {
  return (
    <Section id="video" n="04" label="PRISM in 40 seconds">
      <Headline lead="The whole idea," accent="in 40 seconds." />
      {/* no reveal wrapper: the video must never sit at opacity 0 or under a transform */}
      <div className="mt-10 md:mt-14">
        <ExplainerVideo />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- 05 trust

function Trust() {
  const d = getDeployment(TARGET_CHAIN.id);
  const cards: Array<{ title: string; text: string; icon: ReactNode; link?: { href: string; label: string } }> = [
    {
      title: 'No admin',
      text: 'The contract has no owner, no pause button and no upgrade path. Nobody can change the rules later.',
      icon: <path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Zm-3.5 9.5 2.5 2.5 4.5-5" />,
    },
    {
      title: 'Only you withdraw',
      text: 'Only a crystal’s owner can take tokens out. A seal can even lock that until a date you pick.',
      icon: (
        <>
          <rect x="5" y="10.5" width="14" height="10" rx="2" />
          <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </>
      ),
    },
    {
      title: 'Verified on-chain',
      text: 'The contract’s source code is published and verified on the block explorer, so anyone can read it.',
      icon: <path d="M7 3h7l5 5v13H7V3Zm7 1.5V9h4.5M10 13.5l2 2 4-4" />,
      link: d ? { href: `${explorerAddressUrl(d.prismCrystal)}#code`, label: 'Read the verified code' } : undefined,
    },
  ];
  return (
    <Section n="05" label="Built to be trusted">
      <Headline lead="Your crystal," accent="your rules." />
      <div className="mt-10 grid gap-6 md:mt-14 md:grid-cols-3">
        {cards.map((c, i) => (
          <Reveal key={c.title} delay={i * 0.08}>
            <div className="card card-hover flex h-full flex-col p-8">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-lime/30 bg-lime/[0.06] text-lime">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {c.icon}
                </svg>
              </span>
              <h3 className="mt-8 font-display text-2xl font-bold tracking-[-0.02em]">{c.title}</h3>
              <p className="mt-3 flex-1 text-[15px] leading-relaxed text-mist">{c.text}</p>
              {c.link && (
                <a href={c.link.href} target="_blank" rel="noreferrer" className="mt-6 font-mono text-xs uppercase tracking-[0.14em] text-lime hover:underline">
                  {c.link.label} ↗
                </a>
              )}
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- 06 stats

function Stats() {
  const s = useChainStats();
  const items = [
    { label: 'Crystals forged', value: s.forged },
    { label: 'Unique owners', value: s.owners },
    { label: 'ETH held in crystals', value: s.ethHeld, format: (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) },
    { label: 'Test stocks supported', value: s.stocks },
  ];
  return (
    <Section n="06" label="Live on Robinhood Chain">
      <Headline lead="Read straight" accent="from the chain." />
      <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-6 md:mt-14 lg:grid-cols-4">
        {items.map((it, i) => (
          <Reveal key={it.label} delay={i * 0.08}>
            <div className="card h-full p-5 sm:p-8">
              <p className="font-display text-4xl font-bold tracking-[-0.04em] text-white sm:text-5xl md:text-6xl">
                <CountUp value={it.value} format={it.format} />
              </p>
              <p className="section-label mt-4 text-[10px] sm:mt-5 sm:text-[11px]">{it.label}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- 07 faq

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'What is PRISM?',
    a: 'A way to hold a basket of test stocks and ETH as one object: a crystal (an NFT) that holds the actual tokens. Its shape shows how the basket is doing.',
  },
  {
    q: 'Is this real money?',
    a: 'No. PRISM runs on Robinhood Chain Testnet only. The test stocks are test assets with no value, and testnet ETH is free.',
  },
  {
    q: 'Who can take things out of a crystal?',
    a: 'Only the wallet that owns it. The contract has no admin, no pause button and no upgrades, so nobody else (not even PRISM) can move what is inside.',
  },
  {
    q: 'What are the gold seams?',
    a: 'Each one marks a real drop of 5% or more in one of the crystal’s holdings that the price later climbed back from. A drop that has not recovered yet shows as an open crack.',
  },
  {
    q: 'What happens when I gift or sell a crystal?',
    a: 'Everything inside goes with it. The new owner can take the tokens out, unless you sealed it: then nobody can until the date you picked.',
  },
  {
    q: 'Do I need test stocks to start?',
    a: 'No. You can forge a crystal with just testnet ETH and add test stocks later.',
  },
  {
    q: 'What are vibe/vibe and Robinhood Chain?',
    a: 'Robinhood Chain is a blockchain from Robinhood; PRISM runs on its public testnet. vibe/vibe is a launchpad on it that issues the test stocks PRISM uses. PRISM is built for vibe/vibe, not by them.',
  },
  {
    q: 'Is the contract audited?',
    a: 'No. It is tested and its code is verified on the block explorer, but it has not been audited. Treat it as a testnet experiment.',
  },
];

function Questions() {
  return (
    <Section n="07" label="Questions you might have">
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-5">
          <Headline lead="Good" accent="questions." />
          <Reveal delay={0.2}>
            <div className="mt-10 hidden lg:block">
              <Crystalette />
            </div>
          </Reveal>
        </div>
        <Reveal className="col-span-12 lg:col-span-7">
          <Faq items={FAQ} />
        </Reveal>
      </div>
    </Section>
  );
}

/** A small live crystal beside the FAQ on wide screens. */
function Crystalette() {
  const { basket } = useLiveBasket();
  return (
    <div className="relative h-[280px] w-[280px]">
      <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }} backdrop={false}>
        {basket ? (
          <FittedCrystal holdings={basket.holdings} history={basket.history} size={1.5} sway top={0.06} bottom={0.94} />
        ) : (
          <FittedLoadingCrystal size={1.5} top={0.06} bottom={0.94} />
        )}
      </Stage>
    </div>
  );
}
