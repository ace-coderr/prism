import type { Address } from 'viem';
import { REFERRAL_DISCLOSURE, VIBE_REFERRAL, vibeInviteUrl, vibeTokenUrl } from '@prism/core';
import { useWallet } from '../wallet/WalletButton';

/** True when the connected wallet is PRISM's own (no self-referral). */
export const useIsOwner = () => {
  const { address } = useWallet();
  return !!address && address.toLowerCase() === VIBE_REFERRAL.owner.toLowerCase();
};

/** The small disclosure next to vibe/vibe links (not shown to PRISM's own wallet, which gets plain links). */
export function ReferralNote({ className = '' }: { className?: string }) {
  if (useIsOwner()) return null;
  return <span className={`text-[11px] text-mist/80 ${className}`}>{REFERRAL_DISCLOSURE}</span>;
}

/** "Buy on vibe/vibe": the token's page there, with PRISM's invite. */
export function BuyOnVibe({ token, className = 'btn btn-primary', label = 'Buy on vibe/vibe', note = true }: { token: Address; className?: string; label?: string; note?: boolean }) {
  const { address } = useWallet();
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <a href={vibeTokenUrl(token, address)} target="_blank" rel="noopener" className={className}>
        {label} ↗
      </a>
      {note && <ReferralNote />}
    </span>
  );
}

/** "Join vibe/vibe": vibe/vibe's guilds with PRISM's invite. */
export function JoinVibe({ className = '' }: { className?: string }) {
  const { address } = useWallet();
  return (
    <a href={vibeInviteUrl(address)} target="_blank" rel="noopener" className={className}>
      Join vibe/vibe with PRISM’s invite ↗
    </a>
  );
}
