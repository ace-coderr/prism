import { Link } from 'react-router-dom';
import { Crystal } from '../components/Crystal';
import { Stage } from '../components/Stage';
import { SoonButton } from '../components/ui';
import { CORRELATIONS, MY_CRYSTALS, toHoldings } from '../data/mock';

const hero = MY_CRYSTALS[0]!;
const heroHoldings = toHoldings(hero.weights);

export default function Home() {
  return (
    <div className="absolute inset-0">
      <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6.2], fov: 40 }}>
        <Crystal holdings={heroHoldings} history={hero.history} correlation={CORRELATIONS} size={1.9} spin={0.18} position={[0, 0.75, 0]} />
      </Stage>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/70 to-transparent px-4 pt-24 pb-10 sm:pb-14">
        <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="mb-3 text-xs uppercase tracking-[0.35em] text-mist">Tokenized stocks + ETH · one crystal</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-6xl">A stock basket you can hold</h1>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/forge"
              className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-ink shadow-[0_0_40px_rgba(157,183,255,0.35)] transition hover:bg-white/90"
            >
              Forge
            </Link>
            <SoonButton>Connect Wallet</SoonButton>
          </div>
          <p className="mt-6 text-xs text-mist/70">
            Gold seams mark drawdowns this basket survived. Mock data · Robinhood Chain Testnet
          </p>
        </div>
      </div>
    </div>
  );
}
