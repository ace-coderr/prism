import { useAccount } from 'wagmi';
import OnchainCrystals from './OnchainCrystals';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { ViberGuide } from '../components/Viber';
import { Panel } from '../components/ui';
import { WalletButton } from '../wallet/WalletButton';

export default function MyCrystals() {
  const { isConnected } = useAccount();
  return isConnected ? <OnchainCrystals /> : <NotConnected />;
}

function NotConnected() {
  return (
    <PageScroll className="max-w-3xl gap-6">
      <PageHeader title="My Crystals" subtitle="The crystals in your wallet, and what is inside each one." />
      <Panel className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <ViberGuide index={11} size={72}>
          Connect your wallet to see your crystals.
        </ViberGuide>
        <WalletButton variant="hero" />
      </Panel>
    </PageScroll>
  );
}
