import type { Address } from 'viem';
import { vibeTokenUrl } from '@prism/core';
import { useWallet } from '../wallet/WalletButton';

/** "Buy $SYMBOL on vibe/vibe ↗" as a small text link (the page's one button is in its header). */
export function BuyOnVibeLink({ token, symbol, className = '' }: { token: Address; symbol: string; className?: string }) {
  const { address } = useWallet();
  return (
    <a href={vibeTokenUrl(token, address)} target="_blank" rel="noopener" className={`font-mono text-[12px] text-lime underline decoration-lime/40 underline-offset-4 hover:decoration-lime ${className}`}>
      Buy ${symbol} on vibe/vibe ↗
    </a>
  );
}

/** "Buy on vibe/vibe": the token's page there, with PRISM's invite (never for PRISM's own wallet). */
export function BuyOnVibe({ token, className = 'btn btn-primary', label = 'Buy on vibe/vibe' }: { token: Address; className?: string; label?: string }) {
  const { address } = useWallet();
  return (
    <a href={vibeTokenUrl(token, address)} target="_blank" rel="noopener" className={className}>
      {label} ↗
    </a>
  );
}
