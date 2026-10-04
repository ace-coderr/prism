import { Link } from 'react-router-dom';
import { useThree } from '@react-three/fiber';
import { Crystal } from '../components/Crystal';
import { Stage } from '../components/Stage';
import { DataBadge } from '../components/ui';
import { WalletButton } from '../wallet/WalletButton';
import { CORRELATIONS, MY_CRYSTALS, toHoldings } from '../data/mock';

const hero = MY_CRYSTALS[0]!;
const heroHoldings = toHoldings(hero.weights);

function Hero() {
  // fit by width on narrow (phone) screens, by height on wide ones
  const vp = useThree((s) => s.viewport);
  const size = Math.min(1.75, vp.width * 0.3);
  return (
    <Crystal
      holdings={heroHoldings}
      history={hero.history}
      correlation={CORRELATIONS}
      size={size}
      spin={0.22}
      position={[0, vp.height * 0.16, 0]}
    />
  );
}

export default function Home() {
  return (
    <div className="absolute inset-0">
      <Stage className="!absolute inset-0" camera={{ position: [0, 0.4, 7], fov: 40 }}>
        <Hero />
      </Stage>

      <div className="absolute left-4 top-4">
        <DataBadge live={false} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/80 to-transparent px-4 pt-24 pb-8 sm:pb-12">
        <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col items-center text-center">
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
