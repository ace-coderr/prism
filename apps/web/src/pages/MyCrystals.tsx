import { useAccount } from 'wagmi';
import OnchainCrystals from './OnchainCrystals';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { ViberGuide } from '../components/Viber';
import { Reveal } from '../components/design';
import { WalletButton } from '../wallet/WalletButton';

export default function MyCrystals() {
  const { isConnected } = useAccount();
  return isConnected ? <OnchainCrystals /> : <NotConnected />;
}

function NotConnected() {
  return (
    <PageScroll>
      <PageHeader label="My crystals" lead="Your" accent="crystals." subtitle="The crystals in your wallet, and what is inside each one." />
      <Reveal>
        <div className="card flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between md:p-10">
          <ViberGuide index={11} size={88}>
            Connect your wallet to see your crystals.
          </ViberGuide>
          <WalletButton variant="hero" />
        </div>
      </Reveal>
    </PageScroll>
  );
}
