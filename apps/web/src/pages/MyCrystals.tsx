import { useAccount } from 'wagmi';
import OnchainCrystals, { WhatYouCanDo } from './OnchainCrystals';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { GuideNote } from '../components/Viber';
import { WalletButton } from '../wallet/WalletButton';

export default function MyCrystals() {
  const { isConnected } = useAccount();
  return isConnected ? <OnchainCrystals /> : <NotConnected />;
}

function NotConnected() {
  return (
    <PageScroll>
      <PageHeader
        label="My crystals"
        lead="Your"
        accent="crystals."
        subtitle="The crystals in your wallet, and what is inside each one."
        guide={
          <GuideNote index={11} action={<WalletButton variant="hero" />}>
            Connect your wallet to see your crystals.
          </GuideNote>
        }
      />
      <WhatYouCanDo />
    </PageScroll>
  );
}
