import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FittedCrystal } from '../components/Crystal';
import { Stage } from '../components/Stage';
import { DataBadge } from '../components/ui';
import { WalletButton } from '../wallet/WalletButton';
import { CORRELATIONS, MY_CRYSTALS, toHoldings } from '../data/mock';

const hero = MY_CRYSTALS[0]!;
const heroHoldings = toHoldings(hero.weights);

/** Breathing room between the crystal and the headline, as a fraction of the canvas height. */
const HEADLINE_GAP = 0.04;

function Hero({ textTop }: { textTop: number }) {
  // camera fitted to the crystal's bounding sphere, inside the space above the headline
  return (
    <FittedCrystal
      holdings={heroHoldings}
      history={hero.history}
      correlation={CORRELATIONS}
      size={1.75}
      spin={0.22}
      top={0.06}
      bottom={Math.max(0.35, textTop - HEADLINE_GAP)}
    />
  );
}

export default function Home() {
  // where the headline block starts, as a fraction of the page height (re-measured on resize)
  const pageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [textTop, setTextTop] = useState(0.55);
  useLayoutEffect(() => {
    const page = pageRef.current;
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
    <div ref={pageRef} className="absolute inset-0">
      <Stage className="!absolute inset-0" camera={{ position: [0, 0, 7], fov: 40 }}>
        <Hero textTop={textTop} />
      </Stage>

      <div className="absolute left-4 top-4">
        <DataBadge live={false} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/80 to-transparent px-4 pt-24 pb-8 sm:pb-12">
        <div ref={textRef} className="pointer-events-auto mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="label mb-4 text-lime">Tokenized stocks + ETH → one crystal</p>
          <h1 className="headline text-5xl sm:text-7xl">A stock basket you can hold</h1>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/forge" className="btn btn-primary">
              Forge
            </Link>
            <WalletButton big />
          </div>
          <p className="label mt-6 text-[10px] text-mist/80">
            <span className="text-gold">Gold seams</span> = drawdowns this basket survived
          </p>
        </div>
      </div>
    </div>
  );
}
