import type { Address } from 'viem';
import { vibeTokenUrl } from '@prism/core';
import { useWallet } from '../wallet/WalletButton';

/** "Buy on vibe/vibe": the token's page there, with PRISM's invite (never for PRISM's own wallet). */
export function BuyOnVibe({ token, className = 'btn btn-primary', label = 'Buy on vibe/vibe' }: { token: Address; className?: string; label?: string }) {
  const { address } = useWallet();
  return (
    <a href={vibeTokenUrl(token, address)} target="_blank" rel="noopener" className={className}>
      {label} ↗
    </a>
  );
}
